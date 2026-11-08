"""The rules editor: everything the Rules page asks the API, as plain functions.

How the editor works: the page keeps a *draft* of the rules in the browser. Nothing changes for anyone
until the demo admin saves. While editing, the page sends the draft here to ask questions about it:

* :func:`inspect`      what each question, rule and control is used by, whether it may be deleted,
                       each rule in words, and what changed compared with the saved rules.
* :func:`apply_item`   check one edited item (a question, rule, control, readiness check or consult
                       trigger) and put it into the draft. Ports of build 27's ``applyEdit``.
* :func:`check`        the full check before saving (errors block, warnings need a second click).
* :func:`try_answers`  the What-if tab: score imaginary answers under the draft.

Saving (``service.save_rules``) runs :func:`check` again on the server, so the browser can never save
rules the checks would refuse. Port of build 27's ui.js rules section; each function names its original.
"""

from __future__ import annotations

import re

import aura_engine as E
from aura_engine import constants, rules_editor as RE
from aura_engine.errors import EngineError
from aura_engine.jsx import clone
from aura_engine.matching import flat_terms, options_of, q_applies, rule_hit, term_q
from aura_engine.rules import GOAL_DEFS, norm_rules

# Which top-level keys belong to which tab, to mark tabs with unsaved changes. JavaScript ``SECT``.
TAB_KEYS = {
    "rules": ["rules"], "questions": ["questions"], "controls": ["controls"],
    "scoring": ["tiers", "scopePoints", "autonomyPoints", "budget"], "units": ["units"], "consults": ["consultAreas"],
    "training": ["trainings"], "readiness": ["readiness", "minReady"], "dashboard": ["goals"],
    "deadlines": ["deadlines", "pilotDays", "reviewCadenceDays", "reviewMaxDays", "quorum", "execQuorum"],
}
_ID_PREFIX = {"guardrail": "g_", "condition": "cond_", "require": "rq_", "override": "o_", "points": "pt_"}


def labels() -> dict:
    """The fixed words and choices the editor shows. They come from the engine, so React holds none."""
    return {
        "ruleKinds": constants.RULE_KINDS, "rulePlural": constants.RULE_PLURAL, "kindOrder": constants.KIND_ORDER,
        "goalDefs": GOAL_DEFS, "scopeOpts": constants.SCOPE_OPTS, "autonomyOpts": constants.AUTONOMY_OPTS,
        "tiers": constants.TIERS, "tierLabels": constants.TIER_LABEL,
        "advisers": [{"id": p["id"], "name": p["name"], "lead": p["role"] == "lead"} for p in constants.PEOPLE if p["role"] in ("adviser", "lead")],
        "experts": [{"id": p["id"], "name": p["name"], "title": p.get("title", "")} for p in constants.PEOPLE if p["role"] == "sme"],
    }


# ---- naming new items ----

def _slug(s) -> str:
    """JavaScript ``slug``: lower case, runs of other characters become one underscore, at most 24 long."""
    out = re.sub(r"[^a-z0-9]+", "_", str(s or "").lower()).strip("_")[:24]
    return out or "item"


def unique_id(prefix: str, base, items: list[dict]) -> str:
    """A new id that no item in the list has yet. JavaScript ``uniqueId``."""
    taken = {x.get("id") for x in items}
    cand, n = prefix + _slug(base), 2
    while cand in taken:
        cand, n = prefix + _slug(base) + "_" + str(n), n + 1
    return cand


# ---- what the page shows next to each item ----

def _plural(n: int, word: str) -> str:
    return str(n) + " " + word + ("" if n == 1 else "s")


def rule_effect(r: dict, rules: dict) -> str:
    """What a rule does, in words. JavaScript ``ruleEffect``."""
    k = r.get("kind")
    if k == "guardrail":
        return 'Guardrail: sends the case back at triage, and no one can waive it. The submitter sees: "' + (r.get("message") or r.get("label") or "") + '"'
    if k == "condition":
        return "Condition to clear before " + ("pilot" if r.get("clearBy") == "pilot" else "production") + ": " + (r.get("message") or r.get("label") or "")
    if k == "require":
        ctl = next((c for c in rules["controls"] if c["id"] == r.get("control")), {"text": "(control removed)"})
        return ("Recommends: " if r.get("level") == "recommended" else "Requires: ") + ctl["text"]
    if k == "override":
        return "The tier is at least " + constants.TIER_LABEL.get(r.get("minTier"), "")
    return "+" + str(_num(r.get("points"))) + " points"


