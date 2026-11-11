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
from aura_engine import constants, controls, matching, people, review
from aura_engine.derived import EXC_KINDS
from aura_engine.rules import GOAL_DEFS, goal_met
from aura_engine.derived import EXC_KINDS
from aura_engine.rules import GOAL_DEFS, goal_met
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
            e = mask_log(e, viewer)
            actor = constants.by_id(e.get("actor")) if e.get("actor") else None
            rows.append({**e, "caseId": c["id"], "caseTitle": c["title"],
                         "actorName": actor["name"] if actor else ""})
    return sorted(rows, key=lambda r: r["ts"], reverse=True)


AUDIT_PAGE = 250  # rows shown on the page; the CSV export has every row


def filter_audit(rows: list[dict], who: str | None, q: str | None) -> list[dict]:
    """The Audit log filters. ``who`` is ``auto``, a case id or a person id.
    ``q`` searches the action, detail, case title and case id, ignoring case.
    JavaScript ``vAudit`` (the filter lines)."""
    if who == "auto":
        rows = [r for r in rows if r.get("auto")]
    elif who and (who.startswith("UC-") or any(r["caseId"] == who for r in rows)):
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


# ---- training ----

TRAINING_MANAGERS = {"lead", "auditor", "admin"}  # who sees the "who has completed what" table


def training_people() -> list[dict]:
    """Everyone training applies to: not the demo admin or the read-only auditor."""
    return [p for p in constants.PEOPLE if p["role"] not in ("admin", "auditor")]


def training_card(t: dict, training: dict, person: dict, now: int) -> dict:
    """One course as this person sees it: its state and when they did it. JavaScript ``vTraining`` (cards)."""
    rec = people.training_rec(training, person["id"], t["id"])
    months = t.get("refreshMonths") or 12
    return {**t, "refreshMonths": months, "state": people.training_state(training, person["id"], t, now),
            "completedAt": rec["at"] if rec else None, "completedVersion": (rec.get("ver") or t.get("version")) if rec else None,
            "validUntil": rec["at"] + months * 30.4375 * constants.DAY if rec else None}


def training_due(trainings: list[dict], training: dict, person: dict, now: int) -> list[dict]:
    """Courses this person has never done or that have lapsed. JavaScript ``trainDue``."""
    return [t for t in trainings if people.training_applies(t, person)
            and people.training_state(training, person["id"], t, now) in ("due", "overdue")]


def training_page(rules: dict, training: dict, person: dict, now: int) -> dict:
    """Everything the Training page shows. JavaScript ``vTraining``."""
    trainings = rules.get("trainings") or []
    out = {"mine": [training_card(t, training, person, now) for t in trainings if people.training_applies(t, person)],
           "dueCount": len(training_due(trainings, training, person, now)),
           "canMark": person["role"] not in ("admin", "auditor"),
           "canRemind": person["role"] in ("lead", "admin"),
           "matrix": None}
    if person["role"] in TRAINING_MANAGERS:
        units = {u["id"]: u["label"] for u in rules.get("units") or []}
        out["matrix"] = {
            "trainings": [{"id": t["id"], "title": t["title"]} for t in trainings],
            "rows": [{"id": p["id"], "name": p["name"], "title": p.get("title", ""), "unit": units.get(p.get("unit"), ""),
                      "states": {t["id"]: people.training_state(training, p["id"], t, now) if people.training_applies(t, p) else None
                                 for t in trainings}}
                     for p in training_people()]}
    return out


# ---- dashboard ----

EXC_PERIODS = [[30, "Last 30 days"], [90, "Last 90 days"], [180, "Last 180 days"], [365, "Last year"], [0, "All time"]]
_REMEDIATED_AT = [("Triage", "Triage"), ("Vetting", "Vetting"), ("Panel", "Panel"), ("Executive", "Executives")]
_REJECTED_AT = {"panel": "panel review", "exec": "executive review", "pilot": "pilot review"}


def _late(c: dict, now: int) -> bool:
    """Past its due date and not closed. JavaScript ``isLate``."""
    return bool(c.get("dueAt")) and c["stage"] != "closed" and c["dueAt"] < now


