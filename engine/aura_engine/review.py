"""Panel and executive review: votes, quorum, what blocks a decision, deadlocks, approval terms, reminders.

How a review decides (B-56, B-61, B-69):

* Each reviewer records a decision (approve, waive the pilot, remediate, reject, escalate,
  abstain, or "awaiting input"), either firm or leaning, with a note. Votes are stored in
  ``c["votes"]`` for the panel and ``c["xvotes"]`` for the executives, keyed by person id.
* The case can be finalized when at least N reviewers (the quorum for the tier) hold the same
  firm decision and nobody holds a different one. Abstain and awaiting input never count.
* Required expert consults that are still open, or not yet requested, block firm decisions.
* Reviewers shape the approval terms together in a shared draft (``c["reviewDraft"]``). When
  someone changes the terms, other reviewers' firm decisions drop back to leaning.
* If reviewers disagree, the lead (panel) or any executive can break the deadlock, but nothing
  is ever approved over a dissent: a split with any remediate, reject or await goes back to the
  submitter.
"""

from __future__ import annotations

import math

from .audit import seal_audit
from .constants import DAY, by_id, with_role
from .consults import missing_required_consults
from .controls import loose_threads, parse_measures, thread_sig
from .errors import EngineError
from .jsx import UNDEF, clone, date_string, js_json, js_or, js_str, nullish, to_num, truthy, unique
from .people import duty_block

DEC_LABEL = {"approve": "Approve for pilot", "waive": "Approve and waive pilot", "remediate": "Remediate", "reject": "Reject",
             "escalate": "Send to executives", "abstain": "Abstain", "await": "Awaiting input"}
# Decisions that can be held firm and so can finalize a case.
FIRMABLE = ["approve", "waive", "remediate", "reject", "escalate"]


def dec_label(d, tier, stage=None) -> str:
    """A decision in words. On a Critical case the panel can only recommend approval. JavaScript ``decLabel``."""
    if tier == "critical" and d == "approve" and stage != "exec":
        return "Recommend approval"
    return js_or(DEC_LABEL.get(d), d)


def vote_key(c: dict) -> str:
    """Where this stage's votes live: ``xvotes`` for executives, ``votes`` for the panel. JavaScript ``voteKey``."""
    return "xvotes" if c.get("stage") == "exec" else "votes"


def rev_votes(c: dict) -> dict:
    """The current stage's votes, keyed by person id. JavaScript ``revVotes``.

    Returns the stored dict itself (callers in :mod:`perform` change it in place). Older cases only
    have panel notes with a leaning; those read as leaning decisions.
    """
    key = vote_key(c)
    if truthy(c.get(key)):
        return c[key]
    out = {}
    for n in c.get("panelNotes") or []:
        p = by_id(n.get("by")) or {}
        if (c.get("stage") == "exec") != (p.get("role") == "exec"):
            continue
        if n.get("lean") in ("approve", "remediate", "reject"):
            out[n["by"]] = {"dec": n["lean"], "firm": False, "at": n.get("at", UNDEF)}
    return out


def rev_pool(c: dict, stage=None) -> list[str]:
    """Who may review: executives at the executive stage, otherwise the lead and the panel, minus anyone blocked by separation of duties."""
    stage = js_or(stage, c.get("stage"))
    if stage == "exec":
        return [p["id"] for p in with_role("exec") if not duty_block(c, p["id"], "exec")]
    return [p["id"] for p in with_role("lead") + with_role("panel") if not duty_block(c, p["id"], "panel")]


def rev_need(c: dict, rules: dict, stage=None):
    """The quorum: how many firm reviewers a decision needs. A Low case uses the Moderate quorum. JavaScript ``revNeed``."""
    stage = js_or(stage, c.get("stage"))
    if stage == "exec":
        return rules["execQuorum"]
    t = c.get("tier")
    q = rules["quorum"]
    if not nullish(q.get(t)):
        return q[t]
    return q.get("moderate", UNDEF) if t == "low" else 0


def pending_required_experts(c: dict) -> list[dict]:
    """Expert consults that are still open and hold the decision."""
    return [k for k in (c.get("consults") or []) if k.get("kind") == "sme" and k.get("status") == "pending" and k.get("required") is not False]


