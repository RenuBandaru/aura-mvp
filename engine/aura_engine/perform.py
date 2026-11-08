"""Carry out one action on a case. JavaScript ``perform``.

:func:`perform` never changes the case it is given. It copies the case, checks the action is
allowed (by asking :func:`aura_engine.actions.actions_for`), checks required fields, applies the
action, runs the follow-ups that every action shares, seals the audit trail, and returns the new
case. Anything wrong raises :class:`aura_engine.errors.EngineError` with a message for the person.

Side effects are recorded on the case itself, never sent anywhere:

* ``c["audit"]`` gets one entry per thing that happened (see :mod:`aura_engine.audit`),
* ``c["outbox"]`` gets one entry per email that would be sent. In the MVP the outbox is
  simulated; nothing leaves the app.

Build 27 wrote ``perform`` as one long function with many small inner helpers. Here the helpers
are methods of :class:`_Run`, which holds the case being changed (``self.c``), the original
(``self.c0``), the inputs, the person acting and the context. Each method's docstring names the
JavaScript helper it replaces, so the two can be read side by side.
"""

from __future__ import annotations

import re

from .actions import actions_for
from .audit import seal_audit
from .constants import BIAS_OPTS, DAY, TIER_LABEL, by_id, lead_id, t_idx, with_role
from .consults import consult_needs
from .controls import (EVIDENCE_EXT, EVIDENCE_MAX, EVIDENCE_TYPES, MEAS_STATE, ctl_applies, loose_threads, measure_state, parse_measures,
                       support_view, thread_sig)
from .errors import EngineError
from .forms import ONGOING_BASIS, budget_flag, changed_fields, form_diff, three_year_roi
from .jsx import (UNDEF, clone, date_string, is_nan, js_json, js_or, js_round, js_str, nullish, num_or_zero, strip_end, text_or_blank,
                  to_locale, to_num, truthy, unique)
from .matching import unclaimed_required
from .people import OWNER_ROLES, assign_adviser, duty_block, owner_of, role_name, self_confirmed, sync_owner, training_blocks, training_msg
from .review import (FIRMABLE, dec_label, deadlock_options, rev_blockers, rev_deadlock, rev_pool, rev_quorum_waivable, rev_ready, rev_votes,
                     remind_case, terms_diff, terms_gaps, terms_now, vote_key)
from .triage import due_for, estimate_days, run_scoring, run_triage

# The shared approval terms a reviewer can save into the draft.
DRAFT_KEYS = ["rationale", "scope", "days", "waiver", "limits", "validDays", "prodDays"]
_STANCE_WORDS = {"support": "no concerns", "concerns": "concerns", "serious": "serious concern"}
_STANCE_TITLES = {"support": "No concerns", "concerns": "Concerns to address", "serious": "Serious concern"}
_URL = re.compile(r"^https?://\S+\Z", re.IGNORECASE)


def _concat(*parts) -> list:
    """JavaScript ``[].concat(a, b, ...)``: lists are opened up, anything else is added as one item."""
    out: list = []
    for p in parts:
        if isinstance(p, list):
            out.extend(p)
        else:
            out.append(p)
    return out


def perform(c0: dict, action_id: str, inp: dict | None, actor: dict, ctx: dict) -> dict:
    """Apply action ``action_id`` by ``actor`` to case ``c0`` with the typed ``inp`` values, and return the new case.

    ``ctx`` holds ``rules``, ``now`` (milliseconds), ``rv`` (rules version, default 1) and optionally
    ``training``.
    """
    inp = inp or {}
    allowed = next((a for a in actions_for(c0, actor, ctx) if a["id"] == action_id), None)
    if not allowed:
        raise EngineError("This action is not available to " + js_str(actor.get("name", UNDEF)) + " right now.")
    if truthy(allowed.get("disabled")):
        raise EngineError(allowed.get("why"))
    for f in allowed.get("fields") or []:
        if not truthy(f.get("required")):
            continue
        v = inp.get(f["name"])
        filled = len(v) > 0 if isinstance(v, list) else bool(js_str("" if nullish(v) else v).strip())
        if not filled:
            raise EngineError(re.sub(r" \(.*\)\Z", "", js_str(f.get("label", UNDEF)), count=1) + " is required.")
    run = _Run(c0, action_id, inp, actor, ctx)
    result = run.apply()
    if result is not None:  # "remind" returns a finished case of its own
        return result
    run.follow_ups()
    return seal_audit(run.c, js_or(ctx.get("rv"), 1), run.now)


