"""The use case form, new cases, and comparing two versions of a form.

A case (``c``) is one dict that holds everything about one idea as it moves through the stages:
the submitter's form (``c["form"]``), triage and scoring results, consults, reviewers' votes,
decisions, the pilot and production records, the audit trail and the outbox of emails.
"""

from __future__ import annotations

from .audit import seal_audit
from .constants import by_id
from .jsx import UNDEF, is_nan, js_json, js_or, nullish, to_num, truthy
from .rules import norm_rules

# The form fields triage checks for. A number, including zero, counts as an answer.
FORM_FIELDS = [
    {"k": "ucType", "label": "Type of AI use case"},
    {"k": "problem", "label": "Problem to solve"},
    {"k": "solution", "label": "Proposed solution"},
    {"k": "businessCase", "label": "Business case"},
    {"k": "successMetric", "label": "Success metric"},
    {"k": "dataRequired", "label": "Data required"},
    {"k": "process", "label": "Affected process or department"},
    {"k": "owner", "label": "Owner"},
    {"k": "sponsor", "label": "Sponsor"},
    {"k": "costUSD", "label": "One-time cost (zero is fine)"},
    {"k": "ongoingCostUSD", "label": "Ongoing cost (zero is fine)"},
    {"k": "budgetSource", "label": "Whose budget pays for it"},
]

ONGOING_BASIS = {"total_year": "total, per year", "per_user_month": "per user, per month"}

# Labels for the fields compared when a form changes, in display order.
# (Build 27 listed costUSD twice; JavaScript kept the first position and the last label, as here.)
DIFF_LABEL = {
    "ucType": "Type of AI use case", "problem": "Problem", "solution": "Proposed solution", "businessCase": "Business case",
    "successMetric": "Success metric", "dataRequired": "Data required", "process": "Process", "users": "Users",
    "sponsor": "Sponsor", "valueUSD": "Annual value", "costUSD": "One-time cost", "scope": "Reach", "autonomy": "Autonomy",
    "ongoingCostUSD": "Ongoing cost", "ongoingBasis": "Ongoing cost basis", "budgetSource": "Budget source",
    "alternatives": "Alternatives considered", "costOfNothing": "Cost of doing nothing", "measures": "KPIs",
    "answers": "Risk answers", "readiness": "Data readiness answers", "controls": "Controls", "attesters": "Attesters",
    "evidence": "Evidence",
}


def is_blank(v) -> bool:
    """Only an empty value is missing: None, or text that is only spaces. JavaScript ``isBlank``."""
    return nullish(v) or (isinstance(v, str) and not v.strip())


def budget_flag(form, r0):
    """BR-43: a per-user running cost above the limit, which calls for extra budget scrutiny. JavaScript ``budgetFlag``.

    Returns ``{amount, limit}`` or None. It never stops or scores a case.
    """
    rules = norm_rules(r0)
    limit = to_num((rules.get("budget") or {}).get("perUserMonthly", UNDEF))
    if (truthy(form) and form.get("ongoingBasis") == "per_user_month" and not is_blank(form.get("ongoingCostUSD"))
            and to_num(form["ongoingCostUSD"]) > limit):
        return {"amount": to_num(form["ongoingCostUSD"]), "limit": limit}
    return None


def blank_form(owner=None, owner_id=None) -> dict:
    """An empty use case form. JavaScript ``blankForm``."""
    return {
        "ucType": "", "problem": "", "solution": "", "businessCase": "", "successMetric": "", "measures": [], "attesters": {},
        "evidence": {}, "dataRequired": "", "process": "", "users": "", "owner": js_or(owner, ""), "ownerId": js_or(owner_id, ""),
        "sponsor": "", "valueUSD": "", "costUSD": "", "ongoingCostUSD": "", "ongoingBasis": "total_year", "budgetSource": "",
        "alternatives": "", "costOfNothing": "", "scope": "team", "autonomy": "advice", "answers": {}, "readiness": {}, "controls": [],
    }


def new_case(case_id, title, idea, submitter_id, now, rv=None) -> dict:
    """A new case in the suggestion box, with its first audit entry sealed. JavaScript ``newCase``."""
    c = {
        "id": case_id, "title": title, "idea": idea, "submitterId": submitter_id, "createdAt": now, "stage": "suggestion",
        "stageSince": now, "dueAt": None, "returned": None, "form": blank_form(by_id(submitter_id)["name"], submitter_id),
        "evidenceItems": [], "signoff": None, "ownerAccepted": None, "acceptance": None, "measurements": [], "attestations": [],
        "triage": None, "scoring": None, "tier": None, "vetting": None, "consults": [], "panelNotes": [], "panelDecision": None,
        "briefing": None, "execDecision": None, "pilot": None, "production": None, "closed": None,
        "audit": [{"ts": now, "actor": submitter_id, "action": "Suggestion logged", "note": idea, "from": None, "to": "suggestion", "auto": False, "tag": ""}],
        "outbox": [],
    }
    return seal_audit(c, js_or(rv, 1), now)