def expert_names(consults: list[dict]) -> str:
    """'Name (Title), Name (Title)' for a list of consults."""
    return ", ".join(by_id(k.get("personId"))["name"] + " (" + js_or(by_id(k.get("personId")).get("title"), "expert") + ")" for k in consults)


def rev_blockers(c: dict, rules: dict) -> dict:
    """What stops reviewers from holding a firm decision right now. JavaScript ``revBlockers``.

    ``hard`` holds the blockers that stop a firm decision (open required experts, required consults
    not yet requested). ``texts`` adds a too-small reviewer pool. Missing stakeholder replies and
    silent confirmers never block.
    """
    none = {"texts": [], "hard": [], "pend": [], "missing": [], "poolShort": False}
    if c.get("stage") != "panel":
        return none
    pend = pending_required_experts(c)
    names = expert_names(pend)
    missing = missing_required_consults(c, rules, duty_block)
    v = rev_votes(c)
    pool = rev_pool(c)
    abst = sum(1 for pid in pool if truthy(v.get(pid)) and v[pid].get("dec") == "abstain")
    need = rev_need(c, rules)
    left = len(pool) - abst
    pool_short = left < need
    texts = []
    if pend:
        texts.append("Waiting on " + str(len(pend)) + " required expert response" + ("s" if len(pend) > 1 else "") + " from " + names + ".")
    if missing:
        texts.append("A required consult has not been requested yet: " + ", ".join(missing) + ". The lead uses Consult experts first.")
    hard = list(texts)
    if pool_short:
        texts.append("Only " + str(left) + " reviewer" + (" is" if left == 1 else "s are") + " available"
                     + (" (" + str(abst) + " abstained)" if abst else "") + " and this tier needs " + js_str(need) + ".")
    return {"texts": texts, "hard": hard, "pend": pend, "missing": missing, "poolShort": pool_short}


# ---- Approval terms the reviewers shape together ----

TERM_LABEL = {"scope": "Pilot scope and conditions", "days": "Pilot review days", "waiver": "Reason for waiving the pilot",
              "limits": "Production controls and conditions", "validDays": "Approval validity", "prodDays": "Production review period",
              "measures": "KPIs and stop limits", "overrides": "Accepted risks"}


def term_defaults(c: dict, rules: dict) -> dict:
    """Starting values for the approval terms. JavaScript ``termDefaults``."""
    rp = js_or(c.get("recommendedPilot"), {})
    ac = js_or(c.get("acceptance"), c.get("priorAcceptance"), {})
    tier = c.get("tier")
    return {
        "scope": js_or(rp.get("scope"), "" if c.get("stage") == "exec" else "Limited to one site and a small group of users."),
        "days": js_or(rp.get("days"), rules["pilotDays"].get(tier, UNDEF)), "waiver": "", "limits": js_or(ac.get("limits"), ""),
        "validDays": 365, "prodDays": rules["reviewCadenceDays"].get(tier, UNDEF),
        "measures": js_or(ac.get("measures"), c["form"].get("measures"), []),
    }


def terms_now(c: dict, rules: dict) -> dict:
    """The approval terms as they stand, tidied into comparable text. JavaScript ``termsNow``.

    Used to tell reviewers what changed since they held their decision firm.
    """
    d = term_defaults(c, rules)
    dr = c.get("reviewDraft")
    v = (dr.get("vals") if truthy(dr) else None) or {}
    t = {k: (v[k] if not nullish(v.get(k)) else d[k]) for k in d}
    for k in ("scope", "waiver", "limits", "days", "validDays", "prodDays"):
        t[k] = js_str("" if nullish(t[k]) else t[k]).strip()
    t["measures"] = [
        " | ".join([js_str(m["name"]).strip(), "higher" if m.get("dir") == "higher" else "lower",
                    js_str("" if nullish(m.get("target")) else m["target"]).strip(), js_str("" if nullish(m.get("stop")) else m["stop"]).strip()])
        for m in js_or(t["measures"], []) if truthy(m) and js_str(js_or(m.get("name"), "")).strip()
    ]
    ov = (dr.get("overrides") if truthy(dr) else None) or {}
    t["overrides"] = [k + " | " + ("accepted" if truthy(ov[k].get("on")) else "not accepted") + " | " + js_str(ov[k].get("reason", UNDEF))
                      for k in sorted(ov) if truthy(ov[k].get("on")) or truthy(ov[k].get("reason"))]
    return t


