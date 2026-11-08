"""Which actions a person can take on a case right now, with the form fields each one needs.

:func:`actions_for` is the single source of truth for permissions. The screen shows exactly the
actions it returns, and :func:`aura_engine.perform.perform` refuses any action not in this list.
So a permission bug can only live here, and the tests can check permissions without a browser.

Each action is a dict such as::

    {"id": "vet_to_panel", "label": "Send to standing panel", "tone": "primary",
     "intro": "...", "fields": [{"name": "note", "label": "...", "type": "textarea", "required": True}, ...]}

Field types the screen knows how to draw: ``textarea``, ``number``, ``select``, ``checks``,
``measures`` (the KPI table), ``overrides`` (open items to accept), ``panelnotes`` (reviewers'
decisions), ``support`` (claimed controls), ``smetable`` and ``stkblock`` (the consult dialog),
``note`` (text only) and ``hidden``. Some fields carry a ``tab`` so the screen can group them.
"""

from __future__ import annotations

from .constants import PEOPLE, TIER_LABEL, TIERS, BIAS_OPTS, by_id, t_idx, with_role
from .consults import consult_needs, missing_required_consults, second_look_options
from .controls import acceptance_expired, loose_threads, support_view, thread_sig
from .forms import form_diff
from .jsx import UNDEF, date_string, js_or, js_str, nullish, truthy
from .matching import ctl_applies
from .people import duty_block, owner_of, training_blocks, training_msg
from .review import (asked_ago, dec_label, deadlock_options, expert_names, pending_required_experts, rev_blockers, rev_deadlock,
                     rev_need, rev_pool, rev_quorum_waivable, rev_ready, rev_votes, terms_diff, terms_now)
from .rules import norm_rules
from .triage import SCORED_STAGES

# The tabs of the shared approval form.
TAB_APPROVE = [["notes", "Panel notes"], ["approval", "Risks"], ["pilot", "Pilot Conditions"], ["kpi", "KPIs and Limits"],
               ["prod", "Production Conditions"], ["ctl", "Claimed Controls"]]

_STANCES = [{"v": "support", "l": "No concerns"}, {"v": "concerns", "l": "Concerns to address"}, {"v": "serious", "l": "Serious concern"}]
_DEFAULT_PILOT_SCOPE = "Limited to one site and a small group of users."


def _tabbed(tab: str, field: dict) -> dict:
    """A copy of a field with its tab first (JavaScript ``Object.assign({ tab }, f)``)."""
    return {"tab": tab, **field}