class _Run:
    """One call of :func:`perform`: the case being changed and the helpers that change it."""

    def __init__(self, c0: dict, action_id: str, inp: dict, actor: dict, ctx: dict):
        self.c0 = c0
        self.c = clone(c0)
        self.id = action_id
        self.inp = inp
        self.actor = actor
        self.ctx = ctx
        self.R = ctx["rules"]
        self.now = ctx["now"]
        self.rv = js_or(ctx.get("rv"), 1)
        self.note = text_or_blank(inp.get("note"))
        self.rat = text_or_blank(inp.get("rationale"))
        self.lead = with_role("lead")[0]
        self.panel_people = [p["id"] for p in [self.lead] + with_role("panel")]
        # Needed before anything changes: a quorum waiver is described with the numbers it was granted on.
        self.wq_info = rev_quorum_waivable(c0, self.R) if action_id == "panel_waivequorum" else None

    # ------------------------------------------------------------------
    # Recording: audit entries and emails
    # ------------------------------------------------------------------

    def log(self, action: str, text, *, to=None, due=UNDEF, auto: bool = False, tag: str = "") -> None:
        """Add an audit entry, moving the case to stage ``to`` and setting its due date if given. JavaScript ``log``."""
        c = self.c
        frm = c["stage"]
        if to and to != frm:
            c["stage"] = to
            c["stageSince"] = self.now
        if due is not UNDEF:
            c["dueAt"] = due
        c["audit"].append({"ts": self.now, "actor": "system" if auto else self.actor["id"], "action": action, "note": js_or(text, ""),
                           "from": frm, "to": c["stage"], "auto": bool(auto), "tag": tag or ""})

    def mail(self, to, subject: str, body: str, kind: str = "", x=None, skip_actor: bool = False) -> None:
        """Queue an email in the outbox. JavaScript ``mail``.

        Mail to the submitter is copied to the owner (if someone else) and the adviser. ``x`` holds
        the parts of the rich email layout (banner, notes, button) and is stored as JSON text.
        """
        c = self.c
        base = _concat(to)
        extra = []
        if c.get("submitterId") in base:
            ow, ad = owner_of(c), c.get("adviserId")
            if truthy(ow) and ow != c.get("submitterId"):
                extra.append(ow)
            if truthy(ad):
                extra.append(ad)
        recips = base + [pid for pid in extra if not (skip_actor and pid == self.actor["id"])]
        c["outbox"].append({"x": js_json(x) if truthy(x) else None, "ts": self.now, "n": len(c["outbox"]), "to": unique(recips),
                            "subject": subject, "body": body, "kind": kind or "", "auto": True})

    # ------------------------------------------------------------------
    # The shared review draft
    # ------------------------------------------------------------------

    def save_draft(self) -> None:
        """Save typed approval terms and accepted risks into the shared draft. JavaScript ``saveDraft``."""
        c, inp = self.c, self.inp
        if not any(k in inp for k in DRAFT_KEYS) and "measures" not in inp:
            return
        before = terms_now(c, self.R)
        cur = c.get("reviewDraft")
        d = clone(cur if truthy(cur) else {"rev": 0, "vals": {}, "overrides": {}, "touched": []})
        if truthy(cur) and "draftrev" in inp and inp["draftrev"] != "force" and js_str("" if nullish(inp["draftrev"]) else inp["draftrev"]) != js_str(cur.get("rev", UNDEF)):
            raise EngineError("Someone else saved a newer version of this review (" + by_id(cur.get("by"))["name"] + ", " + date_string(cur.get("at", UNDEF))
                              + "). Close and reopen to see it, or save again to overwrite it.")
        for k in DRAFT_KEYS:
            if k in inp:
                d["vals"][k] = inp[k]
        if "measures" in inp:
            d["vals"]["measures"] = clone(inp["measures"])
        for t in loose_threads(c, self.R):
            reason = text_or_blank(inp.get("ov_" + t["slug"]))
            on = truthy(inp.get("ovc_" + t["slug"]))
            if reason or on:
                d["overrides"][t["slug"]] = {"on": on, "reason": reason, "sig": thread_sig(t), "by": self.actor["id"], "at": self.now}
            else:
                d["overrides"].pop(t["slug"], None)
        d["rev"] = js_or(d.get("rev"), 0) + 1
        d["by"] = self.actor["id"]
        d["at"] = self.now
        d["touched"] = (js_or(d.get("touched"), []) + [{"by": self.actor["id"], "at": self.now}])[-30:]
        c["reviewDraft"] = d
        if not truthy(inp.get("__seed")):
            self.drop_firm(terms_diff(before, terms_now(c, self.R)))

    def drop_firm(self, changes: list[dict]) -> None:
        """When the shared terms change, other reviewers' firm decisions go back to leaning, and they are told. JavaScript ``dropFirm``."""
        vs = self.c.get(vote_key(self.c))
        if not changes or not truthy(vs):
            return
        hit = [pid for pid in vs if pid != self.actor["id"] and truthy(vs[pid].get("firm"))]
        if not hit:
            return
        for pid in hit:
            vs[pid]["firm"] = False
            vs[pid]["lastMailAt"] = self.now
        lbl = ", ".join(x["label"] for x in changes)
        name = self.actor["name"]
        self.mail(hit, "Approval terms changed on " + self.c["id"] + ": please look again",
                  name + " changed " + lbl + ' on "' + js_str(self.c.get("title", UNDEF)) + '". Your firm decision is now a leaning one until you confirm it again.', "task",
                  {"banner": ["ask", "The approval terms changed", name + " changed the terms after you decided. Your decision now counts as leaning until you confirm it."],
                   "notes": [["What changed", lbl, "note"]], "button": "Open the case and review the changes", "only": 1})
        self.log("Panel note: terms changed", "Changed " + lbl + ". Firm decisions went back to leaning.")

    def draft_touched(self) -> list[dict]:
        """Who edited the shared draft, and when. JavaScript ``draftTouched``."""
        dr = self.c.get("reviewDraft")
        return [{"by": t.get("by", UNDEF), "at": t.get("at", UNDEF)} for t in ((dr.get("touched") if truthy(dr) else None) or [])]

    def collect_overrides(self) -> list[dict]:
        """Every open item must be ticked as accepted, with a reason, before approving. JavaScript ``collectOverrides``."""
        out = []
        for t in loose_threads(self.c, self.R):
            reason = text_or_blank(self.inp.get("ov_" + t["slug"]))
            if not truthy(self.inp.get("ovc_" + t["slug"])):
                raise EngineError("Tick Accept for this risk before approving: " + js_str(t.get("label", UNDEF)) + ".")
            if not reason:
                raise EngineError("Say why you accept this risk as is: " + js_str(t.get("label", UNDEF)) + ".")
            label = (js_str(t["label"]) + ", " + ("serious concern" if t.get("stance") == "serious" else "concerns to address")) if t["kind"] == "concern" else t["label"]
            out.append({"id": t["id"], "kind": t["kind"], "head": js_or(t.get("head"), t.get("label")), "stance": js_or(t.get("stance"), ""),
                        "label": label, "detail": t.get("detail", UNDEF), "reason": reason})
        return out

    # ------------------------------------------------------------------
    # Review records
    # ------------------------------------------------------------------

    def vote_summary(self) -> list[dict]:
        """Each reviewer's decision, for the decision record. JavaScript ``voteSummary``."""
        v = rev_votes(self.c)
        return [{"by": pid, "dec": v[pid].get("dec", UNDEF), "firm": truthy(v[pid].get("firm"))} for pid in rev_pool(self.c) if truthy(v.get(pid))]

    def archive_round(self, kind: str, outcome, how, summary) -> None:
        """Keep this round's votes, notes and terms in Review history before they are cleared. JavaScript ``archiveRound``."""
        c = self.c
        v = rev_votes(c)
        is_exec = kind == "exec"
        if not truthy(c.get("rounds")):
            c["rounds"] = []
        notes = []
        for n in c.get("panelNotes") or []:
            if (by_id(n.get("by"))["role"] == "exec") != is_exec:
                continue
            mv = v.get(n.get("by")) if truthy(v.get(n.get("by"))) else {}
            notes.append({"by": n.get("by", UNDEF), "text": n.get("text", UNDEF), "dec": js_or(mv.get("dec"), n.get("lean", UNDEF)), "firm": truthy(mv.get("firm")), "at": n.get("at", UNDEF)})
        c["rounds"].append({"n": len(c["rounds"]) + 1, "kind": kind, "at": self.now, "by": self.actor["id"], "outcome": outcome, "how": js_or(how, "consensus"),
                            "summary": js_or(summary, ""), "votes": self.vote_summary(), "notes": notes, "terms": terms_now(c, self.R)})

    def how_txt(self, how) -> str:
        """How a decision was reached, for the audit note. JavaScript ``howTxt``."""
        if how == "deadlock":
            return " The reviewers disagreed. " + self.actor["name"] + " broke the deadlock."
        if how == "quorum" and self.wq_info:
            return (" Quorum waived by " + self.actor["name"] + ": decided with " + js_str(self.wq_info["n"]) + " of " + js_str(self.wq_info["of"])
                    + " reviewers, the others abstained.")
        return ""

    def stamp(self, how) -> dict:
        """JavaScript ``stamp``."""
        return {"how": js_or(how, "consensus"), "votes": self.vote_summary()}

    @staticmethod
    def ov_note(ov: list[dict]) -> str:
        """'Accepted 2 risks as is: ...' for the audit note. JavaScript ``ovNote``."""
        if not ov:
            return ""
        return " Accepted " + str(len(ov)) + " risk" + ("s" if len(ov) > 1 else "") + " as is: " + "; ".join(js_str(o["label"]) + " (" + o["reason"] + ")" for o in ov) + "."

    def approval_notice(self, how: str, notes: str, ov: list[dict]) -> None:
        """One formal email at approval listing everything the submitter and owner have agreed to. JavaScript ``approvalNotice``."""
        c, R, now, d = self.c, self.R, self.now, date_string
        ac = c.get("acceptance") if truthy(c.get("acceptance")) else {}
        subs = [e["ts"] for e in c["audit"] if e.get("action") == "Submitted for triage"]
        lines = ["Decision: " + how + ", by " + self.actor["name"] + " on " + d(now) + "."]
        took = js_str(max(0, js_round((now - subs[0]) / DAY))) + " days" if subs else "not recorded"
        lines.append("Time from submission to decision: " + took + ", over " + str(len(subs) or 1) + " review cycle" + ("s" if len(subs) > 1 else "") + ".")
        if notes:
            lines.append("Decision notes: " + notes)
        lines.append("Accepted risks: " + ("; ".join(js_str(o["label"]) + " (" + o["reason"] + ")" for o in ov) if ov else "none."))
        pilot = c.get("pilot")
        if truthy(pilot) and truthy(pilot.get("waived")):
            lines.append("Pilot: waived. Reason: " + js_str(pilot.get("waiverReason", UNDEF)) + ".")
        elif truthy(pilot):
            lines.append("Pilot scope and conditions: " + strip_end(js_str(pilot.get("scope", UNDEF)), r"\.") + ". Pilot review date: " + d(pilot.get("reviewDueAt", UNDEF)) + ".")
        else:
            lines.append("Pilot: none. Approved straight to production.")
        lines.append("Production conditions and limits: " + js_str(js_or(ac.get("limits"), "none beyond the claimed controls.")))
        lines.append("Approval valid until: " + (d(ac["validUntil"]) if truthy(ac.get("validUntil")) else "not set") + ".")
        prod = c.get("production")
        lines.append("Review cycle: every " + js_str(js_or(ac.get("prodReviewDays"), R["reviewCadenceDays"].get(c.get("tier"), UNDEF))) + " days in production"
                     + (". Next review: " + d(prod.get("nextReviewAt", UNDEF)) + "." if truthy(prod) else ", starting when it is promoted to production."))
        kpis = "; ".join(m["name"] + " (target " + js_str(m.get("target", UNDEF)) + ", stop limit " + js_str(m.get("stop", UNDEF)) + ")" for m in js_or(ac.get("measures"), []))
        lines.append("KPIs: " + (kpis or "none."))
        sv = support_view(c, R)
        stl = {"confirmed": "confirmed", "evidence": "supported by evidence", "declined": "declined"}
        rows = "; ".join(r["text"] + " (" + ("does not apply to this case" if r["na"] else stl.get(r["status"], "not yet supported")) + ")" for r in sv["rows"])
        lines.append("Claimed controls: " + (rows if sv["rows"] else "none."))
        self.mail(c["submitterId"], "Approval notice: " + js_str(c.get("title", UNDEF)), "\n".join(lines), "decision")

    # ------------------------------------------------------------------
    # Approval, pilot and production records
    # ------------------------------------------------------------------

    def cadence(self):
        """Days between production reviews: the approved period, else the tier default. JavaScript ``cadence``."""
        ac = self.c.get("acceptance")
        return js_or(ac.get("prodReviewDays") if truthy(ac) else None, self.R["reviewCadenceDays"].get(self.c.get("tier"), UNDEF))

    def keep_approval(self) -> None:
        """Move the approval aside (it stays as the starting suggestion next time) and KPI results to history. JavaScript ``keepApproval``."""
        c = self.c
        if truthy(c.get("acceptance")):
            c["priorAcceptance"] = c["acceptance"]
        c["measurementHistory"] = js_or(c.get("measurementHistory"), []) + js_or(c.get("measurements"), [])
        c["acceptance"] = None
        c["measurements"] = []

    def to_production(self, how: str) -> None:
        """Start the production record and schedule the first review. JavaScript ``toProduction``."""
        self.c["production"] = {"since": self.now, "lastReviewAt": self.now, "nextReviewAt": self.now + to_num(self.cadence()) * DAY, "reviews": 0, "how": how}

    def record_acceptance(self, scope) -> str:
        """Record the approver's boundaries and KPIs, and return text for the audit note. JavaScript ``recordAcceptance``."""
        c, inp, R = self.c, self.inp, self.R
        ms = parse_measures(inp.get("measures"), True)
        if not ms:
            raise EngineError("Record at least one KPI with a target and a stop limit.")
        for i, m in enumerate(ms):
            m["id"] = "m" + str(i + 1)
        vd = js_round(to_num(inp.get("validDays", UNDEF)))
        pd = js_round(to_num(inp.get("prodDays", UNDEF)))
        if not (vd > 0) or not (pd > 0):
            raise EngineError("The validity period and the production review period must be whole days above zero.")
        max_days = R["reviewMaxDays"].get(c.get("tier"), UNDEF)
        if max_days is not UNDEF and pd > to_num(max_days):
            raise EngineError("The production review period cannot be longer than the maximum of " + js_str(max_days) + " days for this tier.")
        if truthy(c.get("acceptance")):
            c["acceptanceHistory"] = js_or(c.get("acceptanceHistory"), []) + [c["acceptance"]]
        c["acceptance"] = {"by": self.actor["id"], "at": self.now, "rv": self.rv, "scope": scope, "limits": text_or_blank(inp.get("limits")), "measures": ms,
                           "proposed": clone(js_or(c["form"].get("measures"), [])), "validDays": vd, "validUntil": self.now + vd * DAY, "prodReviewDays": pd}
        c["measurementHistory"] = js_or(c.get("measurementHistory"), []) + js_or(c.get("measurements"), [])
        c["measurements"] = []
        c["priorAcceptance"] = None
        return " Approved for " + js_str(vd) + " days, production review every " + js_str(pd) + " days, " + str(len(ms)) + " KPI" + ("s" if len(ms) > 1 else "") + "."

    def record_meas(self) -> str:
        """Read typed KPI results (fields mv_<id>) onto the case, alert the lead past a stop limit, and return audit text. JavaScript ``recordMeas``."""
        c = self.c
        ms = (c["acceptance"].get("measures") if truthy(c.get("acceptance")) else None) or []
        values, bits, stops = {}, [], []
        for m in ms:
            raw = self.inp.get("mv_" + m["id"])
            if raw == "" or nullish(raw):
                continue
            if is_nan(raw):
                raise EngineError(m["name"] + " needs a number.")
            n = to_num(raw)
            values[m["id"]] = n
            st = measure_state(m, n)
            bits.append(m["name"] + " " + js_str(n) + " (" + MEAS_STATE[st].lower() + ")")
            if st == "stop":
                stops.append(m["name"])
        if not bits:
            return ""
        c["measurements"] = js_or(c.get("measurements"), []) + [{"at": self.now, "by": self.actor["id"], "stage": c["stage"], "values": values}]
        if stops:
            self.mail(self.lead["id"], "Stop limit passed: " + js_str(c.get("title", UNDEF)),
                      "A KPI result passed its stop limit: " + ", ".join(stops) + ". Review the case and decide whether to rework, reassess or reject.", "alert")
        return " Measured: " + "; ".join(bits) + "."

    def start_pilot(self, scope: str, days) -> None:
        """JavaScript ``startPilot``."""
        self.c["pilot"] = {"scope": scope, "reviewDays": to_num(days), "startedAt": self.now, "reviewDueAt": self.now + days * DAY, "reworks": 0, "waived": False}

    # ------------------------------------------------------------------
    # Confirmations and consults
    # ------------------------------------------------------------------

    def control_text(self, control_id, prefer_short: bool = False):
        k = next((x for x in self.R["controls"] if x["id"] == control_id), None) or {}
        return js_or(k.get("short") if prefer_short else None, k.get("text"), control_id)

    def no_longer_needed(self, a: dict) -> None:
        """Tell a confirmer their confirmation is no longer needed. JavaScript ``noLongerNeeded``."""
        k = next((x for x in self.R["controls"] if x["id"] == a.get("controlId")), None) or {}
        title = js_str(self.c.get("title", UNDEF))
        self.mail(a.get("personId"), "No longer needed: " + js_str(js_or(k.get("short"), k.get("text"), a.get("controlId", UNDEF))) + " on " + title,
                  'Your confirmation is no longer needed for the control "' + js_str(js_or(k.get("text"), a.get("controlId", UNDEF))) + '" on "' + title
                  + '". If you were asked about other controls on this case, those requests are unchanged.', "notice")

    def sync_unit(self) -> None:
        """If the form names a different business unit, change the adviser to match. JavaScript ``syncUnit``."""
        c = self.c
        u = (c.get("form") or {}).get("unitId")
        if truthy(u) and u != c.get("unitId"):
            assign_adviser(c, self.R, u)
            self.log("Business unit changed", "The adviser is now " + by_id(c["adviserId"])["name"] + ".")

    def build_atts(self) -> None:
        """Bring confirmation requests in line with the form: ask new confirmers, keep existing answers, retire the rest. JavaScript ``buildAtts``."""
        c = self.c
        prev = c.get("attestations") or []
        out = []
        for cid in c["form"].get("controls") or []:
            pid = (c["form"].get("attesters") or {}).get(cid)
            if not truthy(pid):
                continue
            ev = text_or_blank((c["form"].get("evidence") or {}).get(cid))
            old = next((a for a in prev if a.get("controlId") == cid and a.get("personId") == pid), None)
            # A confirmation is a person's attestation and is independent of the evidence text, so editing evidence never resets it.
            if old:
                old["evidence"] = ev
                out.append(old)
                continue
            out.append({"controlId": cid, "personId": pid, "status": "pending", "evidence": ev, "requestedAt": self.now, "at": None, "text": ""})
            ctext = js_str(self.control_text(cid))
            self.mail(pid, "Please confirm a control: " + js_str(c.get("title", UNDEF)),
                      'You were named as able to confirm "' + ctext + '" from your own knowledge of this use case. You can respond at any time before approval.'
                      + (" The submitter also noted: " + ev if ev else "") + " Open the case and confirm or decline.", "task",
                      {"banner": ["ask", "Your confirmation is requested", "Please respond as soon as you can. It does not block the decision, but your confirmation will strengthen the case."],
                       "notes": [["The control", self.control_text(cid), "ask"]] + ([["What the submitter noted", ev, "note"]] if ev else []),
                       "button": "Open the case and respond", "only": 1})
        for a in prev:
            if any(o.get("controlId") == a.get("controlId") and o.get("personId") == a.get("personId") for o in out):
                continue
            if a.get("status") == "pending":
                self.no_longer_needed(a)
            if not truthy(c.get("removedControls")):
                c["removedControls"] = []
            c["removedControls"].append({"controlId": a.get("controlId", UNDEF), "attestation": a, "at": self.now, "by": self.actor["id"]})
        c["attestations"] = out

    def next_kid(self) -> str:
        """The next consult id: k1, k2, ... JavaScript ``nextKid``."""
        nums = [num_or_zero(js_str(k.get("id", UNDEF))[1:]) for k in self.c["consults"]]
        return "k" + js_str(max([0] + nums) + 1)

    def consult_due(self):
        """When an expert's answer is due for this tier."""
        return self.now + to_num(self.R["deadlines"]["consult"].get(self.c.get("tier"), UNDEF)) * DAY

    def reconsult(self, ids) -> list[str]:
        """Ask people who already answered to take a second look, showing them their earlier answer. JavaScript ``reconsult``."""
        c, R = self.c, self.R
        out = []
        need = {} if truthy(c.get("legacy")) else consult_needs(c["form"], R)
        due = self.consult_due()
        for kid in _concat(js_or(ids, [])):
            k0 = next((k for k in c["consults"] if k.get("id") == kid and k.get("status") != "pending" and not truthy(k.get("supersededBy"))), None)
            if not k0:
                continue
            sme = k0.get("kind") == "sme"
            b0 = duty_block(c, k0.get("personId"), "expert" if sme else "stakeholder")
            if b0 and not (sme and any(k.get("personId") == k0.get("personId") for k in c["consults"])):
                raise EngineError(b0)
            n = need.get(k0["areaId"]) if truthy(k0.get("areaId")) else None
            req = sme and bool(n) and (n["level"] == "required" or k0.get("required") is not False)
            nk = {"id": self.next_kid(), "kind": k0.get("kind", UNDEF), "personId": k0.get("personId", UNDEF), "areaId": js_or(k0.get("areaId"), None),
                  "question": k0.get("question", UNDEF), "requestedAt": self.now, "dueAt": due if sme else None, "status": "pending", "reminders": 0,
                  "required": req, "prevId": k0.get("id", UNDEF), "round": len(c.get("rounds") or []) + 1}
            c["consults"].append(nk)
            k0["supersededBy"] = nk["id"]
            diff = form_diff(js_or(k0.get("formSnap"), c.get("formAtReturn")), c["form"], R)
            answered = sorted((k for k in c["consults"] if k.get("personId") == k0.get("personId") and truthy(k.get("response"))), key=lambda k: k["response"].get("at", 0))
            hist = [["Your response, " + date_string(k["response"].get("at", UNDEF)) + " (" + _STANCE_TITLES.get(k["response"].get("stance"), "") + ")",
                     k["response"].get("text", UNDEF), "note"] for k in answered]
            ask = ("A response is " + ("required" if req else "requested") + " by " + date_string(due) + ".") if sme else "Your feedback is welcome."
            x = {"due": [("A response is required by " if req else "A response is requested by ") + date_string(due) + ".",
                         "The decision waits on it." if req else "It does not hold up the decision."] if sme else UNDEF,
                 "intro": self.actor["name"] + " (" + role_name(self.actor) + ") asks you to take a second look. The use case was sent back, changed and resubmitted.",
                 "notes": hist + [["What changed since your last response", "; ".join(diff) or "No answers changed. The case is back for another review.", "ask"]],
                 "button": "Open the case and respond", "only": 1}
            self.mail(k0.get("personId"), "Second look requested: " + js_str(c.get("title", UNDEF)),
                      "The use case came back after changes. " + ask + " Your earlier comment: " + js_str(k0["response"].get("text", UNDEF))
                      + (" What changed: " + "; ".join(diff) + "." if diff else ""), "consult", x)
            out.append(by_id(k0.get("personId"))["name"] + (" (required)" if req else ""))
        if out:
            self.log("Consult: second look requested", ", ".join(out))
        return out

    # ------------------------------------------------------------------
    # Sending back, closing, submitting
    # ------------------------------------------------------------------

    def bounce(self, frm: str, reason: str, action: str, tx: str = "") -> None:
        """Send the case back to the submitter for changes. Reviews are cleared; consult answers are kept. JavaScript ``bounce``."""
        c = self.c
        c["returned"] = {"from": frm, "reason": reason, "at": self.now}
        self.keep_approval()
        c["signoff"] = None
        c["formAtReturn"] = clone(c["form"])
        c["panelNotes"] = []
        c["votes"] = {}
        c["xvotes"] = {}
        for k in ("readyBy", "reviewDraft", "panelDecision", "briefing", "execDecision", "vetting", "recommendedPilot"):
            c[k] = None
        self.log(action, reason + (tx or ""), to="use_case", due=None, tag="remediate")
        self.mail(c["submitterId"], "Returned for remediation: " + js_str(c.get("title", UNDEF)), reason, "return",
                  {"banner": ["ret", "Sent back for changes", "Returned by " + self.actor["name"] + " on " + date_string(self.now)
                              + ". Your use case is not rejected. It needs the changes below, then you can resubmit."],
                   "notes": [["What needs to change", reason, "note"]], "button": "Open and fix your use case", "only": 1})

    def close(self, frm: str, reason: str, action: str, tx: str = "") -> None:
        """Close the case with a reason, optionally marked not permitted. JavaScript ``close``."""
        c = self.c
        np = "np" in js_or(self.inp.get("notPermitted"), [])
        c["closed"] = {"from": frm, "reason": reason, "at": self.now, "notPermitted": np}
        self.log(action + (" (not permitted)" if np else ""), reason + (tx or ""), to="closed", due=None, tag="reject")
        self.mail(c["submitterId"], "Closed with reason: " + js_str(c.get("title", UNDEF)), reason + ("\nThis idea was marked as not permitted." if np else ""), "close",
                  {"banner": ["cls", "Closed: not permitted" if np else "Closed", "Closed by " + self.actor["name"] + " on " + date_string(self.now) + "."],
                   "notes": [["Reason", reason, "note"]], "button": "View the case", "only": 1})

    def submit_for_triage(self) -> None:
        """Triage the form; if it passes, score it and send it to vetting. JavaScript ``doSubmit``."""
        c, R, now = self.c, self.R, self.now
        parse_measures(c["form"].get("measures"), True)
        self.log("Submitted for triage", "")
        t = run_triage(c["form"], R)
        c["triage"] = {"at": now, "rv": self.rv, **t}
        title = js_str(c.get("title", UNDEF))
        if t["result"] == "remediate":
            c["returned"] = {"from": "triage", "reason": " ".join(t["reasons"]), "reasons": t["reasons"], "at": now}
            self.log("Triage: remediate", " ".join(t["reasons"]), auto=True, to="use_case", due=None, tag="remediate")
            self.mail(c["submitterId"], "Returned from triage: " + title, "\n".join(t["reasons"]), "return")
            return
        self.build_atts()
        sc = run_scoring(c["form"], R, c["attestations"])
        c["scoring"] = {"at": now, "rv": self.rv, **sc}
        c["tier"] = sc["tier"]
        self.log("Triage: passed", "Guardrails clear. Data readiness " + js_str(t["ready"]["count"]) + " of " + js_str(t["ready"]["of"]) + ".", auto=True)
        raised = "".join(" Override: " + o["label"] + " raised the tier." for o in sc["overrides"] if o["raised"])
        self.log("Scored: " + TIER_LABEL[sc["tier"]], "Inherent " + js_str(sc["inherent"]) + ", residual " + js_str(sc["residual"]) + " after controls." + raised,
                 auto=True, to="vetting", due=due_for("vetting", sc["tier"], now, R))
        self.mail(self.lead["id"], "Ready for vetting: " + title + " (" + TIER_LABEL[sc["tier"]] + ")", "Vetting is due " + date_string(c["dueAt"]) + ".", "task")
        est = estimate_days(sc["tier"], R)
        around = date_string(now + est * DAY)
        self.mail(c["submitterId"], "Your use case is under review: " + title,
                  "It passed triage and was scored. The review has started.\nEstimated time to a decision: about " + js_str(est) + " days, around " + around
                  + ". This is a standard estimate of how long each review step normally takes. It was made without looking at the details of your case, so it can change with the details and with what the review and any expert consultations turn up.",
                  "notice",
                  {"banner": ["est", "Your use case is under review", "We have received it and the review has started."],
                   "facts": [["Estimated time to a final decision", "About " + js_str(est) + " days from now"], ["Expected around", around]],
                   "caveat": "This is a standard estimate of how long each review step normally takes. The turnaround may vary based on the details of your use case.",
                   "button": "Track your use case", "only": 1})

    # ------------------------------------------------------------------
    # Finishing a panel or executive review
    # ------------------------------------------------------------------

    def need_in(self, kind, how) -> None:
        """Check the decision has what it needs: a summary, and pilot or waiver terms and limits. JavaScript ``needIn``."""
        inp = self.inp
        if not self.rat and not (kind == "escalate" and how == "consensus"):
            raise EngineError("Write the summary for the submitter.")
        if kind in ("approve", "recommend"):
            if not text_or_blank(inp.get("scope")):
                raise EngineError("Pilot scope and conditions is required.")
            if not (to_num(inp.get("days", UNDEF)) > 0):
                raise EngineError("Pilot review days is required.")
        elif kind == "waive" and not text_or_blank(inp.get("waiver")):
            raise EngineError("Reason for waiving the pilot is required.")
        if kind in ("approve", "waive") and not text_or_blank(inp.get("limits")):
            raise EngineError("Production controls, conditions, and limits is required.")

    def panel_end(self, kind, how: str) -> None:
        """Carry out a panel decision. The reviewers' votes are archived first so Review history keeps every round. JavaScript ``panelEnd``."""
        c, inp, now = self.c, self.inp, self.now
        if kind == "approve" and c.get("tier") == "critical":
            kind = "recommend"  # on a Critical case the panel recommends and the executives decide
        self.need_in(kind, how)
        tx = self.how_txt(how)
        is_esc = kind == "escalate"
        self.archive_round("panel", kind, how, js_or(self.rat, self.note))
        rat = self.rat
        if kind == "approve":
            ov = self.collect_overrides()
            c["panelDecision"] = {"by": self.actor["id"], "at": now, "decision": "approve", "rationale": rat, "overrides": ov, "contributors": self.draft_touched(), **self.stamp(how)}
            c["reviewDraft"] = None
            self.start_pilot(js_str(inp.get("scope", UNDEF)).strip(), to_num(inp.get("days", UNDEF)))
            at = self.record_acceptance(c["pilot"]["scope"])
            self.log("Panel decision: approved for pilot", rat + at + self.ov_note(ov) + tx, to="pilot", due=c["pilot"]["reviewDueAt"], tag="approve")
            self.approval_notice("approved for pilot by the panel", rat, ov)
        elif kind == "waive":
            ov = self.collect_overrides()
            c["panelDecision"] = {"by": self.actor["id"], "at": now, "decision": "approve-waive", "rationale": rat, "overrides": ov, "contributors": self.draft_touched(), **self.stamp(how)}
            c["reviewDraft"] = None
            c["pilot"] = {"waived": True, "waiverReason": js_str(inp.get("waiver", UNDEF)).strip()}
            at = self.record_acceptance("Production")
            self.to_production("Pilot waived")
            self.log("Panel decision: approved, pilot waived", rat + " Waiver: " + c["pilot"]["waiverReason"] + at + self.ov_note(ov) + tx,
                     to="production", due=c["production"]["nextReviewAt"], tag="waive")
            self.approval_notice("approved by the panel with the pilot waived", rat, ov)
        elif kind in ("recommend", "escalate"):
            self.panel_to_execs(is_esc, how)
        elif kind == "remediate":
            suffix = " (deadlock broken)" if how == "deadlock" else " (quorum waived)" if how == "quorum" else ""
            self.bounce("panel", rat, "Panel decision: remediate" + suffix, tx)
        else:
            self.close("panel", rat, "Panel decision: rejected" + (" (quorum waived)" if how == "quorum" else ""), tx)

    def panel_to_execs(self, is_esc: bool, how: str) -> None:
        """The panel recommends approval (Critical cases) or escalates; the executives get a briefing pack. Part of JavaScript ``panelEnd``."""
        c, R, inp, now = self.c, self.R, self.inp, self.now
        rat = self.rat
        ovr = [] if is_esc else self.collect_overrides()
        rat2 = js_or(self.note, rat) if is_esc else rat
        c["panelDecision"] = {"by": self.actor["id"], "at": now, "decision": "escalate" if is_esc else "recommend", "rationale": rat2, "overrides": ovr,
                              "contributors": self.draft_touched(), **self.stamp(how)}
        c["recommendedPilot"] = None if is_esc else {"scope": js_str(inp.get("scope", UNDEF)).strip(), "days": to_num(inp.get("days", UNDEF))}
        sc, form = c["scoring"], c["form"]
        v = num_or_zero(form.get("valueUSD", UNDEF))
        cost = num_or_zero(form.get("costUSD", UNDEF))
        ongoing = num_or_zero(form.get("ongoingCostUSD", UNDEF))
        svb = support_view(c, R)
        rb = three_year_roi(form)
        bf = budget_flag(form, R)
        raised = [o["label"] for o in sc["overrides"] if o["raised"]]
        smes = [k for k in c["consults"] if k.get("kind") == "sme"]
        bdata = {
            "title": c.get("title", UNDEF), "id": c["id"], "solution": js_or(form.get("solution"), "Not provided"), "tier": c.get("tier", UNDEF),
            "inherent": sc.get("inherent", UNDEF), "supportedN": sum(1 for r in svb["rows"] if r["status"] in ("confirmed", "evidence")), "claimedN": len(svb["rows"]),
            "net": svb["net"], "netTier": svb["netTier"], "valueUSD": v, "costUSD": cost, "ongoingUSD": ongoing,
            "ongoingBasis": ONGOING_BASIS.get(form.get("ongoingBasis"), ""), "budgetSource": js_or(form.get("budgetSource"), "an unnamed budget"),
            "budgetNote": "Budget scrutiny applies: per-user cost is above $" + js_str(bf["limit"]) + " a month." if bf else "",
            "roiNet": rb.get("net", UNDEF), "roiPct": rb.get("roi", UNDEF), "roiReason": js_or(rb.get("reason"), ""), "minTier": raised,
            "experts": [{"title": by_id(k.get("personId"))["title"], "name": by_id(k.get("personId"))["name"],
                         "stance": k["response"].get("stance", UNDEF) if truthy(k.get("response")) else "pending",
                         "text": k["response"].get("text", UNDEF) if truthy(k.get("response")) else ""} for k in smes],
            "stakeholders": [{"title": by_id(k.get("personId"))["title"], "name": by_id(k.get("personId"))["name"], "stance": k["response"].get("stance", UNDEF),
                              "text": k["response"].get("text", UNDEF)} for k in c["consults"] if k.get("kind") == "stakeholder" and truthy(k.get("response"))],
            "panelRec": rat2, "escalated": is_esc,
        }
        experts = "; ".join(by_id(k.get("personId"))["title"] + " " + (js_str(_STANCE_WORDS.get(k["response"].get("stance"), UNDEF)) if truthy(k.get("response")) else "pending") for k in smes)
        lines = [
            "Use case: " + js_str(c.get("title", UNDEF)) + " (" + c["id"] + ")",
            "Proposed solution: " + js_str(js_or(form.get("solution"), "Not provided")),
            "Tier: " + js_str(TIER_LABEL.get(c.get("tier"), UNDEF)) + ". Inherent risk " + js_str(sc.get("inherent", UNDEF)) + ", residual " + js_str(sc.get("residual", UNDEF))
            + " after " + str(len(form.get("controls") or [])) + " controls.",
            "Value and cost: Estimated annual value $" + to_locale(v) + " against one-time cost $" + to_locale(cost) + " and ongoing cost $" + to_locale(ongoing) + " "
            + ONGOING_BASIS.get(form.get("ongoingBasis"), "") + ", paid from " + js_str(js_or(form.get("budgetSource"), "an unnamed budget"))
            + (". Budget scrutiny applies: per-user cost is above $" + js_str(bf["limit"]) + " a month" if bf else "") + ".",
            "Minimum tier rules applied: " + ("; ".join(raised) or "none") + ".",
            "Expert responses: " + (experts or "none requested") + ".",
            ("Panel escalation: the panel asks the executives to decide. " + js_str(rat2)) if is_esc else "Panel recommendation: approve for pilot. " + rat,
        ]
        c["briefing"] = {"at": now, "data": bdata, "lines": lines}
        self.log("Panel decision: escalated to the executives" if is_esc else "Panel decision: recommends approval", js_str(rat2) + self.ov_note(ovr) + self.how_txt(how),
                 to="exec", due=due_for("exec", c.get("tier"), now, R), tag="recommend")
        c["readyBy"] = None
        self.mail([p["id"] for p in with_role("exec")], "Executive decision needed: " + js_str(c.get("title", UNDEF)),
                  "A briefing pack is attached to the case. Decision due " + date_string(c["dueAt"]) + ".", "task")

    def exec_end(self, kind, how: str) -> None:
        """Carry out an executive decision. JavaScript ``execEnd``."""
        c, inp, now = self.c, self.inp, self.now
        self.need_in("approve" if kind == "approve" else kind, how)
        if not self.rat:
            raise EngineError("Write the summary for the submitter.")
        rat = self.rat
        tx = self.how_txt(how)
        voters = [v["by"] for v in self.vote_summary() if v["dec"] != "abstain"]
        self.archive_round("exec", kind, how, rat)
        ov = self.collect_overrides() if kind in ("approve", "waive") else []
        c["execDecision"] = {"by": self.actor["id"], "at": now, "present": voters, "decision": "approve-waive" if kind == "waive" else kind, "rationale": rat,
                             "overrides": ov, "contributors": self.draft_touched(), "how": how, "votes": self.vote_summary()}
        if kind in ("approve", "waive"):
            c["reviewDraft"] = None
        if kind == "approve":
            self.start_pilot(js_str(inp.get("scope", UNDEF)).strip(), to_num(inp.get("days", UNDEF)))
            at = self.record_acceptance(c["pilot"]["scope"])
            self.log("Executive decision: approved for pilot", rat + at + self.ov_note(ov) + tx, to="pilot", due=c["pilot"]["reviewDueAt"], tag="approve")
            self.approval_notice("approved for pilot by the executives", rat, ov)
        elif kind == "waive":
            c["pilot"] = {"waived": True, "waiverReason": js_str(inp.get("waiver", UNDEF)).strip()}
            at = self.record_acceptance("Production")
            self.to_production("Pilot waived")
            self.log("Executive decision: approved, pilot waived", rat + " Waiver: " + c["pilot"]["waiverReason"] + at + self.ov_note(ov) + tx,
                     to="production", due=c["production"]["nextReviewAt"], tag="waive")
            self.approval_notice("approved by the executives with the pilot waived", rat, ov)
        elif kind == "remediate":
            self.bounce("exec", rat, "Executive decision: remediate" + (" (deadlock broken)" if how == "deadlock" else ""), tx)
        else:
            self.close("exec", rat, "Executive decision: rejected", tx)

    # ------------------------------------------------------------------
    # The actions
    # ------------------------------------------------------------------

    def apply(self):
        """Run the action. Returns a finished case only for "remind", which seals its own result; otherwise None."""
        handler = getattr(self, "do_" + self.id, None)
        if handler is None:
            raise EngineError("Unknown action.")
        return handler()

    def check_confirmers(self) -> None:
        """The submitter and owner cannot confirm their own case, and confirmers must be independent (B-36)."""
        c = self.c
        sc0 = self_confirmed(c, self.R)
        if sc0:
            raise EngineError("The submitter and the owner cannot confirm their own use case. Name someone else for: " + ", ".join(sc0) + ".")
        blocks = [duty_block(c, (c["form"].get("attesters") or {}).get(cid), "confirm") for cid in c["form"].get("controls") or []]
        first = next((b for b in blocks if b), None)
        if first:
            raise EngineError(first + " Name someone else.")

    def merge_form(self) -> None:
        """Copy typed form fields onto the case form (JavaScript ``Object.assign(c.form, input.form || {})``)."""
        self.c["form"].update(js_or(self.inp.get("form"), {}))

    # ---- Suggestion and use case ----

    def do_ask_adviser(self):
        c = self.c
        gaps = [n["text"] for n in unclaimed_required(c.get("form") or {}, self.R)]
        h = {"id": "h" + str(len(c.get("helpRequests") or []) + 1), "by": self.actor["id"], "at": self.now, "message": text_or_blank(self.inp.get("message")),
             "controls": gaps, "status": "open"}
        c["helpRequests"] = js_or(c.get("helpRequests"), []) + [h]
        ad = js_or(c.get("adviserId"), lead_id())
        title = js_str(c.get("title", UNDEF))
        # This email has no rich layout, so unlike the others it has no "x" key at all.
        c["outbox"].append({"ts": self.now, "n": len(c["outbox"]), "to": [ad], "subject": "Help requested: " + title,
                            "body": self.actor["name"] + ' asks for your help with "' + title + '".' + (" " + h["message"] if h["message"] else "")
                            + (" Required controls not yet claimed: " + "; ".join(gaps) + "." if gaps else ""), "kind": "task", "auto": True})
        self.log("Help requested", "Asked " + by_id(ad)["name"] + (". " + h["message"] if h["message"] else "."))

    def do_help_done(self):
        for h in self.c.get("helpRequests") or []:
            if h.get("status") == "open":
                h["status"] = "done"
                h["doneBy"] = self.actor["id"]
                h["doneAt"] = self.now
        self.log("Help given", js_or(self.note, "The adviser marked the help request done."))

    def do_set_adviser(self):
        adviser = self.inp.get("adviser")
        self.c["adviserId"] = adviser
        self.log("Adviser changed", by_id(adviser)["name"] + " is now the adoption adviser.")
        if adviser != self.actor["id"]:
            self.mail(adviser, "You are now the adviser: " + js_str(self.c.get("title", UNDEF)), self.actor["name"] + " named you the adoption adviser for this case.", "notice")

    def do_develop(self):
        c = self.c
        c["returned"] = None
        self.log("Developed into a use case", self.note, to="use_case", due=None)
        if self.actor["id"] != c.get("submitterId"):
            self.mail(c["submitterId"], "Your suggestion is being developed: " + js_str(c.get("title", UNDEF)),
                      self.actor["name"] + " is helping shape it into a use case. Please complete the details.", "notice", None, skip_actor=True)

    def do_save_draft(self):
        c = self.c
        self.merge_form()
        self.sync_unit()
        sync_owner(c)
        c["updatedAt"] = self.now
        for a in c.get("attestations") or []:
            if (c["form"].get("attesters") or {}).get(a.get("controlId")) == a.get("personId"):
                a["evidence"] = text_or_blank((c["form"].get("evidence") or {}).get(a.get("controlId")))

    def do_submit(self):
        """Submit for triage (the owner), or ask the owner to sign off (anyone else). Also handles signoff_accept."""
        c, actor, now = self.c, self.actor, self.now
        if truthy(self.inp.get("ipAck")):
            c["ipAcks"] = js_or(c.get("ipAcks"), []) + [{"by": actor["id"], "at": now}]
        self.merge_form()
        self.sync_unit()
        sync_owner(c)
        c["updatedAt"] = now
        bl = training_blocks(self.ctx.get("training"), actor, self.R, now)
        if bl:
            raise EngineError(training_msg(bl))
        oid = owner_of(c)
        op = by_id(oid)
        self.check_confirmers()
        if self.id == "submit" and oid == actor["id"]:
            c["ownerAccepted"] = {"by": actor["id"], "at": now}
            c["signoff"] = None
            c["returned"] = None
            self.submit_for_triage()
            return
        if self.id == "signoff_accept":
            c["form"]["ownerId"] = actor["id"]
            sync_owner(c)
            c["ownerAccepted"] = {"by": actor["id"], "at": now}
            ch = changed_fields(self.c0["form"], c["form"])
            c["signoff"] = {**(c.get("signoff") or {}), "status": "accepted", "decidedAt": now}
            c["returned"] = None
            self.log("Owner accepted and submitted", "The owner edited: " + ", ".join(ch) + "." if ch else "No edits.")
            self.submit_for_triage()
            return
        if not truthy(oid) or op.get("role") not in OWNER_ROLES:
            raise EngineError("Pick the owner who will sign off.")
        if oid == actor["id"]:
            raise EngineError("You are the owner, so submit directly.")
        c["returned"] = None
        c["signoff"] = {"status": "requested", "ownerId": oid, "requestedBy": actor["id"], "at": now}
        self.log("Owner sign-off requested", "Sent to " + op["name"] + ". The draft is locked to the owner until they accept or decline.")
        self.mail(oid, "Sign-off requested: " + js_str(c.get("title", UNDEF)),
                  actor["name"] + " asks you to accept ownership of this use case and submit it for triage. You can edit the draft first. The review clock starts only when it is submitted.", "task")

    do_signoff_accept = do_submit

    def do_request_confirmations(self):
        c = self.c
        self.merge_form()
        sync_owner(c)
        c["updatedAt"] = self.now
        if not any(truthy(v) for v in (c["form"].get("attesters") or {}).values()):
            raise EngineError("Name a confirmer on at least one claimed control first.")
        self.check_confirmers()
        self.build_atts()
        names = unique(by_id(a.get("personId"))["name"] for a in c["attestations"])
        n = len(c["attestations"])
        self.log("Confirmation requested", "Asked " + ", ".join(names) + " to confirm " + str(n) + " control" + ("s" if n > 1 else "")
                 + " before submission. They can respond any time before approval.")

    def claimed_control(self) -> dict:
        """The control named in the input, which must be claimed on this case."""
        k = next((x for x in self.R["controls"] if x["id"] == self.inp.get("controlId")), None)
        if not k or k["id"] not in (self.c["form"].get("controls") or []):
            raise EngineError("Pick one of the controls claimed on this case.")
        return k

    def do_add_evidence(self):
        c, inp = self.c, self.inp
        k = self.claimed_control()
        url = text_or_blank(inp.get("url"))
        file_id = js_or(inp.get("fileId"), "")
        if not url and not truthy(file_id):
            raise EngineError("Add a link or a file.")
        if url and not _URL.match(url):
            raise EngineError("A link must start with http:// or https://.")
        if truthy(file_id):
            size = to_num(inp.get("size", UNDEF))
            if not (size > 0) or size > EVIDENCE_MAX:
                raise EngineError("A file can be up to " + js_str(js_round(EVIDENCE_MAX / 1024)) + " KB.")
            if not EVIDENCE_EXT.search(js_str(js_or(inp.get("fileName"), ""))):
                raise EngineError("This file type is not accepted. Use one of: " + EVIDENCE_TYPES + ".")
        is_file = truthy(file_id)
        it = {"id": "e" + str(len(c.get("evidenceItems") or []) + 1), "controlId": k["id"], "kind": "file" if is_file else "link",
              "name": js_str(inp.get("fileName", UNDEF)) if is_file else url, "url": "" if is_file else url, "fileId": file_id,
              "size": to_num(inp.get("size", UNDEF)) if is_file else 0, "type": js_str(js_or(inp.get("type"), "")), "note": text_or_blank(inp.get("note")),
              "by": self.actor["id"], "at": self.now}
        c["evidenceItems"] = js_or(c.get("evidenceItems"), []) + [it]
        self.log("Evidence added", k["text"] + ": " + ("file " if is_file else "link ") + it["name"] + (". " + it["note"] if it["note"] else ""))

    def do_remove_control(self):
        c = self.c
        k = self.claimed_control()
        if ctl_applies(k, c["form"], self.R):
            raise EngineError("This control still applies to the answers, so it cannot be removed here.")
        gone = [a for a in (c.get("attestations") or []) if a.get("controlId") == k["id"]]
        if not truthy(c.get("removedControls")):
            c["removedControls"] = []
        c["removedControls"].append({"controlId": k["id"], "attestations": gone, "evidence": js_or((c["form"].get("evidence") or {}).get(k["id"]), ""),
                                     "at": self.now, "by": self.actor["id"]})
        for a in gone:
            if a.get("status") == "pending":
                self.no_longer_needed(a)
        c["form"]["controls"] = [x for x in c["form"]["controls"] if x != k["id"]]
        if isinstance(c["form"].get("attesters"), dict):
            c["form"]["attesters"].pop(k["id"], None)
        c["attestations"] = [a for a in (c.get("attestations") or []) if a.get("controlId") != k["id"]]
        self.rescore_controls()
        pending = any(a.get("status") == "pending" for a in gone)
        self.log("Control removed", k["text"] + " no longer applied to the answers" + (". The confirmer was told their input is no longer needed." if pending else "."))

    def rescore_controls(self):
        """Update only the control credit and residual score, keeping the inherent score and tier."""
        c = self.c
        if not truthy(c.get("scoring")):
            return None
        sc = run_scoring(c["form"], self.R, c.get("attestations"))
        c["scoring"] = {**c["scoring"], "controlCredit": sc["controlCredit"], "withheld": sc["withheld"], "inapplicable": sc["inapplicable"],
                        "residual": sc["residual"], "residualTier": sc["residualTier"]}
        return sc

    def do_remove_evidence(self):
        c = self.c
        it = next((e for e in (c.get("evidenceItems") or []) if e.get("id") == self.inp.get("evidenceId") and not truthy(e.get("removed"))), None)
        if not it:
            raise EngineError("That evidence is already removed.")
        it["removed"] = {"by": self.actor["id"], "at": self.now}
        self.log("Evidence removed", js_str(self.control_text(it.get("controlId"))) + ": " + js_str(it.get("name", UNDEF)))

    def do_withdraw_signoff(self):
        self.c["signoff"] = None
        self.log("Sign-off request withdrawn", self.note)

    def do_signoff_decline(self):
        c = self.c
        c["signoff"] = {**(c.get("signoff") or {}), "status": "declined", "reason": self.note, "decidedAt": self.now}
        c["returned"] = {"from": "owner", "reason": self.note, "at": self.now}
        self.log("Owner declined sign-off", self.note, tag="remediate")
        self.mail(c["submitterId"], "Owner declined sign-off: " + js_str(c.get("title", UNDEF)), self.note, "return", None, skip_actor=True)

    # ---- Vetting ----

    def do_vet_approve(self):
        c = self.c
        c["vetting"] = {"by": self.actor["id"], "at": self.now, "note": self.note}
        at = self.record_acceptance("Production")
        self.to_production("Approved at vetting")
        self.log("Vetting: approved to production", self.note + at, to="production", due=c["production"]["nextReviewAt"], tag="approve")
        self.approval_notice("approved to production at vetting", self.note, [])

    def do_vet_to_panel(self):
        c, R, now, note = self.c, self.R, self.now, self.note
        nt = js_str(js_or(self.inp.get("raiseTo"), ""))
        tier = c.get("tier")
        title = js_str(c.get("title", UNDEF))
        if tier == "low" and not note:
            raise EngineError("Say why you are sending a Low case to the panel.")
        if nt:
            if t_idx(nt) <= t_idx(tier):
                raise EngineError("Pick a tier above " + js_str(TIER_LABEL.get(tier, UNDEF)) + ", or leave the tier as it is.")
            if not note:
                raise EngineError("Say why you are raising the tier.")
            c["vetting"] = {"by": self.actor["id"], "at": now, "note": note, "raisedTo": nt, "raisedFrom": tier}
            c["tier"] = nt
            self.log("Vetting: tier raised to " + TIER_LABEL[nt] + ", sent to panel", js_str(TIER_LABEL.get(tier, UNDEF)) + " to " + TIER_LABEL[nt] + ". " + note,
                     to="panel", due=due_for("panel", nt, now, R), tag="raise")
            self.mail(self.panel_people, "Panel review: " + title + " (" + TIER_LABEL[nt] + ")", "The governance lead raised the tier. " + note, "task")
        else:
            c["vetting"] = {"by": self.actor["id"], "at": now, "note": note}
            self.log("Vetting: sent to standing panel", note, to="panel", due=due_for("panel", tier, now, R))
            self.mail(self.panel_people, "Panel review: " + title + " (" + js_str(TIER_LABEL.get(tier, UNDEF)) + ")",
                      "Panel review is due " + date_string(c["dueAt"]) + "." + (" " + note if note else ""), "task")
        for kid in _concat(js_or(self.inp.get("cancelPending"), [])):
            i = next((j for j, k in enumerate(c["consults"]) if k.get("id") == kid and k.get("status") == "pending"), -1)
            if i < 0:
                continue
            k = c["consults"].pop(i)
            who = (" (" + ("required expert" if k.get("required") is not False else "expert") + ")") if k.get("kind") == "sme" else " (process stakeholder)"
            self.log("Consult request cancelled", by_id(k.get("personId"))["name"] + who + ", asked " + date_string(k.get("requestedAt", UNDEF)) + ".")
            self.mail(k.get("personId"), "No longer needed: " + title,
                      'You do not need to answer the earlier request on "' + title + '" now. The lead cancelled it after the use case was sent back.', "notice")
        self.reconsult(self.inp.get("again"))

    def do_vet_remediate(self):
        self.bounce("vetting", self.note, "Vetting: remediate")

    # ---- Consults ----

    def do_consult(self):
        c, R, inp, now = self.c, self.R, self.inp, self.now
        need = {} if truthy(c.get("legacy")) else consult_needs(c["form"], R)
        required_pids = [n["personId"] for n in need.values() if n["level"] == "required"]
        forced_all = set(required_pids)
        forced = [pid for pid in required_pids if not any(k.get("personId") == pid for k in c["consults"])]
        areas = R.get("consultAreas") or []
        area_by_pid: dict = {}

        def area_for(x):
            return next((a for a in areas if a["id"] == x), None) or next((a for a in areas if a.get("personId") == x), None)

        def to_pid(x):
            """The form may name an area or a person; either way, return the person."""
            a = area_for(x)
            if a:
                area_by_pid[a["personId"]] = a
                return a["personId"]
            return x

        for n in need.values():
            a = next((x for x in areas if x["id"] == n["id"]), None)
            if a:
                area_by_pid[a["personId"]] = a
        asked_before = lambda pid: any(k.get("personId") == pid for k in c["consults"])  # noqa: E731
        smes_in = [pid for pid in map(to_pid, js_or(inp.get("smes"), [])) if asked_before(pid) or not duty_block(c, pid, "expert")]
        for pid in forced:
            if pid not in smes_in and not duty_block(c, pid, "expert"):
                smes_in.append(pid)
        for pid in map(to_pid, js_or(inp.get("smes"), [])):
            if not asked_before(pid):
                b0 = duty_block(c, pid, "expert")
                if b0:
                    raise EngineError(b0)
        stakeholders = js_or(inp.get("stakeholders"), [])
        for pid in stakeholders:
            b1 = duty_block(c, pid, "stakeholder")
            if b1:
                raise EngineError(b1)
        req_set = set(([] if "reqSmes" not in inp else [to_pid(x) for x in inp["reqSmes"]]) + forced)
        if not smes_in and not stakeholders and not js_or(inp.get("again"), []):
            raise EngineError("Pick at least one expert or stakeholder.")
        due = self.consult_due()
        names, changed, qs = [], [], []

        def q_for(pid) -> str:
            a = area_by_pid.get(pid)
            qm = js_or(inp.get("questions"), {})
            return js_str(js_or(qm.get(a["id"]) if a else None, qm.get(pid), inp.get("question"), a.get("question") if a else None, "")).strip()

        for pid in smes_in + list(stakeholders):
            old = next((k for k in c["consults"] if k.get("personId") == pid and k.get("status") == "pending"), None)
            if old:
                # Already asked: the lead may only change whether this expert holds the decision.
                if old.get("kind") == "sme" and "reqSmes" in inp and pid not in forced_all:
                    want = pid in req_set
                    if (old.get("required") is not False) != want:
                        old["required"] = want
                        changed.append(by_id(pid)["name"] + (": now holds the decision" if want else ": no longer holds the decision"))
                continue
            if asked_before(pid):
                continue
            if not q_for(pid):
                raise EngineError("Add a question for " + by_id(pid)["name"] + ".")
            p = by_id(pid)
            kind = "sme" if p["role"] == "sme" else "stakeholder"
            req = pid in req_set
            c["consults"].append({"id": self.next_kid(), "kind": kind, "personId": pid,
                                  "areaId": area_by_pid[pid]["id"] if kind == "sme" and pid in area_by_pid else None, "question": q_for(pid),
                                  "requestedAt": now, "dueAt": due if kind == "sme" else None, "status": "pending", "reminders": 0,
                                  "required": req if kind == "sme" else False})
            names.append(p["name"])
            qs.append(p["name"] + ": " + q_for(pid))
            title = js_str(c.get("title", UNDEF))
            if kind == "sme":
                self.mail(pid, "Consult requested: " + title,
                          "A response is " + ("required" if req else "requested") + " by " + date_string(due) + "." + (" The decision waits on it." if req else "") + " " + q_for(pid), "consult",
                          {"due": [("A response is required by " if req else "A response is requested by ") + date_string(due) + ".",
                                   "The decision waits on it." if req else "It does not hold up the decision."],
                           "intro": self.actor["name"] + " (" + role_name(self.actor) + ") is asking for your expert view on this use case.",
                           "notes": [["The governance lead's question", q_for(pid), "ask"]], "button": "Open the case and respond", "only": 1})
            else:
                self.mail(pid, "Your input is welcome: " + title,
                          "Please share feedback on business value, risks and concerns. No reply will block the decision. " + q_for(pid), "consult",
                          {"intro": self.actor["name"] + " would like your feedback on this use case. It covers business value, risks and concerns. No reply will block the decision.",
                           "notes": [["Context", q_for(pid), "ask"]], "button": "Open the case and respond", "only": 1})
        re_names = self.reconsult(inp.get("again"))
        if not names and not changed and not re_names:
            raise EngineError("Everyone selected already has a pending request.")
        if not names and not changed:
            return
        text = (" | ".join(qs) if names else "") + (" | " if names and changed else "") + "; ".join(changed)
        self.log("Consult and notify" if names else "Consult: hold changed", text)

    def do_respond(self):
        c = self.c
        k = next(x for x in c["consults"] if x.get("personId") == self.actor["id"] and x.get("status") == "pending")
        k["status"] = "responded"
        k["response"] = {"stance": self.inp.get("stance", UNDEF), "text": js_str(self.inp.get("text", UNDEF)).strip(), "at": self.now}
        k["formSnap"] = clone(c["form"])
        self.log(("Expert responded" if k.get("kind") == "sme" else "Stakeholder feedback") + ": " + js_str(_STANCE_WORDS.get(self.inp.get("stance"), UNDEF)), k["response"]["text"])
        self.mail(self.lead["id"], "Response received: " + js_str(c.get("title", UNDEF)), self.actor["name"] + ": " + k["response"]["text"], "notice")

    def do_remind(self):
        picked = _concat(js_or(self.inp.get("whoE"), []), js_or(self.inp.get("whoS"), []), js_or(self.inp.get("whoC"), []))
        if not picked:
            raise EngineError("Tick at least one person to remind.")
        r = remind_case(self.c0, self.ctx, self.actor, picked)
        if not r:
            raise EngineError("Nothing to remind.")
        return r

    # ---- Panel and executive review ----

    def do_review_draft(self):
        self.save_draft()
        self.log("Approval draft saved", "Saved changes to the shared approval draft without approving.")

    def do_rv_vote(self):
        c, R, inp, now = self.c, self.R, self.inp, self.now
        is_exec = c["stage"] == "exec"
        key = vote_key(c)
        dec = js_str(js_or(inp.get("decision"), ""))
        crit = c.get("tier") == "critical"
        kinds = (["approve", "waive", "remediate", "reject"] if is_exec else
                 ["approve"] + ([] if crit else ["waive"]) + ["remediate", "reject"] + ([] if crit else ["escalate"]) + ["abstain", "await"])
        if dec not in kinds:
            raise EngineError("Choose your decision.")
        text = text_or_blank(inp.get("text"))
        if not text and dec != "abstain":
            raise EngineError("Write your review note.")
        if dec in FIRMABLE and inp.get("strength") not in ("firm", "leaning"):
            raise EngineError("Say whether this is a firm decision or a leaning.")
        r0 = rev_ready(self.c0, R)
        was_ok = bool(r0 and r0["ok"])
        if not truthy(c.get(key)):
            c[key] = clone(rev_votes(c))
        self.save_draft()
        firm = dec in FIRMABLE and inp.get("strength") == "firm"
        if firm:
            bt = [] if is_exec else rev_blockers(c, R)["hard"]
            if bt:
                raise EngineError("You cannot hold a firm decision yet. " + " ".join(bt) + " Record it as leaning, ask to wait for input, or abstain.")
            if not truthy(inp.get("__seed")):
                g = terms_gaps(c, R, dec)
                if g:
                    raise EngineError("Complete these before you hold an approval firm: " + "; ".join(g) + ".")
        prev = c[key].get(self.actor["id"])
        v = {"dec": dec, "firm": firm, "at": now}
        if firm:
            v["snap"] = terms_now(c, R)
        elif truthy(prev) and truthy(prev.get("snap")):
            v["snap"] = prev["snap"]
        if truthy(prev) and truthy(prev.get("lastMailAt")):
            v["lastMailAt"] = prev["lastMailAt"]
        if dec == "await":
            v["awaitIds"] = _concat(js_or(inp.get("awaitIds"), []))
            v["awaitReq"] = len(rev_blockers(c, R)["pend"]) > 0
        c[key][self.actor["id"]] = v
        c["panelNotes"] = [n for n in (c.get("panelNotes") or []) if n.get("by") != self.actor["id"]]
        if text:
            c["panelNotes"].append({"by": self.actor["id"], "at": now, "lean": dec, "firm": firm, "text": text})
        what = ("abstained" if dec == "abstain" else "awaiting input" if dec == "await"
                else ("firm " if firm else "leaning ") + dec_label(dec, c.get("tier"), c["stage"]).lower())
        self.log(("Executive note: " if is_exec else "Panel note: ") + what, text)
        r1 = rev_ready(c, R)
        if r1 and r1["ok"]:
            c["readyBy"] = c["readyBy"] if was_ok and truthy(c.get("readyBy")) else {"by": self.actor["id"], "at": now, "declined": False}
        else:
            c["readyBy"] = None

    def do_rv_decline(self):
        c = self.c
        c["readyBy"] = {**(c.get("readyBy") or {}), "by": self.actor["id"], "declined": True}
        ld = with_role("lead")[0] if with_role("lead") else None
        if ld and ld["id"] != self.actor["id"]:
            d = dec_label((rev_ready(c, self.R) or {}).get("dec", UNDEF), c.get("tier"))
            self.mail(ld["id"], "Ready to finalize: " + js_str(c.get("title", UNDEF)), 'The reviewers agree on "' + js_str(d) + '". ' + self.actor["name"] + " left the finalizing to you.", "task",
                      {"banner": ["ask", "Ready to finalize", "The reviewers agree. " + self.actor["name"] + " left the finalizing to you."],
                       "notes": [["The decision", d, "note"]], "button": "Open the case and finalize", "only": 1})
        self.log("Panel note: ready to finalize", self.actor["name"] + " saved without finalizing.")

    def do_panel_approve(self):
        self.panel_end("approve", "consensus")

    def do_panel_waive(self):
        self.panel_end("waive", "consensus")

    def do_panel_recommend(self):
        self.panel_end("recommend", "consensus")

    def do_panel_escalate(self):
        self.panel_end("escalate", "consensus")

    def do_panel_remediate(self):
        self.panel_end("remediate", "consensus")

    def do_panel_reject(self):
        self.panel_end("reject", "consensus")

    def deadlock_outcome(self) -> str:
        """The chosen way out of a deadlock, which must be one of the allowed options."""
        dl = rev_deadlock(self.c0, self.R, self.now)
        outs = [o["v"] for o in deadlock_options(self.c0, dl)] if dl else []
        if js_str(js_or(self.inp.get("outcome"), "")) not in outs:
            raise EngineError("Choose how to resolve the deadlock.")
        return self.inp["outcome"]

    def do_panel_break(self):
        self.panel_end(self.deadlock_outcome(), "deadlock")

    def do_panel_waivequorum(self):
        wq = rev_quorum_waivable(self.c0, self.R)
        if not wq:
            raise EngineError("The quorum cannot be waived now.")
        self.panel_end(wq["dec"], "quorum")

    def do_exec_approve(self):
        self.exec_end("approve", "consensus")

    def do_exec_waive(self):
        self.exec_end("waive", "consensus")

    def do_exec_remediate(self):
        self.exec_end("remediate", "consensus")

    def do_exec_reject(self):
        self.exec_end("reject", "consensus")

    def do_exec_break(self):
        self.exec_end(self.deadlock_outcome(), "deadlock")

    # ---- Pilot and production ----

    def do_pilot_promote(self):
        c = self.c
        mt = self.record_meas()
        self.to_production("Promoted after pilot")
        self.log("Pilot review: promoted to production", self.note + mt, to="production", due=c["production"]["nextReviewAt"], tag="approve")
        self.mail(c["submitterId"], "Promoted to production: " + js_str(c.get("title", UNDEF)), js_or(self.note, "The pilot met its goals."), "decision")

    def do_pilot_rework(self):
        c = self.c
        mt = self.record_meas()
        c["pilot"]["reworks"] = js_or(c["pilot"].get("reworks"), 0) + 1
        c["pilot"]["reviewDueAt"] = self.now + 14 * DAY
        self.log("Pilot review: rework", self.note + mt, due=c["pilot"]["reviewDueAt"], tag="rework")
        self.mail(c["submitterId"], "Pilot needs rework: " + js_str(c.get("title", UNDEF)), self.note, "return")

    def do_pilot_escalate(self):
        c = self.c
        mt = self.record_meas()
        self.keep_approval()
        c["panelDecision"] = None
        c["panelNotes"] = []
        c["votes"] = {}
        c["xvotes"] = {}
        c["readyBy"] = None
        c["consults"] = []
        self.log("Pilot review: risk beyond approval, back to panel", self.note + mt, to="panel", due=due_for("panel", c.get("tier"), self.now, self.R), tag="escalate")
        self.mail(self.panel_people, "Back to panel from pilot: " + js_str(c.get("title", UNDEF)), self.note, "task")

    def do_pilot_reject(self):
        mt = self.record_meas()
        self.close("pilot", self.note + mt, "Pilot review: rejected")

    def do_monitor_ok(self):
        c = self.c
        mt = self.record_meas()
        bo = next((o for o in BIAS_OPTS if o[0] == self.inp.get("bias")), None)
        if not bo:
            raise EngineError("Choose how bias was reviewed.")
        prod = c["production"]
        prod["biasReviews"] = js_or(prod.get("biasReviews"), []) + [{"at": self.now, "by": self.actor["id"], "level": bo[0]}]
        prod["lastReviewAt"] = self.now
        prod["reviews"] = to_num(prod.get("reviews", UNDEF)) + 1
        prod["nextReviewAt"] = self.now + to_num(self.cadence()) * DAY
        self.log("Monitoring review: continue", self.note + mt + " Model bias review: " + bo[1] + ".", due=prod["nextReviewAt"])

    def do_monitor_reassess(self):
        mt = self.record_meas()
        self.bounce("monitoring", self.note + mt, "Material change: reassess")

    def do_log_measure(self):
        mt = self.record_meas()
        if not mt:
            raise EngineError("Enter at least one KPI result.")
        self.log("KPI results recorded", mt.strip())

    def do_renew_acceptance(self):
        c = self.c
        at = self.record_acceptance(c["acceptance"].get("scope", UNDEF) if truthy(c.get("acceptance")) else "Production")
        if truthy(c.get("production")):
            c["production"]["nextReviewAt"] = self.now + to_num(self.cadence()) * DAY
        self.log("Approval renewed", (self.note + " " if self.note else "") + at.strip(),
                 due=c["production"]["nextReviewAt"] if truthy(c.get("production")) else c.get("dueAt"))

    # ---- Confirmations and closed cases ----

    def do_attest(self):
        c = self.c
        mine = [a for a in (c.get("attestations") or []) if a.get("personId") == self.actor["id"] and a.get("status") == "pending"]
        before = c["scoring"].get("residual", UNDEF) if truthy(c.get("scoring")) else None
        bits = []
        for a in mine:
            a["status"] = "confirmed" if self.inp.get("d_" + js_str(a.get("controlId", UNDEF))) == "confirm" else "declined"
            a["at"] = self.now
            a["text"] = js_str(self.inp.get("text", UNDEF)).strip()
            bits.append(js_str(self.control_text(a.get("controlId"))) + ": " + a["status"])
        sc = self.rescore_controls()
        if sc is not None:
            res_txt = " Residual " + js_str(before) + (" unchanged." if before == sc["residual"] else " to " + js_str(sc["residual"]) + ".")
        else:
            res_txt = " Scoring happens at submission."
        n = len(c["attestations"])
        self.log("Control attestation", "; ".join(bits) + "." + res_txt + " " + str(n) + " attestation" + ("s" if n > 1 else "") + " on this case.")
        self.mail(self.lead["id"], "Control attestation: " + js_str(c.get("title", UNDEF)), self.actor["name"] + " " + "; ".join(bits) + ".", "notice")

    def do_allow_again(self):
        self.c["closed"] = {**(self.c.get("closed") or {}), "notPermitted": False}
        self.log('"Not permitted" removed', self.note)

    def do_reopen(self):
        self.c["closed"] = None
        self.c["returned"] = None
        self.log("Returned to the suggestion box", self.note, to="suggestion", due=None)

    # ------------------------------------------------------------------
    # Follow-ups every action shares (nobody is emailed twice for the same thing)
    # ------------------------------------------------------------------

    def follow_ups(self) -> None:
        c, c0, R, now = self.c, self.c0, self.R, self.now
        # "Ready to finalize" only lasts while the reviewers still agree and the terms are complete.
        if truthy(c.get("readyBy")) and not (rev_ready(c, R) or {}).get("ok"):
            c["readyBy"] = None
        # When what blocked the panel clears, every reviewer is told once.
        if c0.get("stage") == "panel" and c["stage"] == "panel" and self.id != "rv_vote":
            if rev_blockers(c0, R)["texts"] and not rev_blockers(c, R)["texts"]:
                pv = c.get("votes") if truthy(c.get("votes")) else {}
                for pid in rev_pool(c):
                    if truthy(pv.get(pid)):
                        pv[pid]["lastMailAt"] = now
                self.mail(rev_pool(c), "Nothing is holding the decision on " + c["id"] + " now",
                          'What held the decision on "' + js_str(c.get("title", UNDEF)) + '" has cleared. Please look at the case again and record a firm decision.', "task",
                          {"banner": ["ask", "The decision is unblocked", "The expert responses or reviewers it was waiting on are in. You can now hold a firm decision."],
                           "button": "Open the case and decide", "only": 1})
        # Reviewers who chose "awaiting input" are told when everything they waited for has arrived.
        if self.id in ("respond", "attest") and truthy(c.get("votes")):
            for pid, v in c["votes"].items():
                if v.get("dec") != "await" or not js_or(v.get("awaitIds"), []) or truthy(v.get("awaitNotified")):
                    continue
                still_open = [x for x in v["awaitIds"] if (
                    any("a:" + js_str(a.get("controlId", UNDEF)) == x and a.get("status") not in ("confirmed", "declined") for a in (c.get("attestations") or []))
                    if js_str(x).startswith("a:") else any(k.get("id") == x and k.get("status") == "pending" for k in (c.get("consults") or [])))]
                if not still_open:
                    v["awaitNotified"] = True
                    v["lastMailAt"] = now
                    self.mail([pid], "The input you waited for is in on " + c["id"],
                              'Everything you asked to wait for on "' + js_str(c.get("title", UNDEF)) + '" has come in. Please look at the case again and record your decision.', "task",
                              {"banner": ["ask", "The input you asked for has arrived", "Please look again and record your decision."], "button": "Open the case and decide", "only": 1})
