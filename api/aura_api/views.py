"""Shapes engine data into what each screen needs.

Rule of thumb: if a screen needs to *decide* something (who can act, what is missing, whether a review
is ready), the decision is made here or in the engine, never in React. React only lays out the result.

Most functions here are ports of small view helpers from build 27's ``ui.js`` (``queueFor``,
``whyText``, ``maskLog``). Their docstrings name the original.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone

import aura_engine as E
from aura_engine import constants, controls, matching, review
from aura_engine.jsx import short_date
from aura_engine.tools import TOOL_STATUS

# Actions that tidy a case rather than move it on. They do not put a case in someone's queue. (ui.js queueFor)
NOT_QUEUE_WORK = {"save_draft", "review_draft", "reopen", "allow_again", "request_confirmations", "add_evidence", "remove_evidence",
                  "remove_control", "ask_adviser", "set_adviser", "rv_decline"}

# Roles that may read reviewers' notes and experts' responses in the activity log. (ui.js seesInternal)
SEES_INTERNAL = {"lead", "panel", "exec", "auditor", "admin"}
INTERNAL_LOG = re.compile(r"^(Panel note|Executive note|Expert responded|Stakeholder feedback)")
DAY = constants.DAY


def person_view(p: dict) -> dict:
    return {"id": p["id"], "name": p["name"], "role": p["role"], "roleLabel": constants.ROLE_LABEL.get(p["role"], p["role"]),
            "title": p.get("title", ""), "unit": p.get("unit")}


def mask_log(entry: dict, viewer: dict) -> dict:
    """Hide reviewer notes and expert answers from people outside the review. JavaScript ``maskLog``."""
    if viewer.get("role") in SEES_INTERNAL or not INTERNAL_LOG.match(entry.get("action") or ""):
        return entry
    action = "Response received" if re.match(r"^(Expert|Stakeholder)", entry["action"]) else "Reviewer note recorded"
    return {**entry, "action": action, "note": ""}


def visible_case(c: dict, viewer: dict) -> dict:
    """The case as this person may see it."""
    return {**c, "audit": [mask_log(e, viewer) for e in c.get("audit") or []]}


def gap_summary(c: dict, rules: dict) -> dict:
    """Counts behind the "Missing" chips. JavaScript ``gapChip``."""
    g = E.case_gaps(c, rules)
    other = [q for q in g["questions"] if q not in g["gates"]] + list(g["readiness"])
    return {"gates": len(g["gates"]), "newStops": len(g["newStops"]), "other": len(other)}


def case_row(c: dict, ctx: dict) -> dict:
    """One line in a list of cases. JavaScript ``caseRow``."""
    now = ctx["now"]
    flags = [r["m"]["name"] for r in E.measure_flags(c)]
    return {
        "id": c["id"], "title": c["title"], "submitterId": c.get("submitterId"), "ownerId": c.get("form", {}).get("ownerId"),
        "adviserId": c.get("adviserId"), "stage": c["stage"], "stageLabel": constants.STAGE_LABEL.get(c["stage"], c["stage"]),
        "tier": c.get("tier"), "tierLabel": constants.TIER_LABEL.get(c.get("tier") or "", ""), "returned": bool(c.get("returned")) and c["stage"] == "use_case",
        "dueAt": c.get("dueAt"), "late": bool(c.get("dueAt")) and c["stage"] != "closed" and c["dueAt"] < now, "stageSince": c.get("stageSince"),
        "gaps": gap_summary(c, ctx["rules"]), "stopFlags": flags, "acceptanceExpired": bool(E.acceptance_expired(c, now)),
        "notPermitted": bool((c.get("closed") or {}).get("notPermitted")),
    }


def why_text(c: dict, person: dict, ctx: dict) -> str:
    """Why a case is in this person's queue, in one sentence. JavaScript ``whyText``."""
    rules, now = ctx["rules"], ctx["now"]
    mc = next((k for k in c.get("consults") or [] if k["personId"] == person["id"] and k["status"] == "pending"), None)
    if mc:
        due = " by " + short_date(mc["dueAt"]) if mc.get("dueAt") else ""
        return ("Response required" if mc["kind"] == "sme" else "Feedback welcome") + due + ". " + (mc.get("question") or "")
    pa = next((a for a in c.get("attestations") or [] if a["personId"] == person["id"] and a["status"] == "pending"), None)
    if c["stage"] in ("panel", "exec") and person["role"] in ("panel", "exec", "lead"):
        rd, mv = E.rev_ready(c, rules), E.rev_votes(c).get(person["id"])
        if rd and rd.get("ok"):
            return "Ready to finalize: " + str(rd["firm"]) + " agree on " + review.dec_label(rd["dec"], c.get("tier"), c["stage"]).lower() + "."
        if E.rev_deadlock(c, rules, now) and person["role"] == "lead" and c["stage"] == "panel":
            return "The reviewers disagree. You can break the deadlock."
        if mv:
            firm = (", firm" if mv.get("firm") else ", leaning") if mv["dec"] in review.FIRMABLE else ""
            return "You recorded: " + review.dec_label(mv["dec"], c.get("tier"), c["stage"]).lower() + firm + ". Waiting on the others. You can change it until the case is decided."
    if pa:
        k = next((k for k in rules["controls"] if k["id"] == pa["controlId"]), {})
        return "Please confirm a control: " + (k.get("text") or pa["controlId"]) + "."
    so = c.get("signoff") or {}
    if so.get("status") == "requested" and c["stage"] == "use_case" and so.get("ownerId") == person["id"]:
        return constants.by_id(so.get("requestedBy"))["name"] + " asks you to sign off as owner."
    flags = E.measure_flags(c)
    if flags:
        return "A stop limit was passed: " + ", ".join(r["m"]["name"] for r in flags) + "."
    if E.acceptance_expired(c, now):
        return "The approval has expired. Renew it or reassess."
    if c.get("returned") and c["stage"] == "use_case":
        return ("The owner declined: " if c["returned"].get("from") == "owner" else "Returned: ") + (c["returned"].get("reason") or "")
    return {"suggestion": "New idea to shape into a use case.", "use_case": "Complete the details and submit for triage.",
            "vetting": "Vet this case and choose where it goes next.", "panel": "Standing panel review.", "exec": "Executive decision.",
            "pilot": "Pilot is running. Review when due.", "production": "In production. Monitoring review."}.get(c["stage"], "")