def _num(v):
    try:
        n = float(v)
    except (TypeError, ValueError):
        return 0
    return int(n) if n == int(n) else n


def delete_block(section: str, item: dict, draft: dict, saved: dict, cases: list[dict]) -> str:
    """Why an item may not be deleted ('' when it may). Used things can only be disabled. JavaScript ``deleteReason``."""
    if section == "questions":
        u = RE.question_usage(item["id"], draft, cases)
        if u["rules"]:
            return "Used by " + _plural(len(u["rules"]), "rule") + ". Remove those rules first."
        if u["answered"]:
            return "Answered on " + _plural(u["answered"], "case") + ". Disable it instead."
    if section == "rules":
        sv = next((x for x in saved["rules"] if x["id"] == item["id"]), None)
        n = RE.rule_usage(sv, saved, cases) if sv else 0
        if n:
            return "Applied to " + _plural(n, "case") + ". Disable it instead."
    if section == "controls":
        n = RE.control_usage(item["id"], cases)
        if n:
            return "Used on " + _plural(n, "case") + ". Disable it instead."
    if section == "readiness":
        n = RE.readiness_usage(item["id"], cases)
        if n:
            return "Answered on " + _plural(n, "case") + ". Disable it instead."
    return ""


def inspect(draft0: dict, saved: dict, cases: list[dict]) -> dict:
    """Facts about every item in the draft, for the tables on the Rules page. JavaScript ``vRules`` (rows)."""
    draft = norm_rules(draft0)
    questions = {}
    for q in draft["questions"]:
        u = RE.question_usage(q["id"], draft, cases)
        options = {}
        for o in q.get("options") or []:
            ou = RE.option_usage(q["id"], o["id"], draft, cases)
            options[o["id"]] = "Used by a rule" if ou["rules"] else ("Chosen on " + _plural(ou["answered"], "case")) if ou["answered"] else ""
        questions[q["id"]] = {"rules": [r["label"] for r in u["rules"]], "answered": u["answered"], "locked": bool(u["rules"] or u["answered"]),
                              "options": options, "deleteBlock": delete_block("questions", q, draft, saved, cases)}
    rules = {}
    for r in draft["rules"]:
        sv = next((x for x in saved["rules"] if x["id"] == r["id"]), None)
        rules[r["id"]] = {"when": RE.describe_rule(r, draft), "effect": rule_effect(r, draft),
                          "applied": RE.rule_usage(sv, saved, cases) if sv else 0,
                          "neverApplies": r.get("enabled") is not False and not (r.get("when") or []),
                          "deleteBlock": delete_block("rules", r, draft, saved, cases)}
    controls = {c["id"]: {"used": RE.control_usage(c["id"], cases),
                          "applies": " and ".join(RE.describe_term(t, draft) for t in c.get("applies") or []),
                          "deleteBlock": delete_block("controls", c, draft, saved, cases)} for c in draft["controls"]}
    readiness = {r["id"]: {"used": RE.readiness_usage(r["id"], cases), "deleteBlock": delete_block("readiness", r, draft, saved, cases)}
                 for r in draft["readiness"]}
    units = {u["id"]: {"people": sum(p.get("unit") == u["id"] for p in constants.PEOPLE), "cases": sum(c.get("unitId") == u["id"] for c in cases)}
             for u in draft["units"]}
    triggers = [[" and ".join(RE.describe_term(t, draft) for t in tr.get("when") or []) for tr in a.get("triggers") or []]
                for a in draft.get("consultAreas") or []]
    saved_n = norm_rules(saved)
    # Everything a condition can test, with the answers it can tick. JavaScript ``termValues``.
    sources = [{"src": "q:" + q["id"], "label": (q.get("short") or q["text"]) + (" (disabled)" if q.get("enabled") is False else ""),
                "group": "Questions", "values": options_of(q)} for q in draft["questions"]]
    sources += [{"src": "type", "label": "Type of AI use case", "group": "Facts about the case", "values": draft.get("ucTypes") or []},
                {"src": "scope", "label": "Reach", "group": "Facts about the case", "values": constants.SCOPE_OPTS},
                {"src": "autonomy", "label": "Autonomy", "group": "Facts about the case", "values": constants.AUTONOMY_OPTS}]
    return {"sources": sources, "questions": questions, "rules": rules, "controls": controls, "readiness": readiness, "units": units, "triggers": triggers,
            "changes": RE.diff_rules(saved_n, draft),
            "dirtyTabs": [tab for tab, keys in TAB_KEYS.items() if any(E.js_json(draft.get(k)) != E.js_json(saved_n.get(k)) for k in keys)]}


