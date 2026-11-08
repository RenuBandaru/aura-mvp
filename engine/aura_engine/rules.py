"""The rules object: placeholder policy that drives scoring, guardrails, controls and consults.

A rules object is plain data (a dict that can be saved as JSON). It holds:

* ``questions``: the risk questions a submitter answers. Questions hold facts only.
* ``rules``: what the answers mean. Each rule has a ``kind``:
  ``guardrail`` (stops the case at triage), ``condition`` (must be cleared before pilot or
  production), ``require`` (makes a control required or recommended), ``override`` (sets a
  minimum tier) or ``points`` (adds to the risk score).
* ``controls``: safeguards a submitter can claim, each worth some credit against the score.
* ``readiness``: data readiness checks, and ``minReady``, how many must be met.
* numbers: tier thresholds, deadlines, pilot length, review cycles, quorum sizes, goals.
* ``units``, ``consultAreas`` and ``trainings``: who advises, who is consulted, what training gates
  submitting.

Every number in the defaults is illustrative and meant to be edited by the governance lead.
The defaults are stored in ``data/default_rules.json``, generated once from build 27's
``defaultRules()`` so the port starts from exactly the same policy.

A rule's ``when`` is a list of terms, and all of them must hold. A term is either
``{"src": ..., "in": [...]}`` or a group ``{"any": [terms]}`` that holds when any member holds.
``src`` is ``type``, ``scope``, ``autonomy``, or ``q:<question id>``. See :mod:`aura_engine.matching`.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from .jsx import truthy

_DATA = Path(__file__).parent / "data" / "default_rules.json"

# Dashboard goals. "better" says which direction meets the goal (equal or better counts as met).
GOAL_DEFS = [
    {"id": "avgDays", "label": "Average time to a final outcome", "unit": "days", "min": 1, "max": 999, "better": "lower"},
    {"id": "reachProd", "label": "Percent of cases reaching production", "unit": "%", "min": 1, "max": 100, "better": "higher"},
    {"id": "sentBack", "label": "Percent sent back at least once", "unit": "%", "min": 0, "max": 100, "better": "lower"},
    {"id": "overdue", "label": "Percent of cases overdue", "unit": "%", "min": 0, "max": 100, "better": "lower"},
    {"id": "value", "label": "Value in pilot and production ($000)", "unit": "$000", "min": 1, "max": 999999999, "better": "higher"},
]


def default_goals() -> dict:
    """Starting dashboard goals. JavaScript ``defaultGoals``."""
    return {
        "avgDays": {"on": True, "value": 30}, "reachProd": {"on": True, "value": 60}, "sentBack": {"on": True, "value": 30},
        "overdue": {"on": True, "value": 25}, "value": {"on": True, "value": 500},
    }


def goal_met(goal_def: dict, actual, goal) -> bool:
    """Whether a measured value meets a goal. JavaScript ``goalMet``."""
    return actual <= goal if goal_def["better"] == "lower" else actual >= goal


@lru_cache(maxsize=1)
def _default_text() -> str:
    return _DATA.read_text(encoding="utf-8")


def default_rules() -> dict:
    """A fresh copy of the placeholder rules. JavaScript ``defaultRules``.

    Each call returns a new object, so callers may change it freely.
    """
    return json.loads(_default_text())


def norm_rules(r0):
    """Bring a saved rules object up to the current shape and return it. JavaScript ``normRules``.

    Rules from before version 4 are replaced by the defaults. Version 4 rules get any small
    migrations they are missing (each is marked by a ``migN`` flag so it runs only once) and any
    sections that are missing. The object passed in is changed in place and returned, so calling
    this on rules that are already current costs almost nothing and changes nothing.
    """
    if not truthy(r0) or r0.get("version") != 4:
        return default_rules()
    if not truthy(r0.get("mig3")):
        d = default_rules()
        for k in ("questions", "rules", "controls"):
            r0[k] = r0.get(k) or []
            have = {x["id"] for x in r0[k]}
            for x in d[k]:
                if x["id"] not in have:
                    r0[k].append(x)
        for k in ("units", "consultAreas", "trainings"):
            if not truthy(r0.get(k)):
                r0[k] = d[k]
        r0["mig3"] = True
    if not truthy(r0.get("mig4")):
        d = default_rules()["consultAreas"]
        for aid in ("ca_legal", "ca_data"):
            areas = r0.get("consultAreas") or []
            i = next((j for j, a in enumerate(areas) if a["id"] == aid), -1)
            n = next((a for a in d if a["id"] == aid), None)
            if i >= 0 and n:
                r0["consultAreas"][i] = {**r0["consultAreas"][i], "label": n["label"], "question": n["question"], "triggers": n["triggers"]}
        r0["mig4"] = True
    if not truthy(r0.get("mig6")):
        # Quorum used to count panel reviewers only; it now counts the lead too, so each number goes up by one.
        if truthy(r0.get("quorum")):
            for t in ("moderate", "high", "critical"):
                if r0["quorum"].get(t) is not None:
                    r0["quorum"][t] += 1
        r0["mig6"] = True
    if not truthy(r0.get("mig5")):
        a = next((x for x in (r0.get("consultAreas") or []) if x["id"] == "ca_legal"), None)
        if a and a.get("label") == "Legal and Government Affairs":
            a["label"] = "Legal"
        r0["mig5"] = True
    for k in ("units", "consultAreas", "trainings"):
        if not truthy(r0.get(k)):
            r0[k] = default_rules()[k]
    if not truthy(r0.get("budget")):
        r0["budget"] = {"perUserMonthly": 200}
    for k in ("ucTypes", "reviewMaxDays"):
        if not truthy(r0.get(k)):
            r0[k] = default_rules()[k]
    if not truthy(r0.get("goals")):
        r0["goals"] = default_goals()
    for k in r0.get("controls") or []:
        if not truthy(k.get("short")):
            # Read the defaults only when needed: this function runs very often.
            d = next((x for x in default_rules()["controls"] if x["id"] == k["id"]), None)
            if d:
                k["short"] = d["short"]
    return r0


def tier_from_score(score, rules: dict) -> str:
    """The tier for a risk score, using the thresholds in the rules. JavaScript ``tierFromScore``.

    With the defaults: 0 to 3 is low, 4 to 7 moderate, 8 to 12 high, above 12 critical.
    """
    t = rules["tiers"]
    if score <= t["lowMax"]:
        return "low"
    if score <= t["moderateMax"]:
        return "moderate"
    return "high" if score <= t["highMax"] else "critical"