def queue_for(person: dict, cases: list[dict], ctx: dict) -> list[dict]:
    """The cases waiting for this person, with why. JavaScript ``queueFor``."""
    now, items = ctx["now"], []
    for c in sorted(cases, key=lambda x: x["id"]):
        acts = [a for a in E.actions_for(c, person, ctx) if a["id"] not in NOT_QUEUE_WORK]
        if not acts:
            continue
        if c["stage"] == "production":
            quiet = c.get("production") and now < c["production"]["nextReviewAt"] - 14 * DAY and not E.measure_flags(c) and not E.acceptance_expired(c, now)
            if (person["role"] == "lead" and quiet) or (person["role"] != "lead" and not c.get("returned")):
                continue
        ids = [a["id"] for a in acts]
        items.append({**case_row(c, ctx), "why": why_text(c, person, ctx), "actions": ids,
                      "readyToFinalize": any(re.match(r"^(panel|exec)_(approve|waive|recommend|escalate|remediate|reject)$", i) for i in ids),
                      "deadlock": any(i in ("panel_break", "exec_break") for i in ids)})
    return items


def waiting_for(c: dict, ctx: dict) -> list[str]:
    """People who have real work on this case now (the same rule as the queue: tidy-up actions do not count)."""
    return [p["id"] for p in constants.PEOPLE
            if any(a["id"] not in NOT_QUEUE_WORK and not a.get("disabled") for a in E.actions_for(c, p, ctx))]