def actions_for(c: dict, actor: dict, ctx: dict) -> list[dict]:
    """Everything ``actor`` can do on case ``c`` now. JavaScript ``actionsFor``.

    ``ctx`` holds ``rules``, ``now`` (milliseconds) and, optionally, ``training`` (completion
    records; when present, the training gate applies to submitting).
    """
    R = ctx["rules"]
    role = actor.get("role")
    mine = c.get("submitterId") == actor.get("id")
    stage = c.get("stage")
    tier = c.get("tier")
    form = c["form"]
    out: list[dict] = []

    def A(action_id: str, label: str, **opts) -> dict:
        a = {"id": action_id, "label": label, "tone": "", "fields": [], **opts}
        out.append(a)
        return a

    subm = by_id(c.get("submitterId"))["name"]
    # sep_b: why a reviewer is kept off this case by separation of duties ('' when they are not).
    sep_b = duty_block(c, actor["id"], "exec" if role == "exec" else "panel") if role in ("panel", "exec", "lead") else ""
    adv = actor.get("id") == c["adviserId"] if truthy(c.get("adviserId")) else role == "adviser"
    help_open = any(h.get("status") == "open" for h in (c.get("helpRequests") or []))

    def back_intro() -> str:
        return ("This sends the use case back to " + subm + ", the submitter, with your reason by email. They update the details and "
                "resubmit, and it goes through triage and scoring again. Panel notes and votes are cleared, but expert and stakeholder "
                "responses are kept. It is not a rejection.")

    def reject_intro() -> str:
        return ("This closes the use case and emails your reason to " + subm + ". It leaves the review process unless " + subm
                + " returns it to the suggestion box to start over. Your reason is also shown to people who later propose something "
                "similar, so say what was wrong and, where you can, what would make an idea acceptable.")

    npf = {"name": "notPermitted", "label": "Not permitted", "type": "checks", "required": False,
           "options": [{"v": "np", "l": "Mark this use case as not permitted. It cannot be returned to the suggestion box unless the governance lead removes the mark."}],
           "value": []}
    rsn = {"name": "rationale", "label": "Reason (guides future submitters)", "type": "textarea", "required": True}

    def note_field(req: bool = False) -> dict:
        return {"name": "note", "label": "Reason" if req else "Note (optional)", "type": "textarea", "required": bool(req)}

    # ---- Review state shared by the panel and executive actions ----
    threads = loose_threads(c, R) if stage in ("panel", "exec") and truthy(c.get("scoring")) else []
    sv = support_view(c, R) if truthy(c.get("scoring")) else None
    dr = c.get("reviewDraft") if truthy(c.get("reviewDraft")) else None
    draft_vals = (dr.get("vals") if dr and truthy(dr.get("vals")) else None) or {}

    def dval(k, default):
        return draft_vals[k] if dr and not nullish(draft_vals.get(k)) else default

    # Risks already accepted in the shared draft, kept only while the item itself is unchanged.
    saved_ov = {}
    for t in threads:
        o = (dr.get("overrides") or {}).get(t["slug"]) if dr and truthy(dr.get("overrides")) else None
        if o and (truthy(o.get("reason")) or truthy(o.get("on"))) and o.get("sig") == thread_sig(t):
            saved_ov[t["slug"]] = {"on": truthy(o.get("on")), "reason": js_or(o.get("reason"), "")}
    # Carried forward: risks the panel accepted when recommending stay accepted for the executives if unchanged.
    pd = c.get("panelDecision")
    if stage == "exec" and truthy(pd) and pd.get("decision") == "recommend":
        for t in threads:
            if t["slug"] in saved_ov:
                continue
            p = next((x for x in (pd.get("overrides") or []) if x.get("id") == t["id"] and x.get("kind") == t["kind"]
                      and js_or(x.get("detail"), "") == js_or(t.get("detail"), "")), None)
            if p:
                saved_ov[t["slug"]] = {"on": True, "reason": js_or(p.get("reason"), "")}
    draft_note = ("Last saved by " + by_id(dr.get("by"))["name"] + " on " + date_string(dr.get("at")) + ".") if dr else ""
    # (Build 27 also worked out a "hold" message here that nothing used; it is left out.)

    def measure_fields(req: bool) -> list[dict]:
        """One number field per approved KPI, named mv_<KPI id>."""
        ms = (c["acceptance"].get("measures") if truthy(c.get("acceptance")) else None) or []
        return [{"name": "mv_" + m["id"],
                 "label": m["name"] + " (" + ("lower" if m.get("dir") == "lower" else "higher") + " is better; target " + js_str(m.get("target", UNDEF))
                 + ", stop limit " + js_str(m.get("stop", UNDEF)) + ")" + ("" if req else " (optional)"),
                 "type": "number", "required": bool(req), "measure": True} for m in ms]

    def acceptance_fields() -> list[dict]:
        """The approval boundaries: KPIs, production limits, validity, and the production review cycle."""
        ac, prior = c.get("acceptance"), c.get("priorAcceptance")
        return [
            {"name": "measures", "label": "KPIs (key performance indicators) and stop limits", "type": "measures", "required": True,
             "value": js_or(ac.get("measures") if truthy(ac) else None, prior.get("measures") if truthy(prior) else None, form.get("measures"), []),
             "proposed": js_or(form.get("measures"), [])},
            {"name": "limits", "label": "Production controls, conditions, and limits (beyond the listed controls)", "type": "textarea", "required": True,
             "value": js_or(ac.get("limits") if truthy(ac) else None, prior.get("limits") if truthy(prior) else None, "")},
            {"name": "validDays", "label": "Approval valid for (days)", "type": "number", "required": True, "value": 365},
            {"name": "prodDays", "label": "Review in production every (days, maximum " + js_str(R["reviewMaxDays"].get(tier, UNDEF)) + ")", "type": "number",
             "required": True, "value": R["reviewCadenceDays"].get(tier, UNDEF)},
        ]

    def note_rows() -> list[dict]:
        """Every possible reviewer with their decision and note, for the "Reviewers" list."""
        v = rev_votes(c)
        rows = []
        for pid in rev_pool(c):
            n = next((x for x in (c.get("panelNotes") or []) if x.get("by") == pid), None)
            x = v.get(pid) if truthy(v.get(pid)) else None
            rows.append({"by": by_id(pid)["name"], "role": js_or(by_id(pid).get("title"), ""), "dec": x.get("dec", UNDEF) if x else "",
                         "firm": bool(x and truthy(x.get("firm"))), "text": n.get("text", UNDEF) if n else "",
                         "at": n.get("at", UNDEF) if n else (x.get("at", UNDEF) if x else 0), "me": pid == actor.get("id")})
        return rows

    def review_fields(req: bool, kind: str, extra=None) -> list[dict]:
        """The shared approval form. With ``req`` everything must be filled in (finalizing); otherwise it only saves.

        ``kind`` is panel, recommend, waive, exec or execwaive, and changes some labels and defaults.
        """
        fields = []
        is_exec = kind in ("exec", "execwaive")
        rec_dec = ({"by": by_id(pd.get("by"))["name"], "at": pd.get("at", UNDEF), "text": pd.get("rationale", UNDEF)}
                   if truthy(pd) and pd.get("decision") in ("recommend", "escalate") else None)
        label = ("Executive decision notes (for the submitter)" if is_exec else "Panel recommendation notes (for the executives)" if kind == "recommend"
                 else "Panel decision notes (for the submitter)")
        fields.append({"tab": "notes", "name": "rationale", "label": label, "type": "textarea", "required": bool(req), "value": dval("rationale", "")})
        fields.append({"tab": "notes", "name": "panelnotes", "type": "panelnotes", "label": "Reviewers", "rec": rec_dec if is_exec else None,
                       "notes": note_rows(), "stage": stage})
        fields.append({"tab": "approval", "name": "overrides", "type": "overrides", "label": "Open items", "threads": threads, "saved": saved_ov, "req": bool(req)})
        for f in extra or []:
            fields.append(_tabbed("approval", f))
        if kind in ("waive", "execwaive"):
            fields.append({"tab": "pilot", "name": "waiver", "label": "Reason for waiving the pilot", "type": "textarea", "required": bool(req), "value": dval("waiver", "")})
        else:
            rp = js_or(c.get("recommendedPilot"), {})
            scope_default = js_or(rp.get("scope"), "") if kind == "exec" else js_or(rp.get("scope"), _DEFAULT_PILOT_SCOPE)
            fields.append({"tab": "pilot", "name": "scope", "label": "Pilot scope and conditions", "type": "textarea", "required": bool(req), "value": dval("scope", scope_default)})
            fields.append({"tab": "pilot", "name": "days", "label": "Pilot review in (days)", "type": "number", "required": bool(req),
                           "value": dval("days", js_or(rp.get("days"), R["pilotDays"].get(tier, UNDEF)))})
        for f in acceptance_fields():
            g = {**f, "tab": "kpi" if f["name"] == "measures" else "prod", "required": bool(req)}
            if f["name"] == "limits":
                g["label"] = "Production controls, conditions, and limits (beyond the claimed controls)"
            if dr and not nullish(draft_vals.get(f["name"])):
                g["value"] = draft_vals[f["name"]]
            fields.append(g)
        fields.append({"tab": "ctl", "name": "support", "type": "support", "label": "Claimed controls", "rows": sv["rows"] if sv else [], "threads": [],
                       "net": sv["net"] if sv else None, "supported": sv["supported"] if sv else 0, "netTier": sv["netTier"] if sv else None,
                       "inherent": c["scoring"].get("inherent", UNDEF) if truthy(c.get("scoring")) else None})
        fields.append({"tab": "approval", "name": "draftrev", "type": "hidden", "value": dr.get("rev", UNDEF) if dr else 0})
        if draft_note:
            fields.append({"tab": "approval", "name": "draftnote", "type": "note",
                           "label": draft_note + " Anyone on the review can add to it. Only an approver can approve."})
        return fields

    def vote_fields() -> list[dict]:
        """The "Record my decision" form: decision, how sure, note, what to wait for, plus the shared terms."""
        is_exec = stage == "exec"
        v0 = rev_votes(c)
        mv = v0.get(actor["id"]) if truthy(v0.get(actor["id"])) else {}
        mn = next((n for n in (c.get("panelNotes") or []) if n.get("by") == actor.get("id")), None) or {}
        bl0 = rev_blockers(c, R)
        crit = tier == "critical"
        kinds = (["approve", "waive", "remediate", "reject"] if is_exec else
                 ["approve"] + ([] if crit else ["waive"]) + ["remediate", "reject"] + ([] if crit else ["escalate"]) + ["abstain", "await"])
        f = []
        if bl0["texts"]:
            f.append({"tab": "notes", "name": "blk", "type": "note", "label": "Not ready for a firm decision. " + " ".join(bl0["texts"])
                      + " Until that clears you can lean, ask to wait for input, or abstain. When it clears, every reviewer is emailed to look again."})
        ch = terms_diff(mv["snap"], terms_now(c, R)) if truthy(mv.get("snap")) else []
        if ch:
            parts = [x["label"] + (" (changed)" if isinstance(x["to"], list) else ' (was "' + js_str(x["from"]) + '", now "' + js_str(x["to"]) + '")') for x in ch]
            f.append({"tab": "notes", "name": "chg", "type": "note", "label": "What changed since your firm decision: " + "; ".join(parts) + "."})
        f.append({"tab": "notes", "name": "decision", "label": "Your decision", "type": "select", "required": False, "value": js_or(mv.get("dec"), ""),
                  "options": [{"v": d, "l": dec_label(d, tier, stage)} for d in kinds]})
        if kinds:
            strength = ("firm" if truthy(mv.get("firm")) else "leaning") if truthy(mv.get("dec")) and mv.get("dec") not in ("abstain", "await") else ""
            f.append({"tab": "notes", "name": "strength", "label": "How sure are you?", "type": "select", "required": False, "value": strength,
                      "options": [{"v": "firm", "l": "Firm: I have decided"}, {"v": "leaning", "l": "Leaning: I may still change my mind"}]})
        f.append({"tab": "notes", "name": "text", "label": "Your review note (what you changed, and thoughts for the others)", "type": "textarea",
                  "required": False, "value": js_or(mn.get("text"), "")})
        if not is_exec:
            opt = [{"v": k.get("id", UNDEF), "l": by_id(k.get("personId"))["name"] + " (" + ("expert" if k.get("kind") == "sme" else "stakeholder") + ")"}
                   for k in (c.get("consults") or []) if k.get("status") == "pending" and not (k.get("kind") == "sme" and k.get("required") is not False)]
            opt += [{"v": "a:" + js_str(a.get("controlId", UNDEF)),
                     "l": by_id(a.get("personId"))["name"] + " (confirmer for " + js_str(js_or(next((k for k in R["controls"] if k["id"] == a.get("controlId")), {}).get("short"), a.get("controlId", UNDEF))) + ")"}
                    for a in (c.get("attestations") or []) if a.get("status") not in ("confirmed", "declined")]
            if opt:
                f.append({"tab": "notes", "name": "awaitIds",
                          "label": "Only if you chose Awaiting input: you always wait for the required expert responses. Tick any other answers you also want to hear first. You are emailed when they all arrive.",
                          "type": "checks", "required": False, "options": opt, "value": js_or(mv.get("awaitIds"), []) if mv.get("dec") == "await" else []})
        f.append({"tab": "pilot", "name": "waiver", "label": 'Reason for waiving the pilot (only needed to hold "approve and waive" firm)', "type": "textarea",
                  "required": False, "value": dval("waiver", "")})
        return f + [x for x in review_fields(False, "exec" if is_exec else "panel") if x["name"] != "rationale"]

    attestations = c.get("attestations") or []
    can_evidence = (stage in ("use_case", "vetting", "panel", "exec", "pilot", "production") and role != "admin"
                    and (role in ("lead", "panel", "sme", "stakeholder", "exec") or adv or mine or actor.get("id") == owner_of(c)
                         or any(a.get("personId") == actor.get("id") for a in attestations)))
    my_att = [a for a in attestations if a.get("personId") == actor.get("id") and a.get("status") == "pending"]

    def tiers_above(t):
        return [{"v": x, "l": TIER_LABEL[x]} for x in TIERS if t_idx(x) > t_idx(t)]

    ask_adviser_fields = [{"name": "message", "label": "What do you need help with? (optional)", "type": "textarea", "required": False}]

    def ask_adviser_intro() -> str:
        # Build 27 fell back to "the governance lead" here, but its person lookup never fails, so the fallback never shows.
        name = by_id(c.get("adviserId"))["name"]
        return "Your adoption adviser is " + name + ". They will get your request in their queue and by email."

    def adviser_choice() -> list[dict]:
        return [{"name": "adviser", "label": "Adoption adviser", "type": "select", "required": True, "value": js_or(c.get("adviserId"), ""),
                 "options": [{"v": x["id"], "l": x["name"]} for x in PEOPLE if x["role"] in ("adviser", "lead")]}]

    # ---- A consult request waiting on this person ----
    mine_consult = next((k for k in (c.get("consults") or []) if k.get("personId") == actor.get("id") and k.get("status") == "pending"), None)
    if mine_consult and stage in ("use_case", "vetting", "panel", "exec"):
        sme = mine_consult.get("kind") == "sme"
        A("respond", "Respond to consult (required)" if sme else "Share feedback", tone="primary", fields=[
            {"name": "stance", "label": "Assessment" if sme else "View", "type": "select", "required": True, "options": _STANCES},
            {"name": "text", "label": "Your assessment" if sme else "Feedback on business value, risks and concerns", "type": "textarea", "required": True}])

    # ---- Actions by stage ----
    if stage == "suggestion":
        if mine or adv:
            A("develop", "Develop into a use case", tone="primary", fields=[note_field(False)])
        if mine and not adv:
            A("ask_adviser", "Ask adoption adviser", fields=ask_adviser_fields, confirmLabel="Send request", intro=ask_adviser_intro())
        if adv and help_open:
            A("help_done", "Mark help given", fields=[note_field(False)])
        if role == "lead":
            A("set_adviser", "Change adviser", fields=adviser_choice())

    elif stage == "use_case":
        so = c.get("signoff")
        requested = truthy(so) and so.get("status") == "requested"
        own = owner_of(c)
        if requested:
            if actor.get("id") == so.get("ownerId"):
                A("signoff_accept", "Accept and submit for triage", tone="primary", form=True)
                A("save_draft", "Save draft", form=True)
                A("request_confirmations", "Send confirmation requests", form=True)
                A("signoff_decline", "Decline and return", tone="warn", fields=[note_field(True)])
            elif mine or so.get("requestedBy") == actor.get("id"):
                A("withdraw_signoff", "Withdraw sign-off request", fields=[note_field(False)])
        elif mine or adv:
            if mine and not adv:
                A("ask_adviser", "Ask adoption adviser", fields=ask_adviser_fields, confirmLabel="Send request", intro=ask_adviser_intro())
            if adv and help_open:
                A("help_done", "Mark help given", fields=[note_field(False)])
            if role == "lead":
                A("set_adviser", "Change adviser", fields=adviser_choice())
            sub = A("submit", "Submit for triage" if own == actor.get("id") else "Request owner sign-off", tone="primary", form=True)
            bl = training_blocks(ctx.get("training"), actor, R, ctx.get("now"))
            if bl:
                sub["blockedMsg"] = training_msg(bl)
            A("save_draft", "Save draft", form=True)
            A("request_confirmations", "Send confirmation requests", form=True)

    elif stage == "vetting":
        if role == "lead":
            if tier == "low":
                A("vet_approve", "Approve to production", tone="go", fields=[note_field(False)] + acceptance_fields())
            slo = second_look_options(c, R)
            sdiff = form_diff(c.get("formAtReturn"), form, R)
            pend_ask = [{"v": k.get("id", UNDEF), "l": by_id(k.get("personId"))["name"] + " ("
                         + (("required expert" if k.get("required") is not False else "expert") if k.get("kind") == "sme" else "process stakeholder")
                         + "), asked " + date_string(k.get("requestedAt", UNDEF))}
                        for k in (c.get("consults") or []) if k.get("status") == "pending"]
            low = tier == "low"
            fields = [{"name": "note", "label": "Reason for sending this case to the panel" if low else "Note (optional)", "type": "textarea", "required": low}]
            if tier != "critical":
                fields.append({"name": "raiseTo", "label": "Raise the tier? (not required)", "type": "select", "required": False,
                               "options": [{"v": "", "l": "No, keep " + js_str(TIER_LABEL.get(tier, UNDEF))}] + tiers_above(tier)})
            if slo:
                changed = ("Changed since it was returned: " + ("; ".join(sdiff) if sdiff else "no answers changed") + ".") if truthy(c.get("formAtReturn")) \
                    else "Experts and stakeholders consulted earlier are listed below."
                fields.append({"name": "diffnote", "type": "note", "label": changed})
                fields.append({"name": "again", "label": "Ask for a second look (they are emailed their earlier comments and what changed). Experts whose area is still triggered hold the decision until they respond. Everyone else stays on the case as they answered.",
                               "type": "checks", "required": False, "options": slo, "value": []})
            if pend_ask:
                fields.append({"name": "cancelPending", "label": "Still waiting on these requests, sent before the case was returned. Leave them and the answer counts when the case reaches the panel (a required expert still holds the decision). Tick one to cancel a request you no longer need.",
                               "type": "checks", "required": False, "options": pend_ask, "value": []})
            A("vet_to_panel", "Send to standing panel", tone="" if low else "primary",
              intro=("A Low case does not have to be rated higher to deserve a second look. Give your reason below. Raising the tier is optional." if low
                     else "Add a note if you like. Raising the tier is optional."), fields=fields)
            A("vet_remediate", "Remediate, with reason", tone="warn", fields=[note_field(True)], intro=back_intro())

    elif stage == "panel":
        is_rev = role in ("panel", "lead") and not sep_b
        rdy = rev_ready(c, R)
        dl = rev_deadlock(c, R, ctx.get("now"))
        wq = rev_quorum_waivable(c, R)
        nq = rev_need(c, R)
        if is_rev:
            A("rv_vote", "Change my decision" if truthy(rev_votes(c).get(actor["id"])) else "Record my decision", tone="primary", tabs=TAB_APPROVE,
              defaultTab="notes", intro="Choose a decision and write your note. You can also change the approval terms on the other tabs. Everyone on the review sees your decision and note.",
              fields=vote_fields())
            A("review_draft", "Save changes without deciding", inline=True, tabs=TAB_APPROVE, fields=review_fields(False, "panel"))
            if rdy and rdy["ok"]:
                A("rv_decline", "Leave it for the lead", inline=True, hidden=True)
        if is_rev and rdy and rdy["ok"]:
            intro = js_str(rdy["firm"]) + " of " + js_str(nq) + " needed reviewers hold this decision firm and nobody disagrees. Check each tab one last time, then confirm. Write the summary for the submitter yourself."
            d = rdy["dec"]
            if d == "approve" and tier == "critical":
                A("panel_recommend", "Finalize: recommend approval to executives", tone="go", tabs=TAB_APPROVE, canDraft=True, intro=intro, fields=review_fields(True, "recommend"))
            elif d == "approve":
                A("panel_approve", "Finalize: approve for pilot", tone="go", tabs=TAB_APPROVE, canDraft=True, intro=intro, fields=review_fields(True, "panel"))
            elif d == "waive":
                A("panel_waive", "Finalize: approve and waive pilot", tone="neutral", tabs=[["pilot", "Pilot waiver"] if t[0] == "pilot" else t for t in TAB_APPROVE],
                  canDraft=True, intro=intro, fields=review_fields(True, "waive"))
            elif d == "escalate":
                A("panel_escalate", "Finalize: send to executives", tone="escalate", intro=intro + " The executives decide this case, with the full executive quorum. The tier does not change.",
                  fields=[{"name": "note", "label": "Note for the executives (optional)", "type": "textarea", "required": False}])
            elif d == "remediate":
                A("panel_remediate", "Finalize: remediate", tone="warn", fields=[{"name": "rationale", "label": "Summary for the submitter", "type": "textarea", "required": True}],
                  intro=intro + " " + back_intro())
            elif d == "reject":
                A("panel_reject", "Finalize: reject", tone="stop", fields=[rsn, npf], intro=intro + " " + reject_intro())
        if role == "lead" and not sep_b and dl:
            opts = deadlock_options(c, dl)
            wv = any(o["v"] == "waive" for o in opts)
            lean = truthy(dl.get("lean"))
            if lean:
                intro = 'Everyone left holds "' + opts[0]["l"] + '" and the deadline has passed, but not everyone is firm, so leanings now count as firm. You may carry it out. Write the summary for the submitter in the decision notes.'
            else:
                intro = ("The reviewers disagree. Read every reviewer's decision and note in the list on this tab, choose how to resolve it, and write the summary for the submitter in the decision notes. "
                         + ("Because someone wants changes, a rejection or more input, the only way forward is to send it back for remediation. Nothing is approved over a dissent." if opts[0]["v"] == "remediate"
                            else "The reviewers only differ on the form of approval, so you may push one of the approval decisions."))
            extra = ([{"name": "waiver", "label": "Reason for waiving the pilot (only if you choose approve and waive)", "type": "textarea", "required": False, "value": dval("waiver", "")}] if wv else [])
            extra += [npf] if any(o["v"] == "reject" for o in opts) else []
            A("panel_break", "Break deadlock", tone="escalate", tabs=TAB_APPROVE, canDraft=True, intro=intro,
              fields=[{"tab": "notes", "name": "outcome", "label": "How to resolve it", "type": "select", "required": False, "value": opts[0]["v"],
                       "options": [{"v": o["v"], "l": o["l"]} for o in opts]}] + review_fields(False, "panel", extra))
        if role == "lead" and not sep_b and wq:
            A("panel_waivequorum", "Waive quorum", tone="escalate", tabs=TAB_APPROVE, canDraft=True,
              intro=js_str(wq["n"]) + " of " + js_str(wq["of"]) + ' reviewers are left and all of them hold "' + dec_label(wq["dec"], tier) + '" firm. The others abstained, so the usual quorum of '
              + js_str(nq) + " cannot be met. Waiving the quorum carries out that decision, and the record will say it was decided with " + js_str(wq["n"]) + " of " + js_str(wq["of"]) + " reviewers.",
              fields=review_fields(False, "waive" if wq["dec"] == "waive" else "panel", [npf] if wq["dec"] == "reject" else []))
        if role == "lead":
            _lead_consult_actions(c, R, ctx, A)

    elif stage == "exec":
        if role == "exec" and not sep_b:
            rdy = rev_ready(c, R)
            dl = rev_deadlock(c, R, ctx.get("now"))
            nq = rev_need(c, R)
            rat = {"name": "rationale", "label": "Summary for the submitter", "type": "textarea", "required": True}
            A("rv_vote", "Change my decision" if truthy(rev_votes(c).get(actor["id"])) else "Record my decision", tone="primary", tabs=TAB_APPROVE,
              defaultTab="notes", intro="Choose a decision and write your note. You can also change the approval terms on the other tabs. Every executive decides individually. Your decision stays open to change until the executives decide.",
              fields=vote_fields())
            A("review_draft", "Save changes without deciding", inline=True, tabs=TAB_APPROVE, fields=review_fields(False, "exec"))
            if rdy and rdy["ok"]:
                intro = js_str(rdy["firm"]) + " of " + js_str(nq) + " needed executives hold this decision firm and nobody disagrees. Check each tab one last time, then confirm. Write the summary for the submitter yourself."
                d = rdy["dec"]
                if d == "approve":
                    A("exec_approve", "Finalize: approve for pilot", tone="go", tabs=TAB_APPROVE, canDraft=True, intro=intro, fields=review_fields(True, "exec"))
                elif d == "waive":
                    A("exec_waive", "Finalize: approve and waive pilot", tone="neutral", tabs=[["pilot", "Pilot waiver"] if t[0] == "pilot" else t for t in TAB_APPROVE],
                      canDraft=True, intro=intro, fields=review_fields(True, "execwaive"))
                elif d == "remediate":
                    A("exec_remediate", "Finalize: remediate", tone="warn", fields=[rat], intro=intro + " " + back_intro())
                elif d == "reject":
                    A("exec_reject", "Finalize: reject", tone="stop", fields=[rsn, npf], intro=intro + " " + reject_intro())
            if dl:
                opts = deadlock_options(c, dl)
                lean = truthy(dl.get("lean"))
                if lean:
                    intro = 'Everyone left holds "' + opts[0]["l"] + '" and the deadline has passed, but not everyone is firm, so leanings now count as firm. Write the single summary for the submitter in the decision notes.'
                else:
                    intro = ("The executives disagree. Read every executive's decision and note in the list on this tab, choose how to resolve it, and write the single summary for the submitter in the decision notes. "
                             + ("The executives split on the direction, so the case goes back to the submitter for remediation." if opts[0]["v"] == "remediate"
                                else "The executives only differ on whether to run a pilot, so it goes to pilot."))
                extra = ([{"name": "waiver", "label": "Reason for waiving the pilot", "type": "textarea", "required": False, "value": dval("waiver", "")}]
                         if any(o["v"] == "waive" for o in opts) else [])
                extra += [npf] if any(o["v"] == "reject" for o in opts) else []
                A("exec_break", "Break deadlock", tone="escalate", tabs=TAB_APPROVE, canDraft=True, intro=intro,
                  fields=[{"tab": "notes", "name": "outcome", "label": "How to resolve it", "type": "select", "required": False, "value": opts[0]["v"],
                           "options": [{"v": o["v"], "l": o["l"]} for o in opts]}] + review_fields(False, "exec", extra))

    elif stage == "pilot":
        if role == "lead":
            A("pilot_promote", "Promote to production", tone="go", fields=[note_field(False)] + measure_fields(True))
            A("pilot_rework", "Needs rework, stay in pilot", tone="warn",
              intro="The use case stays in pilot and the next pilot review moves out 14 days, so the team has time to fix the problems. Your note is emailed to " + subm + ". Enter the latest KPI results below if you have them.",
              fields=[note_field(True)] + measure_fields(False))
            A("pilot_escalate", "Risk beyond approval: back to panel", tone="escalate",
              intro="Use this when the pilot shows risk beyond what the panel approved. The use case goes back to the standing panel for a fresh review, and panel members are emailed your note. Earlier panel notes and consultation replies are cleared, but the approved KPIs and limits stay as the starting point.",
              fields=[note_field(True)] + measure_fields(False))
            A("pilot_reject", "Fails or new risk: reject", tone="stop",
              intro="This ends the pilot and closes the use case. Your reason is emailed to " + subm + ", who can return it to the suggestion box to start over. It is also shown to people who later propose something similar. Enter the latest KPI results below if you have them.",
              fields=[{**note_field(True), "label": "Reason (guides future submitters)"}, npf] + measure_fields(False))
            if measure_fields(True):
                A("log_measure", "Record KPI results", tone="primary", intro=_LOG_INTRO, fields=measure_fields(True))

    elif stage == "production":
        if role == "lead":
            days = js_or(c["acceptance"].get("prodReviewDays") if truthy(c.get("acceptance")) else None, R["reviewCadenceDays"].get(tier, UNDEF))
            A("monitor_ok", "Log review: continue", tone="go",
              intro="Use this for a routine review when the use case is still working as approved. It stays in production and the next review is scheduled " + js_str(days)
              + " days from now. Enter the latest KPI results below (required), and say how bias was reviewed.",
              fields=[note_field(False), {"name": "bias", "label": "Model bias review (required)", "type": "select", "required": True,
                                          "options": [{"v": o[0], "l": o[1]} for o in BIAS_OPTS]}] + measure_fields(True))
        if role == "lead" and measure_fields(True):
            A("log_measure", "Record KPI results", tone="primary", intro=_LOG_INTRO, fields=measure_fields(True))
        if role == "lead" or mine:
            A("monitor_reassess", "Material change: reassess", tone="warn",
              intro="Use this when the use case has changed in a way the approval did not cover, such as a new data source, a wider audience or a new capability. You are not entering new metrics: explain the change in the reason. The case moves back to the Use case stage and "
              + subm + ", the submitter, is emailed your reason. They update the details and resubmit, and it goes through triage, scoring and review again. The KPI results below are optional.",
              fields=[note_field(True)] + measure_fields(False))

    elif stage == "closed":
        closed = c.get("closed")
        if truthy(closed) and truthy(closed.get("notPermitted")):
            if role == "lead":
                A("allow_again", 'Remove "not permitted"', tone="warn",
                  intro="This idea was marked not permitted. Removing the mark lets the submitter, the owner, an adviser or you return it to the suggestion box.",
                  fields=[note_field(True)])
        elif mine or actor.get("id") == owner_of(c) or role == "lead" or adv:
            A("reopen", "Return to the suggestion box", fields=[note_field(False)])

    # ---- Actions available in several stages ----
    if acceptance_expired(c, ctx.get("now")) and role == "lead":
        A("renew_acceptance", "Renew the approval", tone="go",
          intro="The approval has expired. Renewing it confirms the use case is still fine as it is running and sets a new approval period, so it stays in production. Check the KPIs and limits below and change them if they no longer fit.",
          fields=[note_field(False)] + acceptance_fields())
    claimed = form.get("controls") or []
    if can_evidence and claimed:
        A("add_evidence", "Add evidence", inline=True)
    if can_evidence and role not in ("sme", "stakeholder"):
        nr = norm_rules(ctx["rules"])
        if any((lambda k: k is not None and not ctl_applies(k, form, nr))(next((x for x in (nr.get("controls") or []) if x["id"] == cid), None)) for cid in claimed):
            A("remove_control", "Remove a control that does not apply", inline=True)
    for e in c.get("evidenceItems") or []:
        if not truthy(e.get("removed")) and can_evidence and (e.get("by") == actor.get("id") or role == "lead"):
            A("remove_evidence", "Remove evidence", inline=True, evidenceId=e.get("id", UNDEF))
    if my_att and (stage in SCORED_STAGES or stage == "use_case"):
        fields = []
        for a in my_att:
            text = js_or(next((x for x in R["controls"] if x["id"] == a.get("controlId")), {}).get("text"), a.get("controlId", UNDEF))
            fields.append({"name": "d_" + js_str(a.get("controlId", UNDEF)), "label": js_str(text) + (". Evidence offered: " + js_str(a["evidence"]) if truthy(a.get("evidence")) else ""),
                           "type": "select", "required": True, "options": [{"v": "confirm", "l": "I confirm this control is in place"}, {"v": "decline", "l": "I cannot confirm it"}]})
        fields.append({"name": "text", "label": "Basis for your answer", "type": "textarea", "required": True})
        A("attest", "Confirm controls (" + str(len(my_att)) + ")", tone="primary", fields=fields)
    return out


