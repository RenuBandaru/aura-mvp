"""Helpers for the rules editor: checking a draft, describing what changed, trying answers out, usage counts."""

from __future__ import annotations

from .constants import AUTONOMY_OPTS, SCOPE_OPTS, TIER_LABEL, TIERS
from .jsx import UNDEF, js_json, js_or, js_round, js_str, nullish, to_locale, to_num, truthy
from .matching import control_needs, flat_terms, form_gaps, options_of, rule_hit, rules_of, term_q
from .rules import GOAL_DEFS, norm_rules
from .triage import run_scoring

_SECTIONS = ["questions", "rules", "controls", "readiness"]
_NAMES = {"questions": "Question", "rules": "Rule", "controls": "Control", "readiness": "Readiness check"}
_NUMERIC = ["scopePoints", "autonomyPoints", "tiers", "budget", "deadlines", "pilotDays", "reviewCadenceDays", "reviewMaxDays", "goals", "quorum"]


def _name_of(section: str, x: dict) -> str:
    if section == "questions":
        return js_str(js_or(x.get("short"), x.get("text", UNDEF)))
    if section == "rules":
        return js_str(x.get("label", UNDEF))
    return js_str(x.get("text", UNDEF))


def _flat(o: dict, prefix: str, acc: dict) -> dict:
    """Flatten nested settings into "deadlines.panel.high": 10 style keys."""
    for key, v in o.items():
        if truthy(v) and isinstance(v, (dict, list)):
            _flat(v if isinstance(v, dict) else {str(i): x for i, x in enumerate(v)}, prefix + key + ".", acc)
        else:
            acc[prefix + key] = v
    return acc


def _strict_ne(a, b) -> bool:
    """JavaScript ``a !== b`` for plain values: a different type (other than int and float) counts as different."""
    if (a is UNDEF) != (b is UNDEF) or isinstance(a, bool) != isinstance(b, bool) or isinstance(a, str) != isinstance(b, str):
        return True
    return a != b


def diff_rules(a0, b0) -> list[str]:
    """Plain sentences describing what changed between two sets of rules (shown with each saved version). JavaScript ``diffRules``."""
    A, B = norm_rules(a0), norm_rules(b0)
    out = []
    for k in _SECTIONS:
        ia = {x["id"]: x for x in A[k]}
        ib = {x["id"]: x for x in B[k]}
        for x in B[k]:
            if x["id"] not in ia:
                out.append(_NAMES[k] + " added: " + _name_of(k, x) + ".")
        for x in A[k]:
            if x["id"] not in ib:
                out.append(_NAMES[k] + " deleted: " + _name_of(k, x) + ".")
        for x in B[k]:
            o = ia.get(x["id"])
            if not o or js_json(o) == js_json(x):
                continue
            if (o.get("enabled") is not False) != (x.get("enabled") is not False):
                out.append(_NAMES[k] + (" enabled: " if x.get("enabled") is not False else " disabled: ") + _name_of(k, x) + ".")
            rest = lambda y: js_json({kk: vv for kk, vv in y.items() if kk != "enabled"})  # noqa: E731
            if rest(o) != rest(x):
                out.append(_NAMES[k] + " changed: " + _name_of(k, x) + ".")
        oa = ",".join(js_str(x["id"]) for x in A[k] if x["id"] in ib)
        ob = ",".join(js_str(x["id"]) for x in B[k] if x["id"] in ia)
        if oa != ob:
            out.append(_NAMES[k] + "s reordered.")
    for k in _NUMERIC:
        fa = _flat(A.get(k) or {}, k + ".", {})
        fb = _flat(B.get(k) or {}, k + ".", {})
        for p, v in fb.items():
            if _strict_ne(fa.get(p, UNDEF), v):
                was = "none" if nullish(fa.get(p)) else js_str(fa[p])
                out.append(p.replace(".", " ") + ": " + was + " to " + js_str(v) + ".")
    for k in ("minReady", "execQuorum"):
        if _strict_ne(A.get(k, UNDEF), B.get(k, UNDEF)):
            out.append(k + ": " + js_str(A.get(k, UNDEF)) + " to " + js_str(B.get(k, UNDEF)) + ".")
    return out