def review_view(c: dict, rules: dict, now: int) -> dict | None:
    """Votes and what is holding the decision, for the panel and executive stages."""
    if c["stage"] not in ("panel", "exec"):
        return None
    votes = E.rev_votes(c)
    return {
        "votes": [{"personId": pid, "dec": v.get("dec"), "label": review.dec_label(v.get("dec"), c.get("tier"), c["stage"]), "firm": bool(v.get("firm")), "at": v.get("at")}
                  for pid, v in votes.items()],
        "pool": E.rev_pool(c),
        "need": E.rev_need(c, rules), "blockers": E.rev_blockers(c, rules), "ready": E.rev_ready(c, rules),
        "deadlock": E.rev_deadlock(c, rules, now),
    }


def case_detail(c: dict, viewer: dict, ctx: dict) -> dict:
    """Everything the case page shows, computed once on the server."""
    rules, now = ctx["rules"], ctx["now"]
    form = c.get("form") or {}
    acts = E.actions_for(c, viewer, ctx)
    return {
        "case": visible_case(c, viewer),
        "row": case_row(c, ctx),
        "actions": acts,
        "editable": c["stage"] == "use_case" and any(a["id"] in ("submit", "signoff_accept") for a in acts),
        "waitingOn": waiting_for(c, ctx),
        "scoring": E.run_scoring(form, rules, c.get("attestations")) if c["stage"] not in ("suggestion",) else None,
        "support": controls.support_view(c, rules),
        "measures": E.measure_board(c),
        "stopFlags": [r["m"]["name"] for r in E.measure_flags(c)],
        "consultNeeds": E.consult_needs(form, rules),
        "review": review_view(c, rules, now),
        "roi": E.three_year_roi(form),
        "budgetFlag": E.budget_flag(form, rules),
        "auditCheck": E.verify_audit(c),
    }


def form_preview(form: dict, rules: dict) -> dict:
    """Live feedback while someone edits a use case form: which questions and controls apply, what is missing."""
    return {
        "questionsShown": [q["id"] for q in rules["questions"] if q.get("enabled") is not False and matching.q_applies(q, form, rules)],
        "controlNeeds": E.control_needs(form, rules),
        "consultNeeds": E.consult_needs(form, rules),
        "gaps": E.form_gaps(form, rules),
        "unclaimedRequired": [k["id"] for k in E.unclaimed_required(form, rules)],
        "ready": E.ready_status(form, rules),
        "triage": E.run_triage(form, rules),
        "budgetFlag": E.budget_flag(form, rules),
        "roi": E.three_year_roi(form),
        "submitGaps": submit_gaps(form, rules),
    }


def tool_view(t: dict, viewer: dict) -> dict:
    """An AI tool catalog entry with what this person can do to it."""
    return {**t, "actions": E.tool_actions(t, viewer), "statusLabel": TOOL_STATUS.get(t["status"], t["status"])}


def outbox_for(data: dict, who: str | None = None) -> list[dict]:
    """Every simulated email, newest first, optionally only those to one person. JavaScript ``vOutbox``."""
    mails = [{**m, "ref": {"id": "TRAINING", "title": "Training"}} for m in (data["meta"].get("trainingMail") or [])]
    mails += [{**m, "ref": {"id": c["id"], "title": c["title"]}} for c in data["cases"] for m in c.get("outbox") or []]
    mails += [{**m, "ref": {"id": t["id"], "title": t["name"]}} for t in data["tools"] for m in t.get("outbox") or []]
    if who:
        mails = [m for m in mails if who in m["to"]]
    return sorted(mails, key=lambda m: (m["ts"], m.get("n", 0)), reverse=True)


def _num_or_blank(v):
    """``''`` stays blank; anything else becomes a number (JavaScript ``g(k) === '' ? '' : +g(k)``)."""
    if v is None or str(v).strip() == "":
        return ""
    try:
        n = float(v)
        return int(n) if n.is_integer() else n
    except (TypeError, ValueError):
        return ""