_LOG_INTRO = ("Enter the latest result for each KPI. The use case stays where it is. If a result passes its stop limit, the governance lead is "
              "alerted and decides what happens next.")


def _lead_consult_actions(c: dict, R: dict, ctx: dict, A) -> None:
    """The lead's consult and reminder dialogs at panel review."""
    consults = c.get("consults") or []
    asked = {k.get("personId") for k in consults}

    def opt_of(p):
        return {"v": p["id"], "l": p["name"] + ", " + p["title"], "disabled": p["id"] in asked}

    need = {} if truthy(c.get("legacy")) else consult_needs(c["form"], R)
    areas = [a for a in (R.get("consultAreas") or []) if a.get("enabled") is not False and by_id(a.get("personId"))]

    def asked_k(a):
        ks = [k for k in consults if k.get("kind") == "sme" and (k.get("areaId") == a["id"] if truthy(k.get("areaId")) else k.get("personId") == a.get("personId"))]
        ks.sort(key=lambda k: -k.get("requestedAt", 0))
        return ks[0] if ks else None

    sme_opts = []
    for a in areas:
        n = need.get(a["id"])
        k = asked_k(a)
        p = by_id(a.get("personId"))
        blk = "" if k else duty_block(c, a.get("personId"), "expert")
        sme_opts.append({
            "v": a["id"], "l": a["label"] + " (" + p["name"] + ")", "blocked": blk, "disabled": bool(blk) or (bool(k) and k.get("status") != "pending"),
            "level": n["level"] if n else "", "why": n["reasons"][-1]["label"] if n else "", "asked": bool(k),
            "askedNote": (asked_ago(k.get("requestedAt"), ctx.get("now")) if k.get("status") == "pending" else "responded") if k else "",
            "askedQ": k.get("question", UNDEF) if k else "", "responded": bool(k) and k.get("status") != "pending",
            "held": bool(k) and k.get("required") is not False, "qDefault": js_or(a.get("question"), ""),
        })
    adviser = by_id(c.get("adviserId")) if truthy(c.get("adviserId")) else None
    stk_people = with_role("stakeholder") + ([adviser] if adviser and adviser.get("role") == "adviser" else [])
    stk = [opt_of(p) for p in stk_people if not duty_block(c, p["id"], "stakeholder")]
    pre = [o["v"] for o in sme_opts if not o["blocked"] and (o["asked"] or o["v"] in need)]
    pre_req = [o["v"] for o in sme_opts if not o["blocked"] and ((o["asked"] and o["held"]) or (o["v"] in need and need[o["v"]]["level"] == "required"))]
    slo = second_look_options(c, R)
    fields = [
        {"name": "smes", "sec": "sme", "secTitle": "Subject matter experts",
         "label": "Tick each area you need a view on and write a question for it. Required experts are always asked and always hold the decision. For the others, tick Hold only if their answer must come first. You can also untick Hold for an expert who was already asked.",
         "type": "smetable", "options": [{**o, "forced": o["level"] == "required"} for o in sme_opts], "value": pre, "reqValue": pre_req},
        {"name": "stakeholders", "sec": "stk", "secTitle": "Process stakeholders",
         "label": "Operators, users and customers of the process. Feedback is welcome and never holds the decision. They all get the same message.",
         "type": "stkblock", "options": stk, "value": [], "qValue": "Please share your feedback on the business value, risks and concerns of this use case."},
    ]
    if slo:
        fields.append({"name": "again", "label": "Ask for a second look: people who already answered. They are emailed their earlier comment"
                       + (" and what changed since the case was returned" if truthy(c.get("formAtReturn")) else "")
                       + ". Experts whose area is still triggered hold the decision until they respond.",
                       "type": "checks", "required": False, "options": slo, "value": []})
    A("consult", "Consult experts and notify stakeholders", tone="primary", confirmLabel="Send", fields=fields)

    pend = [k for k in consults if k.get("status") == "pending"]

    def lab(k, default):
        p = by_id(k.get("personId"))
        return {"v": k.get("id", UNDEF), "l": p["name"] + " (" + js_or(p.get("title"), default) + "), " + asked_ago(k.get("requestedAt"), ctx.get("now"), k.get("lastReminderAt"))}

    pk = [lab(k, "expert") for k in pend if k.get("kind") == "sme"]
    psl = [lab(k, "stakeholder") for k in pend if k.get("kind") != "sme"]
    pa = []
    for a in c.get("attestations") or []:
        if a.get("status") in ("confirmed", "declined"):
            continue
        short = js_or(next((k for k in R["controls"] if k["id"] == a.get("controlId")), {}).get("short"), a.get("controlId", UNDEF))
        pa.append({"v": "a:" + js_str(a.get("controlId", UNDEF)),
                   "l": by_id(a.get("personId"))["name"] + " (confirmer for " + js_str(short) + "), "
                   + asked_ago(js_or(a.get("requestedAt"), a.get("at"), c.get("updatedAt")), ctx.get("now"), a.get("lastReminderAt"))})
    if pk or psl or pa:
        groups = [{"name": "whoE", "label": "Experts", "type": "checks", "options": pk, "value": []},
                  {"name": "whoS", "label": "Process stakeholders", "type": "checks", "options": psl, "value": []},
                  {"name": "whoC", "label": "Confirmers", "type": "checks", "options": pa, "value": []}]
        A("remind", "Send reminders", tone="soft", confirmLabel="Send", intro="These people have been asked and have not responded. Tick the ones to remind.",
          fields=[g for g in groups if g["options"]])


# Re-exported for tests that used build 27's names for these internal pieces.
__all__ = ["actions_for", "TAB_APPROVE", "missing_required_consults", "pending_required_experts", "expert_names"]