def changed_fields(a: dict, b: dict) -> list[str]:
    """Labels of the form fields that differ between two forms. JavaScript ``changedFields``."""
    def val(f, k):
        v = f.get(k)
        return "" if nullish(v) else v
    return [DIFF_LABEL[k] for k in DIFF_LABEL if js_json(val(a, k)) != js_json(val(b, k))]


def _answer_ids(a: dict, b: dict) -> list[str]:
    ids: list[str] = []
    for k in list((a.get("answers") or {}).keys()) + list((b.get("answers") or {}).keys()):
        if k not in ids:
            ids.append(k)
    return ids


def form_diff(a, b, rules) -> list[str]:
    """What changed between two forms, in short readable lines. JavaScript ``formDiff``.

    Shown to the governance lead when the submitter resubmits a returned case.
    """
    if not truthy(a) or not truthy(b):
        return []

    def sh(v):
        t = v if isinstance(v, str) else js_json(v)
        if not t:
            return "(blank)"
        return t[:87] + "..." if len(t) > 90 else t

    out = []
    for k in DIFF_LABEL:
        if js_json(js_or(a.get(k), "")) != js_json(js_or(b.get(k), "")):
            out.append(DIFF_LABEL[k] + ": was " + sh(js_or(a.get(k), "")) + ", now " + sh(js_or(b.get(k), "")))
    qs = (rules or {}).get("questions") or []
    for qid in _answer_ids(a, b):
        if js_json((a.get("answers") or {}).get(qid, UNDEF)) != js_json((b.get("answers") or {}).get(qid, UNDEF)):
            q = next((x for x in qs if x["id"] == qid), None)
            out.append("Risk question: " + (q["text"] if q else qid) + " (changed)")
    return out


def form_diff_names(a, b, rules) -> list[str]:
    """Just the names of what changed between two forms, without repeats. JavaScript ``formDiffNames``."""
    if not truthy(a) or not truthy(b):
        return []
    out = [DIFF_LABEL[k] for k in DIFF_LABEL if js_json(js_or(a.get(k), "")) != js_json(js_or(b.get(k), ""))]
    qs = (rules or {}).get("questions") or []
    for qid in _answer_ids(a, b):
        if js_json((a.get("answers") or {}).get(qid, UNDEF)) != js_json((b.get("answers") or {}).get(qid, UNDEF)):
            q = next((x for x in qs if x["id"] == qid), None)
            out.append(js_or(q.get("short"), q.get("text")) if q else qid)
    seen: list[str] = []
    for x in out:
        if x not in seen:
            seen.append(x)
    return seen


def ready_status(form: dict, rules: dict) -> dict:
    """How many enabled data readiness checks are answered Yes, and whether that is enough. JavaScript ``readyStatus``."""
    checks = [r for r in rules["readiness"] if r.get("enabled") is not False]
    count = sum(1 for r in checks if (form.get("readiness") or {}).get(r["id"]) is True)
    return {"count": count, "of": len(checks), "need": rules["minReady"], "ok": count >= rules["minReady"]}


def three_year_roi(f: dict) -> dict:
    """A simple three-year return. JavaScript ``threeYearRoi``.

    Needs the ongoing cost as a yearly total: a per-user cost cannot become a total without the
    number of users, so that case returns ``{"reason": "per_user"}``.
    """
    if f.get("ongoingBasis") == "per_user_month":
        return {"reason": "per_user"}
    if not (to_num(f.get("valueUSD", UNDEF)) > 0):
        return {"reason": "no_value"}
    if is_blank(f.get("costUSD")) or is_blank(f.get("ongoingCostUSD")) or is_nan(f.get("costUSD", UNDEF)) or is_nan(f.get("ongoingCostUSD", UNDEF)):
        return {"reason": "no_cost"}
    cost = to_num(f["costUSD"]) + 3 * to_num(f["ongoingCostUSD"])
    value = 3 * to_num(f["valueUSD"])
    net = value - cost
    return {"cost": cost, "value": value, "net": net, "roi": net / cost if cost > 0 else None}