def clean_form(form: dict, old: dict) -> dict:
    """Turn the form as the browser typed it into the form the engine stores. Port of build 27's ``readUc``.

    KPI rows arrive as typed text and are parsed the lenient way (blank rows dropped); money becomes
    numbers; the owner's name follows the owner id. Keys the browser did not send keep their old value.
    """
    f = {**old, **form}
    if "measures" in form:
        f["measures"] = E.parse_measures(form.get("measures") or [], False)
    if "valueUSD" in form:
        n = _num_or_blank(form.get("valueUSD"))
        f["valueUSD"] = n if n != "" else 0
    for k in ("costUSD", "ongoingCostUSD"):
        if k in form:
            f[k] = _num_or_blank(form.get(k))
    if form.get("ownerId"):
        f["owner"] = constants.by_id(form["ownerId"])["name"]
    if "ongoingBasis" in form:
        f["ongoingBasis"] = form.get("ongoingBasis") or "total_year"
    return f


def submit_gaps(form: dict, rules: dict) -> dict:
    """Everything still missing before a form can be submitted. Port of build 27's ``submitGaps``."""
    from aura_engine.forms import FORM_FIELDS, is_blank
    g = E.form_gaps(form, rules)
    fields = [x["label"] for x in FORM_FIELDS if is_blank(form.get(x["k"]))]
    if not form.get("measures"):
        fields.append("At least one KPI with a target and a stop limit")
    fields += ["Claim the required control: " + n["text"] for n in E.unclaimed_required(form, rules)]
    for cid in form.get("controls") or []:
        k = next((x for x in rules["controls"] if x["id"] == cid), None)
        if k and k.get("attest") == "required" and not (form.get("attesters") or {}).get(cid):
            fields.append("Someone to confirm: " + k["text"])
    return {"questions": [{"id": q["id"], "text": q["text"]} for q in g["questions"]],
            "readiness": [{"id": r["id"], "text": r["text"]} for r in g["readiness"]], "fields": fields,
            "count": len(g["questions"]) + len(g["readiness"]) + len(fields)}


# ---- Audit Log ----

def audit_entries(cases: list[dict], viewer: dict) -> list[dict]:
    """Every audit entry from every case, newest first, as this person may see it.
    JavaScript ``vAudit`` (the part before filtering)."""

    rows = []
    for c in cases:
        for e in c.get("audit") or []:
            e = mask_log(e,viewer)
            actor = constants.by_id(e.get("actor")) if e.get("actor") else None
            rows.append({**e,"caseId": c["id"], "caseTitle": c["title"],
                         "actorName": actor["name"] if actor else "" })
    return sorted(rows, key=lambda r: r["ts"], reverse=True)


AUDIT_PAGE = 250  # rows shown on the page; the CSV export has every row


def filter_audit(rows: list[dict], who: str | None, q: str | None) -> list[dict]:
    """The Audit log filters. ``who`` is ``auto``, a case id or a person id.
    ``q`` searches the action, detail, case title and case id, ignoring case.
    JavaScript ``vAudit`` (the filter lines)."""
    if who == "auto":
        rows = [r for r in rows if r.get("auto")]
    elif who and who.startswith("UC-"):
        rows = [r for r in rows if r["caseId"] == who]
    elif who and who != "all":
        rows = [r for r in rows if r.get("actor") == who]
    if q:
        needle = q.lower()
        rows = [r for r in rows if needle in ((r.get("action") or "") + (r.get("note") or "")
                                              + r["caseTitle"] + r["caseId"]).lower()]
    return rows


def _iso(ts: int) -> str:
    """JavaScript ``new Date(ts).toISOString()``: UTC, milliseconds, ending in Z."""
    return datetime.fromtimestamp(ts / 1000, timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + f"{ts % 1000:03d}Z"


def audit_csv(cases: list[dict], viewer: dict) -> str:
    """The Audit log as CSV, oldest first, with the same masking as the screen. JavaScript ``auditCsv``."""
    rows = [["Time", "Case", "Title", "Actor", "Automated", "Action", "From", "To", "Detail", "Rules version", "Hash"]]
    for r in sorted(audit_entries(cases, viewer), key=lambda r: r["ts"]):
        rows.append([_iso(r["ts"]), r["caseId"], r["caseTitle"], r["actorName"], "yes" if r.get("auto") else "no",
                     r.get("action"), constants.STAGE_LABEL.get(r.get("from"), ""),
                     constants.STAGE_LABEL.get(r.get("to"), ""), r.get("note"), r.get("rv") or "", r.get("hash") or ""])
    return E.to_csv(rows)