def terms_diff(a, b) -> list[dict]:
    """The terms that differ between two :func:`terms_now` results. JavaScript ``termsDiff``."""
    if not truthy(a) or not truthy(b):
        return []
    return [{"k": k, "label": TERM_LABEL[k], "from": a.get(k, UNDEF), "to": b.get(k, UNDEF)}
            for k in TERM_LABEL if js_json(a.get(k, UNDEF)) != js_json(b.get(k, UNDEF))]


def open_unaccepted(c: dict, rules: dict) -> list[dict]:
    """Open items nobody has accepted yet in the shared draft. JavaScript ``openUnaccepted``.

    At the executive stage, risks the panel accepted when recommending still count as accepted if
    the item has not changed.
    """
    if not truthy(c.get("scoring")):
        return []
    dr = c.get("reviewDraft")
    out = []
    for t in loose_threads(c, rules):
        o = ((dr.get("overrides") or {}).get(t["slug"]) if truthy(dr) and truthy(dr.get("overrides")) else None)
        if o and truthy(o.get("on")) and truthy(o.get("reason")) and o.get("sig") == thread_sig(t):
            continue
        pd = c.get("panelDecision")
        if (c.get("stage") == "exec" and truthy(pd) and pd.get("decision") == "recommend"
                and any(x.get("id") == t["id"] and x.get("kind") == t["kind"] and js_or(x.get("detail"), "") == js_or(t.get("detail"), "") for x in (pd.get("overrides") or []))):
            continue
        out.append(t)
    return out


def terms_gaps(c: dict, rules: dict, dec) -> list[str]:
    """What an approve or approve-and-waive still needs before anyone can hold it firm. JavaScript ``termsGaps``."""
    g: list[str] = []
    if dec not in ("approve", "waive"):
        return g
    t = terms_now(c, rules)
    if dec == "approve":
        if not t["scope"]:
            g.append(TERM_LABEL["scope"])
        if not (to_num(t["days"]) > 0):
            g.append(TERM_LABEL["days"])
    elif not t["waiver"]:
        g.append(TERM_LABEL["waiver"])
    dr = c.get("reviewDraft")
    draft_ms = ((dr.get("vals") or {}).get("measures") if truthy(dr) and truthy(dr.get("vals")) else None)
    try:
        ms = parse_measures(js_or(draft_ms, term_defaults(c, rules)["measures"]), True)
    except EngineError as e:
        g.append("KPIs and stop limits (" + e.message + ")")
        ms = None
    if ms is not None and not ms:
        g.append("At least one KPI with a target and a stop limit")
    if not t["limits"]:
        g.append(TERM_LABEL["limits"])
    if not (to_num(t["validDays"]) > 0):
        g.append(TERM_LABEL["validDays"])
    max_days = rules["reviewMaxDays"].get(c.get("tier"), UNDEF)
    pd = to_num(t["prodDays"])
    if not (pd > 0) or (max_days is not UNDEF and pd > to_num(max_days)):
        g.append(TERM_LABEL["prodDays"] + " (whole days, up to " + js_str(max_days) + ")")
    for x in open_unaccepted(c, rules):
        g.append("Accept or resolve: " + js_str(x.get("label", UNDEF)))
    return g


def _active(c: dict, rules: dict):
    """Votes, pool, quorum, and the pool members who voted something other than abstain."""
    v = rev_votes(c)
    pool = rev_pool(c)
    need = rev_need(c, rules)
    act = [{"id": pid, "v": v[pid]} for pid in pool if truthy(v.get(pid)) and v[pid].get("dec") != "abstain"]
    return v, pool, need, act