def dashboard_stats(cases: list[dict], now: int) -> dict:
    """The headline figures. JavaScript ``stat``."""
    open_ = [c for c in cases if c["stage"] not in ("closed", "production")]
    overdue = [c for c in cases if _late(c, now)]
    done = []
    for c in cases:  # days from logging to the first time the case reached production or was closed
        e = next((a for a in c.get("audit") or [] if a.get("to") in ("production", "closed")), None)
        if e:
            done.append((e["ts"] - c["createdAt"]) / constants.DAY)
    prod = sum(c["stage"] == "production" for c in cases)
    rej = sum(c["stage"] == "closed" for c in cases)
    submitted = sum(any(a.get("action") == "Submitted for triage" for a in c.get("audit") or []) for c in cases)
    returned = sum(any(a.get("tag") == "remediate" for a in c.get("audit") or []) for c in cases)
    sent_back: dict = {}
    for c in cases:
        for a in c.get("audit") or []:
            if a.get("tag") == "remediate":
                k = next((label for prefix, label in _REMEDIATED_AT if (a.get("action") or "").startswith(prefix)), "Monitoring")
                sent_back[k] = sent_back.get(k, 0) + 1
    value = sum(_num(c.get("form", {}).get("valueUSD")) for c in cases if c["stage"] in ("pilot", "production"))
    return {
        "open": len(open_), "overdue": len(overdue), "overduePct": len(overdue) / len(open_) * 100 if open_ else 0,
        "avgDays": sum(done) / len(done) if done else 0, "prod": prod, "rejected": rej,
        "reachProdPct": prod / (prod + rej) * 100 if prod + rej else 0, "sentBackPct": returned / submitted * 100 if submitted else 0,
        "sentBackAt": sent_back, "valueTotal": value,
        "inReview": sum(c["stage"] in ("vetting", "panel", "exec", "pilot") for c in cases),
        "alerts": sum(bool(E.measure_flags(c) or E.acceptance_expired(c, now)) for c in cases),
    }


def _num(v) -> float:
    """JavaScript ``+v || 0``: a number, or 0 for blanks and text."""
    try:
        n = float(v)
    except (TypeError, ValueError):
        return 0
    return 0 if n != n else n  # NaN counts as 0


def _goal(rules: dict, goal_id: str, actual: float, has_data: bool) -> dict | None:
    """A goal next to a figure, and whether the figure meets it. JavaScript ``goalChip`` and ``goalCls``."""
    d = next((x for x in GOAL_DEFS if x["id"] == goal_id), None)
    g = (rules.get("goals") or {}).get(goal_id)
    if not d or not g or not g.get("on"):
        return None
    v = g["value"]
    text = f"{v} days" if goal_id == "avgDays" else _money_short(float(v) * 1000) if goal_id == "value" else f"{v}%"
    met = goal_met(d, round(actual), float(v)) if has_data else None
    return {"text": text, "met": met}


def _money_short(n: float) -> str:
    """$1.2M, $340K or $900. JavaScript ``moneyShort``."""
    if n >= 1e6:
        return "$" + f"{n / 1e6:.1f}".removesuffix(".0") + "M"
    return "$" + str(round(n / 1e3)) + "K" if n >= 1e3 else "$" + str(round(n))


def alert_rows(cases: list[dict], now: int) -> list[dict]:
    """Cases past a KPI stop limit or with an expired approval. JavaScript ``alertsCard``."""
    rows = []
    for c in cases:
        items = [f"Stop limit passed: {r['m']['name']} (latest result {r['value']}, "
                 f"{'above' if r['m'].get('dir') == 'lower' else 'below'} the limit of {r['m']['stop']})" for r in E.measure_flags(c)]
        if E.acceptance_expired(c, now):
            items.append("Approval expired " + short_date(c["acceptance"]["validUntil"]))
        if items:
            rows.append({"id": c["id"], "title": c["title"], "stageLabel": constants.STAGE_LABEL[c["stage"]],
                         "tier": c.get("tier"), "tierLabel": constants.TIER_LABEL.get(c.get("tier") or "", ""), "items": items})
    return rows


def training_summary(rules: dict, training: dict, now: int) -> list[dict]:
    """Completion per course across everyone it applies to. JavaScript ``trainingCard``."""
    out = []
    for t in rules.get("trainings") or []:
        states = [people.training_state(training, p["id"], t, now) for p in training_people() if people.training_applies(t, p)]
        out.append({"id": t["id"], "title": t["title"], "requiredToSubmit": bool(t.get("requiredToSubmit")), "applies": len(states),
                    "ok": sum(s in ("current", "soon") for s in states), "soon": states.count("soon"),
                    "notDone": sum(s in ("due", "overdue") for s in states)})
    return out


