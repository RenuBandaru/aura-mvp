"""Consults: which subject matter experts a case needs, and who can be asked for a second look.

Each consult area in the rules (cybersecurity, legal, data steward, and so on) names one expert
and a list of triggers. A trigger is a set of terms that must all hold; its level is
``required`` (the expert must answer before reviewers can decide) or ``recommended``.

A consult request on a case is a dict in ``c["consults"]`` with ``kind`` ``"sme"`` (an expert) or
``"stakeholder"`` (a process stakeholder whose feedback never holds the decision).
"""

from __future__ import annotations

from .constants import by_id
from .forms import form_diff_names
from .jsx import UNDEF, date_string, js_or, js_str, truthy
from .matching import term_hit
from .rules import norm_rules


def consult_needs(form, r0) -> dict:
    """The consult areas this form triggers, strongest level first wins. JavaScript ``consultNeeds``.

    Returns ``{area_id: {id, label, personId, question, level, reasons}}`` for areas whose level is
    required or recommended. A ``baseline`` area is recommended for every case.
    """
    rules = norm_rules(r0)
    out = {}
    for a in rules.get("consultAreas") or []:
        if a.get("enabled") is False:
            continue
        o = {"id": a["id"], "label": a["label"], "personId": a["personId"], "question": js_or(a.get("question"), ""), "level": None, "reasons": []}
        if truthy(a.get("baseline")):
            o["level"] = "recommended"
            o["reasons"].append({"level": "recommended", "label": "Recommended for every use case for now"})
        for tr in a.get("triggers") or []:
            when = tr.get("when") or []
            if when and all(term_hit(t, js_or(form, {}), rules) for t in when):
                lvl = "required" if tr.get("level") == "required" else "recommended"
                if lvl == "required":
                    o["level"] = "required"
                elif not o["level"]:
                    o["level"] = "recommended"
                o["reasons"].append({"level": lvl, "label": tr["label"]})
        if o["level"]:
            out[a["id"]] = o
    return out


def missing_required_consults(c: dict, rules: dict, duty_block) -> list[str]:
    """Required consult areas with no request yet, as text. Shared by the panel blockers and the action list.

    When the area's expert is not independent of this case, the text says so and asks the lead to
    give the area to someone else. (Build 27 wrote this expression out twice, identically.)
    """
    if truthy(c.get("legacy")):
        return []
    out = []
    for n in consult_needs(c["form"], rules).values():
        if n["level"] != "required" or any(k.get("personId") == n["personId"] for k in (c.get("consults") or [])):
            continue
        blk = duty_block(c, n["personId"], "expert")
        out.append(n["label"] + (" (no independent expert: " + _strip_on_it(blk) + "; assign the area to someone else)" if blk else ""))
    return out


def _strip_on_it(text: str) -> str:
    return text[: -len(" on it.")] if text.endswith(" on it.") else text


def second_look_options(c: dict, rules: dict) -> list[dict]:
    """Earlier answers that can be asked for a second look: the latest answered request per person. JavaScript ``secondLookOptions``."""
    need = {} if truthy(c.get("legacy")) else consult_needs(c["form"], rules)
    consults = c.get("consults") or []
    out = []
    for k in consults:
        if k.get("status") == "pending" or truthy(k.get("supersededBy")) or not truthy(k.get("response")):
            continue
        if any(x.get("personId") == k.get("personId") and x.get("status") == "pending" for x in consults):
            continue
        a = next((x for x in (rules.get("consultAreas") or []) if x["id"] == k.get("areaId")), None)
        n = need.get(k["areaId"]) if truthy(k.get("areaId")) else None
        p = by_id(k.get("personId"))
        what = (a["label"] if a else "expert") if k.get("kind") == "sme" else "process stakeholder"
        label = p["name"] + " (" + what + "), answered " + date_string(js_or(k["response"].get("at"), k.get("requestedAt")))
        if k.get("kind") == "sme" and not n:
            label += ", area no longer triggered"
        base = js_or(k.get("formSnap"), c.get("formAtReturn"))
        if truthy(base):
            nm = form_diff_names(base, c["form"], rules)
            if nm:
                label += ". Changed since: " + ", ".join(nm[:5]) + (" and " + js_str(len(nm) - 5) + " more" if len(nm) > 5 else "")
            else:
                label += ". Nothing changed since"
        out.append({"v": k.get("id", UNDEF), "l": label})
    return out