def rev_ready(c: dict, rules: dict):
    """The decision enough reviewers hold firm, with nobody holding another, or None. JavaScript ``revReady``.

    Returns ``{dec, firm, N, gaps, ok}``. ``ok`` is False while the approval terms still have gaps.
    """
    if c.get("stage") not in ("panel", "exec"):
        return None
    if rev_blockers(c, rules)["texts"]:
        return None
    _, _, need, act = _active(c, rules)
    if not act:
        return None
    dec = act[0]["v"].get("dec")
    if dec not in FIRMABLE or any(a["v"].get("dec") != dec for a in act):
        return None
    firm = sum(1 for a in act if truthy(a["v"].get("firm")))
    if firm < need:
        return None
    gaps = terms_gaps(c, rules, dec)
    return {"dec": dec, "firm": firm, "N": need, "gaps": gaps, "ok": not gaps}


def rev_deadlock(c: dict, rules: dict, now):
    """A disagreement among reviewers who have weighed in, or None. JavaScript ``revDeadlock``.

    Leaning votes count toward the quorum here; not having voted is not a disagreement. When
    everyone agrees but too few hold it firm and the deadline has passed, it counts as a "lean"
    deadlock that the lead may push through.
    """
    if c.get("stage") not in ("panel", "exec"):
        return None
    if rev_blockers(c, rules)["texts"]:
        return None
    _, _, need, act = _active(c, rules)
    if sum(1 for a in act if a["v"].get("dec") != "await") < need:
        return None
    decs = unique(a["v"].get("dec") for a in act)
    if len(decs) < 2:
        d = decs[0] if decs else UNDEF
        firm = sum(1 for a in act if truthy(a["v"].get("firm")))
        if d in FIRMABLE and firm < need and truthy(c.get("dueAt")) and now is not None and now >= c["dueAt"]:
            return {"decs": decs, "act": act, "N": need, "lean": True}
        return None
    return {"decs": decs, "act": act, "N": need}


def deadlock_options(c: dict, dl: dict) -> list[dict]:
    """What the person breaking a deadlock may choose. Nothing is approved over a dissent. JavaScript ``deadlockOptions``."""
    crit = c.get("tier") == "critical"
    if truthy(dl.get("lean")):
        d = dl["decs"][0]
        return [{"v": d, "l": "Send back for remediation" if d == "remediate" else dec_label(d, c.get("tier"), c.get("stage"))}]
    if c.get("stage") == "exec":
        if all(d in ("approve", "waive") for d in dl["decs"]):
            return [{"v": "approve", "l": "Push to pilot (approve for pilot)"}]
        return [{"v": "remediate", "l": "Send back to the submitter for remediation"}]
    if any(d in ("remediate", "reject", "await") for d in dl["decs"]):
        return [{"v": "remediate", "l": "Send back to the submitter for remediation"}]
    cnt: dict = {}
    for a in dl["act"]:
        if a["v"].get("dec") != "await":
            cnt[a["v"]["dec"]] = cnt.get(a["v"]["dec"], 0) + 1
    top = max(cnt.values()) if cnt else -math.inf
    return [{"v": d, "l": dec_label(d, c.get("tier"))} for d in cnt if cnt[d] == top and not (crit and d != "approve")]


def rev_quorum_waivable(c: dict, rules: dict):
    """Lead only: the pool is short only because reviewers abstained, and everyone left agrees firmly. JavaScript ``revQuorumWaivable``."""
    if c.get("stage") != "panel":
        return None
    b = rev_blockers(c, rules)
    if b["pend"] or b["missing"] or not b["poolShort"]:
        return None
    v = rev_votes(c)
    pool = rev_pool(c)
    abst = [pid for pid in pool if truthy(v.get(pid)) and v[pid].get("dec") == "abstain"]
    leads = with_role("lead")
    lead0 = leads[0]["id"] if leads else None
    if not abst or any(not truthy(v.get(pid)) and pid != lead0 for pid in pool):
        return None
    act = [pid for pid in pool if truthy(v.get(pid)) and v[pid].get("dec") != "abstain"]
    if not act:
        return None
    dec = v[act[0]].get("dec")
    if dec not in FIRMABLE or any(v[pid].get("dec") != dec or not truthy(v[pid].get("firm")) for pid in act):
        return None
    return {"dec": dec, "n": len(act), "of": len(pool), "abstained": len(abst), "gaps": terms_gaps(c, rules, dec)}