def dashboard(data: dict, viewer: dict, now: int, ex_days: int = 180) -> dict:
    """Everything the Dashboard shows. JavaScript ``vDash``."""
    cases, rules = data["cases"], data["rules"]
    st = dashboard_stats(cases, now)
    by_id = {c["id"]: c for c in cases}

    pipeline = []
    for s in constants.STAGES:
        here = [c for c in cases if c["stage"] == s]
        tiers = {t: sum((c.get("tier") or "none") == t for c in here) for t in ("low", "moderate", "high", "critical", "none")}
        pipeline.append({"stage": s, "label": constants.STAGE_LABEL[s], "total": len(here), "tiers": tiers})

    rejected: dict = {}
    for c in cases:
        if c["stage"] == "closed":
            k = (c.get("closed") or {}).get("from") or "other"
            rejected[k] = rejected.get(k, 0) + 1

    late = sorted([c for c in cases if c["stage"] != "closed" and c.get("dueAt") and c["dueAt"] < now], key=lambda c: c["dueAt"])[:6]
    since = now - ex_days * constants.DAY if ex_days else 0
    exceptions = [{**r, "cases": [{"id": i, "title": by_id[i]["title"], "stageLabel": constants.STAGE_LABEL[by_id[i]["stage"]],
                                   "tier": by_id[i].get("tier"), "tierLabel": constants.TIER_LABEL.get(by_id[i].get("tier") or "", "")}
                                  for i in r["cases"] if i in by_id]}
                  for r in E.exception_data(cases, since, rules)]

    return {
        "kpis": {
            "open": st["open"], "inReview": st["inReview"], "alerts": st["alerts"],
            "overdue": {"count": st["overdue"], "pct": round(st["overduePct"]), "goal": _goal(rules, "overdue", st["overduePct"], st["open"] > 0)},
            "avgDays": {"value": round(st["avgDays"]) if st["avgDays"] else None, "goal": _goal(rules, "avgDays", st["avgDays"], st["avgDays"] > 0)},
            "reachProd": {"pct": round(st["reachProdPct"]), "goal": _goal(rules, "reachProd", st["reachProdPct"], st["prod"] + st["rejected"] > 0)},
            "sentBack": {"pct": round(st["sentBackPct"]), "goal": _goal(rules, "sentBack", st["sentBackPct"], True)},
            "value": {"text": _money_short(st["valueTotal"]), "goal": _goal(rules, "value", st["valueTotal"] / 1000, True)},
        },
        "pipeline": pipeline,
        "sentBackAt": [{"label": k, "count": n} for k, n in sorted(st["sentBackAt"].items(), key=lambda kv: -kv[1])],
        "rejected": [{"label": _REJECTED_AT.get(k, k), "count": n} for k, n in rejected.items()],
        "mostOverdue": [{"id": c["id"], "title": c["title"], "stageLabel": constants.STAGE_LABEL[c["stage"]],
                         "daysOverdue": max(1, (now - c["dueAt"]) // constants.DAY), "dueAt": c["dueAt"]} for c in late],
        "recent": audit_entries(cases, viewer)[:8],
        "alerts": alert_rows(cases, now),
        "exceptions": {"days": ex_days, "periods": EXC_PERIODS, "kinds": EXC_KINDS, "rows": exceptions},
        "training": training_summary(rules, data["meta"].get("training") or {}, now) if viewer["role"] in TRAINING_MANAGERS else None,
    }


def cases_csv(cases: list[dict], now: int) -> str:
    """Every case as CSV, by id. JavaScript ``casesCsv``."""
    def day(ms):
        return datetime.fromtimestamp(ms / 1000, timezone.utc).strftime("%Y-%m-%d") if ms else ""
    rows = [["ID", "Title", "Proposed solution", "Stage", "Tier", "Inherent risk", "Residual risk", "Submitter", "Owner", "Sponsor",
             "Annual value USD", "Cost USD", "Logged", "Due", "Days in stage", "Approval valid until", "Stop limits passed"]]
    for c in sorted(cases, key=lambda c: c["id"]):
        f, sc = c.get("form") or {}, c.get("scoring")
        rows.append([c["id"], c["title"], f.get("solution") or "", constants.STAGE_LABEL[c["stage"]],
                     constants.TIER_LABEL[c["tier"]] if c.get("tier") else "", sc["inherent"] if sc else "", sc["residual"] if sc else "",
                     constants.by_id(c.get("submitterId"))["name"], f.get("owner"), f.get("sponsor"), f.get("valueUSD"), f.get("costUSD"),
                     day(c["createdAt"]), day(c.get("dueAt")), max(0, (now - c["stageSince"]) // constants.DAY),
                     day((c.get("acceptance") or {}).get("validUntil")), "; ".join(r["m"]["name"] for r in E.measure_flags(c))])
    return E.to_csv(rows)