# ---- checking one edited item before it goes into the draft ----

def _check_term(t: dict, who: str) -> None:
    """A condition needs a source and at least one ticked answer. JavaScript ``checkTerm``."""
    if t.get("any"):
        if len(t["any"]) < 2:
            raise EngineError(who + ' is an "any of" group and needs at least two options.')
        for j, x in enumerate(t["any"]):
            _check_term(x, who + ", option " + str(j + 1))
        return
    if not t.get("src"):
        raise EngineError(who + " needs a source.")
    if not t.get("in"):
        raise EngineError(who + " needs at least one answer ticked.")


def _terms(terms, who: str) -> list[dict]:
    """Drop empty conditions, then check the rest."""
    out = [t for t in terms or [] if t.get("src") or t.get("any")]
    for i, t in enumerate(out):
        _check_term(t, who + " " + str(i + 1))
    return out


def _check_question(q0: dict, is_new: bool, draft: dict) -> dict:
    """JavaScript ``checkQuestion``."""
    q = clone(q0)
    sw = _terms(q.get("showWhen"), 'The "show only when" condition')
    if sw:
        q["showWhen"] = sw
    else:
        q.pop("showWhen", None)
    q["text"] = str(q.get("text") or "").strip()
    q["short"] = str(q.get("short") or "").strip() or re.sub(r"\?$", "", q["text"])
    if not q["text"]:
        raise EngineError("Write the question first.")
    if q.get("type") == "yesno":
        q.pop("options", None)
    else:
        q["options"] = [{"id": o["id"], "label": str(o.get("label") or "").strip()} for o in q.get("options") or [] if str(o.get("label") or "").strip()]
        if len(q["options"]) < 2:
            raise EngineError("A pick-one or pick-any question needs at least two answers.")
    if is_new:
        q["id"] = unique_id("q_", q["short"], draft["questions"])
    return q


def _put(items: list[dict], item: dict) -> None:
    i = next((n for n, x in enumerate(items) if x["id"] == item["id"]), -1)
    if i < 0:
        items.append(item)
    else:
        items[i] = item