# ---- Reminders ----

def day_key(ts) -> str:
    """The calendar day of a timestamp in the engine's time zone, used so nobody gets two reminders a day."""
    return date_string(ts)


def ago_txt(ts, now) -> str:
    """'today', '1 day ago' or 'N days ago'. JavaScript ``agoTxt``."""
    if nullish(ts):
        return "NaN days ago"
    d = max(0, math.floor((now - ts) / DAY))
    return "today" if d == 0 else "1 day ago" if d == 1 else f"{d} days ago"


def asked_ago(ts, now, last=None) -> str:
    """'asked 3 days ago, last reminded today'. JavaScript ``askedAgo``."""
    return "asked " + ago_txt(ts, now) + (", last reminded " + ago_txt(last, now) if truthy(last) else "")


def rev_reminder_due(c: dict, rules: dict, now) -> list[str]:
    """Reviewers who should get a reminder now. JavaScript ``revReminderDue``.

    Reviewers without a firm decision (or an abstain), once nothing blocks. One reminder the day
    before the deadline, then daily from the deadline, never more than one a day.
    """
    if c.get("stage") not in ("panel", "exec"):
        return []
    if rev_blockers(c, rules)["texts"] or not truthy(c.get("dueAt")):
        return []
    if now < c["dueAt"] - DAY:
        return []
    v = rev_votes(c)
    out = []
    for pid in rev_pool(c):
        x = v.get(pid)
        if truthy(x) and (truthy(x.get("firm")) or x.get("dec") == "abstain"):
            continue
        last = js_or((x or {}).get("lastMailAt") if truthy(x) else None, 0)
        if truthy(last) and day_key(last) == day_key(now):
            continue
        if now >= c["dueAt"] or last < c["dueAt"] - DAY:
            out.append(pid)
    return out