# ---- Usage counts ----

def assessed(cases) -> list[dict]:
    """Cases that went through triage or scoring. JavaScript ``assessed``."""
    return [c for c in cases if truthy(c.get("triage")) or truthy(c.get("scoring"))]


def _answers(c: dict) -> dict:
    return ((c.get("form") or {}).get("answers") or {}) if truthy(c.get("form")) else {}


def question_usage(qid, rules: dict, cases) -> dict:
    """The rules that read a question, and how many cases answered it. JavaScript ``questionUsage``."""
    used_by = [r for r in (rules.get("rules") or []) if any(term_q(t) == qid for t in flat_terms(r.get("when")))]
    return {"rules": used_by, "answered": sum(1 for c in cases if qid in _answers(c))}


def option_usage(qid, oid, rules: dict, cases) -> dict:
    """The rules that accept one answer option, and how many cases chose it. JavaScript ``optionUsage``."""
    used_by = [r for r in (rules.get("rules") or []) if any(term_q(t) == qid and oid in (t.get("in") or []) for t in flat_terms(r.get("when")))]

    def chose(c):
        a = _answers(c).get(qid)
        return (a == oid and type(a) is type(oid)) or (isinstance(a, list) and oid in a) or (isinstance(a, bool) and ("yes" if a else "no") == oid)
    return {"rules": used_by, "answered": sum(1 for c in cases if chose(c))}


def rule_usage(rule: dict, rules: dict, cases) -> int:
    """How many scored cases the rule applies to (as if it were enabled). JavaScript ``ruleUsage``."""
    r = {**rule, "enabled": True}
    return sum(1 for c in assessed(cases) if truthy(c.get("scoring")) and rule_hit(r, c["form"], rules))


def control_usage(control_id, cases) -> int:
    """JavaScript ``controlUsage``."""
    return sum(1 for c in cases if control_id in (((c.get("form") or {}).get("controls")) or []))


def readiness_usage(check_id, cases) -> int:
    """JavaScript ``readinessUsage``."""
    return sum(1 for c in cases if truthy(c.get("form")) and truthy(c["form"].get("readiness")) and check_id in c["form"]["readiness"])


# ---- Describing rules in words ----

def describe_term(t: dict, rules: dict) -> str:
    """One condition in words, for example '"Data leaves the U.S." is Yes or Not known'. JavaScript ``describeTerm``."""
    if truthy(t.get("any")):
        return "(" + " or ".join(describe_term(x, rules) for x in t["any"]) + ")"
    vals = t.get("in") or []

    def labels(opts, suffix=""):
        return " or ".join(next((o["label"] for o in opts if o["id"] == v), js_str(v) + suffix) for v in vals) or "(nothing chosen)"

    if t.get("src") == "type":
        return "Type of AI use case is " + labels(rules.get("ucTypes") or [])
    if t.get("src") == "scope":
        return "Reach is " + labels(SCOPE_OPTS)
    if t.get("src") == "autonomy":
        return "Autonomy is " + labels(AUTONOMY_OPTS)
    q = next((x for x in rules["questions"] if x["id"] == term_q(t)), None)
    if not q:
        return "(question removed)"
    return '"' + js_str(js_or(q.get("short"), q.get("text"))) + '" is ' + labels(options_of(q), " (removed option)")


def describe_rule(r: dict, rules: dict) -> str:
    """All of a rule's conditions in words. JavaScript ``describeRule``."""
    when = r.get("when") or []
    return " and ".join(describe_term(t, rules) for t in when) if when else "No conditions set, so this rule never applies"


# ---- Checking a draft before saving ----