def apply_item(draft0: dict, kind: str, item0: dict, is_new: bool, area: int | None = None, index: int | None = None) -> dict:
    """Check one edited item and return the draft with it in place. JavaScript ``applyEdit``.

    ``kind`` is question, rule, control, readiness or trigger. A trigger also needs the consult
    ``area`` index, and ``index`` of the trigger being edited (None for a new one).
    """
    draft = clone(draft0)
    item = clone(item0 or {})
    if kind == "question":
        _put(draft["questions"], _check_question(item, is_new, draft))
    elif kind == "control":
        item["text"] = str(item.get("text") or "").strip()
        item["credit"] = _num(item.get("credit"))
        item["attest"] = "required" if item.get("attest") == "required" else "optional"
        applies = _terms(item.get("applies"), 'The "applies when" condition')
        if applies:
            item["applies"] = applies
        else:
            item.pop("applies", None)
        if not item["text"]:
            raise EngineError("Describe the control first.")
        if is_new:
            item["id"] = unique_id("c_", item["text"], draft["controls"])
        _put(draft["controls"], item)
    elif kind == "readiness":
        item["text"] = str(item.get("text") or "").strip()
        if not item["text"]:
            raise EngineError("Describe the check first.")
        if is_new:
            item["id"] = unique_id("r_", item["text"], draft["readiness"])
        _put(draft["readiness"], item)
    elif kind == "trigger":
        item["label"] = str(item.get("label") or "").strip()
        if not item["label"]:
            raise EngineError("Say what this trigger means.")
        item["when"] = _terms(item.get("when"), "Condition")
        if not item["when"]:
            raise EngineError("Add at least one condition.")
        item["level"] = "required" if item.get("level") == "required" else "recommended"
        areas = draft.get("consultAreas") or []
        if area is None or not 0 <= area < len(areas):
            raise EngineError("Choose the consult area first.")
        trig = areas[area].setdefault("triggers", [])
        if index is None or index < 0:
            trig.append(item)
        else:
            trig[index] = item
    elif kind == "rule":
        item["label"] = str(item.get("label") or "").strip()
        if not item["label"]:
            raise EngineError("Give the rule a name.")
        item["when"] = _terms(item.get("when"), "Condition")
        if not item["when"]:
            raise EngineError("Add at least one condition.")
        k = item.get("kind")
        if k not in constants.RULE_KINDS:
            raise EngineError("Choose what the rule does.")
        if k in ("guardrail", "condition"):
            item["message"] = str(item.get("message") or "").strip() or item["label"]
        else:
            item.pop("message", None)
        if k == "require":
            if not item.get("control"):
                raise EngineError("Choose the control this rule requires or recommends.")
            item["level"] = "recommended" if item.get("level") == "recommended" else "required"
        else:
            item.pop("control", None)
            item.pop("level", None)
        if k != "condition":
            item.pop("clearBy", None)
        if k != "override":
            item.pop("minTier", None)
        if k != "points":
            item.pop("points", None)
        else:
            item["points"] = _num(item.get("points"))
        if not str(item.get("ref") or "").strip():
            item.pop("ref", None)
        if is_new:
            item["id"] = unique_id(_ID_PREFIX[k], item["label"], draft["rules"])
        _put(draft["rules"], item)
    else:
        raise EngineError("Unknown kind of item: " + str(kind) + ".")
    return draft


# ---- checks before saving, and the What-if tab ----

def check(draft: dict, saved: dict, cases: list[dict]) -> dict:
    """Errors (block saving) and warnings (need a second click), plus what changed. JavaScript ``validateRules``."""
    v = RE.validate_rules(draft, saved, cases)
    return {**v, "changes": RE.diff_rules(norm_rules(saved), norm_rules(draft))}


def try_answers(draft0: dict, inp: dict, rule: dict | None = None) -> dict:
    """The What-if result for imaginary answers under the draft, saving nothing. JavaScript ``whatIfHtml``.

    Also lists the questions that would be asked for these answers (a question can depend on another
    answer), each with its answer options, so the page can draw the inputs.
    """
    draft = norm_rules(draft0)
    inp = inp or {}
    form = {"ucType": inp.get("ucType") or "", "scope": inp.get("scope") or "team", "autonomy": inp.get("autonomy") or "advice",
            "answers": inp.get("answers") or {}}
    res = RE.what_if(draft, inp)
    out = {**res, "questions": [{"id": q["id"], "text": q["text"], "short": q.get("short"), "type": q["type"], "options": options_of(q)}
                                for q in draft["questions"] if q.get("enabled") is not False and q_applies(q, form, draft)]}
    if rule is not None:  # "Try this rule": does this one rule apply to the answers?
        full = {**form, "readiness": {}, "controls": inp.get("controls") or []}
        out["ruleApplies"] = bool((rule.get("when") or []) and rule_hit({**rule, "enabled": True}, full, draft))
        out["ruleQuestions"] = sorted({term_q(t) for t in flat_terms(rule.get("when")) if term_q(t)})
    return out