def remind_case(c0: dict, ctx: dict, actor=None, only=None):
    """Send due reminders on a case, or the ones a person ticked. Returns a new case, or None if nothing was due. JavaScript ``remindCase``.

    With no actor (or the system), this is the automated sweep: experts are reminded from a day
    before their due date, at most daily; reviewers per :func:`rev_reminder_due`; and the lead
    when reviewers agree but the finalizing was left to them. With ``only`` (a list of consult ids
    and ``"a:<control id>"`` confirmation ids), exactly those people are reminded.
    """
    consults0 = c0.get("consults") or []
    pend = [k for k in consults0 if k.get("status") == "pending" and (not truthy(only) or k.get("id") in only)]
    now = ctx["now"]
    auto = not truthy(actor) or actor.get("id") == "system"

    def consult_due(k):
        if not auto:
            return True
        return (truthy(k.get("dueAt")) and now >= k["dueAt"] - DAY
                and (not truthy(k.get("lastReminderAt")) or now - k["lastReminderAt"] >= DAY))

    due = [k for k in pend if consult_due(k)]
    pend_att = ([a for a in (c0.get("attestations") or []) if a.get("status") not in ("confirmed", "declined") and ("a:" + js_str(a.get("controlId", UNDEF))) in only]
                if truthy(only) else [])
    rules0 = ctx["rules"]
    rv_due = rev_reminder_due(c0, rules0, now) if auto and not truthy(only) else []
    rdy0 = rev_ready(c0, rules0) if auto and not truthy(only) and c0.get("stage") == "panel" else None
    rb0 = c0.get("readyBy")
    lead_rem = bool(rdy0 and rdy0["ok"] and truthy(rb0) and truthy(rb0.get("declined")) and with_role("lead")
                    and not (truthy(rb0.get("lastLeadMail")) and day_key(rb0["lastLeadMail"]) == day_key(now)))
    if not due and not pend_att and not rv_due and not lead_rem:
        return None
    c = clone(c0)

    def push(to, second, x, subject, body):
        c["outbox"].append({"ts": now, "n": len(c["outbox"]), "to": to, "second": second, "x": js_json(x), "subject": subject,
                            "body": body, "kind": "reminder", "auto": True})

    if rv_due:
        key = vote_key(c)
        c[key] = c[key] if truthy(c.get(key)) else rev_votes(c)
        dl = date_string(c["dueAt"]) if truthy(c.get("dueAt")) else ""
        for pid in rv_due:
            if not truthy(c[key].get(pid)):
                c[key][pid] = {"dec": "", "firm": False, "at": 0}
            v = c[key][pid]
            v["lastMailAt"] = now
            v["reminders"] = js_or(v.get("reminders"), 0) + 1
            push([pid], v["reminders"] > 1,
                 {"due": ["Your decision on this use case is still open.", ("The decision was due " if now > c["dueAt"] else "The decision is due ") + dl + "."],
                  "notes": [["What to do", "Record a firm decision, or abstain if you cannot review it.", "ask"]], "button": "Open the case and decide", "only": 1},
                 "Reminder: your decision is needed on " + c["id"],
                 'Your decision is still open on "' + js_str(c.get("title", UNDEF)) + '". Record a firm decision, or abstain. Due ' + dl + ".")
    if lead_rem:
        ld = with_role("lead")[0]
        c["readyBy"]["lastLeadMail"] = now
        d = dec_label(rdy0["dec"], c.get("tier"))
        push([ld["id"]], True,
             {"due": ["The reviewers agree. The decision is waiting to be finalized."], "notes": [["The decision", d, "ask"]],
              "button": "Open the case and finalize", "only": 1},
             "Reminder: ready to finalize " + c["id"],
             'The reviewers agree on "' + d + '" for "' + js_str(c.get("title", UNDEF)) + '". It is waiting to be finalized.')
    for a0 in pend_att:
        a = next(x for x in c["attestations"] if x.get("controlId") == a0.get("controlId"))
        a["reminders"] = js_or(a.get("reminders"), 0) + 1
        a["lastReminderAt"] = now
        rc = (ctx.get("rules") or {}).get("controls")
        ct = (js_or(next((k for k in rc if k["id"] == a["controlId"]), {}).get("short"), a["controlId"]) if truthy(rc) else a["controlId"])
        push([a["personId"]], a["reminders"] > 1,
             {"due": ["Your confirmation is still needed.", "It does not block the decision."], "notes": [["The control", ct, "ask"]],
              "button": "Open the case and respond", "only": 1},
             "Reminder: please confirm a control on " + c["id"],
             'Your confirmation is still needed on "' + js_str(c.get("title", UNDEF)) + '" for: ' + js_str(ct) + ". It does not block the decision.")
    for d0 in due:
        k = next(x for x in c["consults"] if x.get("id") == d0.get("id"))
        k["reminders"] = js_or(k.get("reminders"), 0) + 1
        k["lastReminderAt"] = now
        sme = k.get("kind") == "sme"
        word = "requested" if k.get("required") is False else "required"
        push([k["personId"]], k["reminders"] > 1,
             {"due": ["A response is " + word + ". It is still open." if sme else "Your feedback is still welcome.",
                      "The decision waits on it." if sme and k.get("required") is not False else "It does not hold up the decision."],
              "notes": [["The question", js_or(k.get("question"), ""), "ask"]], "button": "Open the case and respond", "only": 1},
             "Reminder: " + ("response needed" if sme else "feedback welcome") + " on " + c["id"],
             ("A response is " + word + ' on "' + js_str(c.get("title", UNDEF)) + '". Question: ' + js_str(k.get("question", UNDEF))) if sme
             else 'Your feedback is welcome on "' + js_str(c.get("title", UNDEF)) + '". No reply will block the decision.')
    names = ([by_id(d.get("personId"))["name"] for d in due] + [by_id(a.get("personId"))["name"] for a in pend_att]
             + [by_id(pid)["name"] for pid in rv_due] + ([by_id(with_role("lead")[0]["id"])["name"] + " (to finalize)"] if lead_rem else []))
    c["audit"].append({"ts": now, "actor": "system" if auto else actor["id"], "action": "Reminders sent", "note": ", ".join(unique(names)),
                       "from": c["stage"], "to": c["stage"], "auto": auto, "tag": ""})
    return seal_audit(c, js_or(ctx.get("rv"), 1), now)