def validate_rules(d0, saved0, cases) -> dict:
    """Check a draft of the rules against the saved rules and the cases. JavaScript ``validateRules``.

    Errors block saving. Warnings need acknowledging. Anything that existing cases used (an
    answered question, an applied rule, a claimed control) cannot be deleted, only disabled.
    """
    D, S0 = norm_rules(d0), norm_rules(saved0)
    errors, warnings = [], []

    def label_of_q(q):
        return js_str(js_or(q.get("short"), q.get("text", UNDEF)))

    def dup(arr, what):
        seen = set()
        for x in arr:
            if x["id"] in seen:
                errors.append("Two " + what + ' share the id "' + js_str(x["id"]) + '".')
            seen.add(x["id"])

    dup(D["questions"], "questions")
    dup(D["rules"], "rules")
    dup(D["controls"], "controls")
    dup(D["readiness"], "readiness checks")
    t = D["tiers"]
    if not (t["lowMax"] <= t["moderateMax"] and t["moderateMax"] <= t["highMax"]):
        errors.append("Tier thresholds must rise: low, then moderate, then high.")
    if not (to_num(D["budget"].get("perUserMonthly", UNDEF)) >= 0):
        errors.append("The budget scrutiny limit must be zero or more.")
    for tr in TIERS:
        mx = to_num(D["reviewMaxDays"].get(tr, UNDEF))
        df = to_num(D["reviewCadenceDays"].get(tr, UNDEF))
        if not (mx >= 1) or mx != js_round(mx):
            errors.append("Max production review cycle for " + TIER_LABEL[tr] + " must be a whole number of days, 1 or more.")
        elif df > mx:
            errors.append("Default production review cycle for " + TIER_LABEL[tr] + " (" + js_str(df) + " days) is longer than the max production review cycle (" + js_str(mx) + " days).")
    for gd in GOAL_DEFS:
        g = (D.get("goals") or {}).get(gd["id"]) or {}
        val = to_num(g.get("value", UNDEF))
        if truthy(g.get("on")) and not (val >= gd["min"] and val <= gd["max"]):
            errors.append('Goal "' + gd["label"] + '" is on, so it needs a value from ' + to_locale(gd["min"]) + " to " + to_locale(gd["max"]) + ".")
    for q in D["questions"]:
        if not js_str(js_or(q.get("text"), "")).strip():
            errors.append("A question has no wording.")
        if q.get("type") != "yesno" and len(q.get("options") or []) < 2:
            errors.append('"' + label_of_q(q) + '" needs at least two options.')
    for r in D["rules"]:
        rl = js_str(r.get("label", UNDEF))
        if not js_str(js_or(r.get("label"), "")).strip():
            errors.append("A rule has no name.")
        for tm in flat_terms(r.get("when")):
            qid = term_q(tm)
            if qid:
                q = next((x for x in D["questions"] if x["id"] == qid), None)
                if not q:
                    errors.append('Rule "' + rl + '" points at a question that does not exist.')
                    continue
                ids = [o["id"] for o in options_of(q)]
                for v in tm.get("in") or []:
                    if v not in ids:
                        errors.append('Rule "' + rl + '" uses an answer that "' + label_of_q(q) + '" no longer offers.')
                if q.get("enabled") is False and r.get("enabled") is not False:
                    warnings.append('Rule "' + rl + '" depends on the disabled question "' + label_of_q(q) + '", so it cannot apply until that question is enabled again.')
            if not (tm.get("in") or []):
                warnings.append('Rule "' + rl + '" has a condition with no answers chosen, so it never applies.')
        if r.get("enabled") is not False and not (r.get("when") or []):
            warnings.append('Rule "' + rl + '" has no conditions, so it never applies.')
        if r.get("kind") == "require":
            if not any(k["id"] == r.get("control") for k in D["controls"]):
                errors.append('Rule "' + rl + '" points at a control that does not exist.')
            if r.get("level") not in ("required", "recommended"):
                errors.append('Rule "' + rl + '" must say whether the control is required or recommended.')

    def term_check(who, tm):
        qid = term_q(tm)
        if qid and not any(x["id"] == qid for x in D["questions"]):
            errors.append(who + " points at a question that does not exist.")

    for q in D["questions"]:
        for tm in flat_terms(q.get("showWhen")):
            term_check('The question "' + label_of_q(q) + '"', tm)
    for k in D["controls"]:
        for tm in flat_terms(k.get("applies")):
            term_check('The control "' + js_str(k.get("text", UNDEF)) + '"', tm)
    # Things that were used must not disappear.
    for q in S0["questions"]:
        n = sum(1 for c in cases if q["id"] in _answers(c))
        d = next((x for x in D["questions"] if x["id"] == q["id"]), None)
        if not d and n:
            errors.append('Question "' + label_of_q(q) + '" was answered on ' + str(n) + " case" + ("s" if n > 1 else "") + " and cannot be deleted. Disable it instead.")
        if d and n and d.get("type") != q.get("type"):
            errors.append('The answer type of "' + label_of_q(q) + '" cannot change because it has been answered.')
        if d and d.get("type") != "yesno":
            for o in q.get("options") or []:
                if not any(x["id"] == o["id"] for x in (d.get("options") or [])) and option_usage(q["id"], o["id"], S0, cases)["answered"]:
                    errors.append('Answer "' + js_str(o.get("label", UNDEF)) + '" of "' + label_of_q(q) + '" was chosen on existing cases and cannot be removed.')
    for r in S0["rules"]:
        if not any(x["id"] == r["id"] for x in D["rules"]) and rule_usage(r, S0, cases):
            errors.append('Rule "' + js_str(r.get("label", UNDEF)) + '" has applied to existing cases and cannot be deleted. Disable it instead.')
    for k in S0["controls"]:
        if not any(x["id"] == k["id"] for x in D["controls"]) and control_usage(k["id"], cases):
            errors.append('Control "' + js_str(k.get("text", UNDEF)) + '" is used on existing cases and cannot be deleted. Disable it instead.')
    for r in S0["readiness"]:
        if not any(x["id"] == r["id"] for x in D["readiness"]) and readiness_usage(r["id"], cases):
            errors.append('Readiness check "' + js_str(r.get("text", UNDEF)) + '" has answers on existing cases and cannot be deleted. Disable it instead.')
    for q in D["questions"]:
        if q.get("enabled") is False:
            continue
        reads = lambda terms: any(term_q(tm) == q["id"] for tm in flat_terms(terms))  # noqa: E731
        used = (any(r.get("enabled") is not False and reads(r.get("when")) for r in D["rules"])
                or any(o.get("enabled") is not False and reads(o.get("showWhen")) for o in D["questions"])
                or any(reads(tr.get("when")) for a in (D.get("consultAreas") or []) for tr in (a.get("triggers") or [])))
        if not used:
            warnings.append('Question "' + label_of_q(q) + '" is asked but no enabled rule uses its answer, so it has no effect on scoring.')
    return {"errors": errors, "warnings": warnings}


def what_if(r0, inp: dict) -> dict:
    """Try a set of answers against the rules without saving anything. JavaScript ``whatIf``.

    Every readiness check counts as met, so the result shows guardrails, score, tier and the
    controls the answers would need.
    """
    rules = norm_rules(r0)
    form = {"answers": js_or(inp.get("answers"), {}), "readiness": {}, "controls": js_or(inp.get("controls"), []),
            "scope": js_or(inp.get("scope"), "team"), "autonomy": js_or(inp.get("autonomy"), "advice"), "ucType": js_or(inp.get("ucType"), "")}
    for r in rules["readiness"]:
        form["readiness"][r["id"]] = True
    stops = [{"id": r["id"], "text": js_or(r.get("message"), r.get("label"))} for r in rules_of(rules, "guardrail") if rule_hit(r, form, rules)]
    return {"stops": stops, "scoring": run_scoring(form, rules), "gaps": form_gaps(form, rules)["questions"],
            "needs": [n for n in control_needs(form, rules).values() if n["level"]]}
