"""Reading a submitter's answers and deciding which rules and controls apply.

This is the heart of the rules model. Everything else (triage, scoring, required controls,
consult suggestions) asks the same question: does this rule's ``when`` hold for this form?

Answers are stored on the form under ``form["answers"][question_id]``:

* a yes/no question holds ``True``, ``False`` or ``"unknown"``,
* a single-choice question holds an option id such as ``"conf"``,
* a multiple-choice question holds a list of option ids.

A missing answer means "not answered yet", which is different from an explicit No.
"""

from __future__ import annotations

from .constants import UNKNOWN_OPT, YN_OPTS
from .jsx import js_str, truthy
from .rules import norm_rules


def options_of(q: dict) -> list[dict]:
    """The answer options a question offers, including "Not known" when allowed. JavaScript ``optionsOf``."""
    base = YN_OPTS if q.get("type") == "yesno" else (q.get("options") or [])
    return list(base) + ([UNKNOWN_OPT] if truthy(q.get("allowUnknown")) else [])


def answer_tokens(form: dict, q: dict) -> list[str] | None:
    """The stored answer to a question as a list of option ids, or None if unanswered. JavaScript ``answerTokens``.

    A yes/no answer of True becomes ``["yes"]``, so rules can always compare option ids.
    """
    a = (form.get("answers") or {}).get(q["id"])
    if a is None or a == "" or (isinstance(a, list) and not a):
        return None
    if isinstance(a, list):
        return [js_str(x) for x in a]
    if isinstance(a, bool):
        return ["yes" if a else "no"]
    return [js_str(a)]


def answer_label(q: dict, form: dict) -> str | None:
    """The answer in words, for example "Yes" or "Not known". JavaScript ``answerLabel``."""
    t = answer_tokens(form, q)
    if not t:
        return None
    opts = options_of(q)
    return ", ".join(next((o["label"] for o in opts if o["id"] == x), x) for x in t)


def q_applies(q: dict, form: dict, rules: dict) -> bool:
    """Whether a question is shown for this form (its ``showWhen`` terms all hold). JavaScript ``qApplies``."""
    sw = q.get("showWhen") or []
    return not sw or all(term_hit(t, form, rules) for t in sw)


def flat_terms(terms) -> list[dict]:
    """All simple terms in a list, with ``any`` groups opened up. JavaScript ``flatTerms``."""
    out: list[dict] = []
    for t in terms or []:
        if t and truthy(t.get("any")):
            out.extend(flat_terms(t["any"]))
        else:
            out.append(t)
    return out


def term_q(t: dict) -> str | None:
    """The question id a term reads, or None if it reads type, scope or autonomy. JavaScript ``termQ``."""
    src = t.get("src") or ""
    return src[2:] if src.startswith("q:") else None


def term_hit(t: dict, form: dict, rules: dict) -> bool:
    """Whether one term holds for this form. JavaScript ``termHit``.

    A question term only holds when the question exists, is enabled, is shown for this form, and
    the stored answer is one of the accepted option ids.
    """
    if t and truthy(t.get("any")):
        return any(term_hit(x, form, rules) for x in t["any"])
    accepted = t.get("in") or []
    src = t.get("src")
    if src == "type":
        return form.get("ucType") in accepted
    if src == "scope":
        return form.get("scope") in accepted
    if src == "autonomy":
        return form.get("autonomy") in accepted
    if (src or "").startswith("q:"):
        q = next((x for x in rules["questions"] if x["id"] == src[2:]), None)
        if not q or q.get("enabled") is False or not q_applies(q, form, rules):
            return False
        tok = answer_tokens(form, q)
        return bool(tok) and any(x in accepted for x in tok)
    return False


def rule_hit(r: dict, form: dict, rules: dict) -> bool:
    """Whether a rule fires. A rule with no conditions never fires. JavaScript ``ruleHit``."""
    when = r.get("when") or []
    return r.get("enabled") is not False and len(when) > 0 and all(term_hit(t, form, rules) for t in when)


def rules_of(rules: dict, kind: str) -> list[dict]:
    """All rules of one kind, in order. JavaScript ``rulesOf``."""
    return [r for r in (rules.get("rules") or []) if r.get("kind") == kind]


def form_gaps(form: dict, r0) -> dict:
    """Enabled questions and readiness checks with no stored answer. JavaScript ``formGaps``.

    Worked out from the data each time, never from the history of rule changes.
    """
    rules = norm_rules(r0)
    readiness = form.get("readiness") or {}
    return {
        "questions": [q for q in rules["questions"] if q.get("enabled") is not False and q_applies(q, form, rules) and answer_tokens(form, q) is None],
        "readiness": [r for r in rules["readiness"] if r.get("enabled") is not False and r["id"] not in readiness],
    }


def has_gaps(g: dict) -> bool:
    """Whether :func:`form_gaps` found anything. JavaScript ``hasGaps``."""
    return len(g["questions"]) + len(g["readiness"]) > 0


def gate_question_ids(rules: dict) -> set[str]:
    """Questions that an enabled guardrail reads. A missing answer to one is a safety gate never checked."""
    ids: set[str] = set()
    for r in rules_of(rules, "guardrail"):
        if r.get("enabled") is False:
            continue
        for t in flat_terms(r.get("when")):
            if (t.get("src") or "").startswith("q:"):
                ids.add(t["src"][2:])
    return ids


# ---- Controls the case needs ----

def ctl_applies(k: dict, form: dict, rules: dict) -> bool:
    """Whether a control applies at all to this form (its ``applies`` terms all hold). JavaScript ``ctlApplies``."""
    ap = k.get("applies") or []
    return not ap or all(term_hit(t, form, rules) for t in ap)


def control_needs(form: dict, r0) -> dict:
    """Every control that applies, with whether it is required or recommended and why. JavaScript ``controlNeeds``.

    Returns ``{control_id: {id, text, level, reasons}}`` where ``level`` is ``"required"``,
    ``"recommended"`` or None (offered, but nothing asks for it). Rules of kind ``require`` set the
    level. Required beats recommended.
    """
    rules = norm_rules(r0)
    out: dict = {}
    for k in rules["controls"]:
        if k.get("enabled") is not False and ctl_applies(k, form, rules):
            out[k["id"]] = {"id": k["id"], "text": k["text"], "level": None, "reasons": []}
    for r in rules_of(rules, "require"):
        if not rule_hit(r, form, rules):
            continue
        o = out.get(r.get("control"))
        if not o:
            continue
        lvl = "required" if r.get("level") == "required" else "recommended"
        if lvl == "required":
            o["level"] = "required"
        elif not o["level"]:
            o["level"] = "recommended"
        o["reasons"].append({"level": lvl, "label": r["label"], "ref": r.get("ref") or ""})
    return out


def required_controls(form: dict, rules) -> list[dict]:
    """Controls this form must claim. JavaScript ``requiredControls``."""
    return [n for n in control_needs(form, rules).values() if n["level"] == "required"]


def unclaimed_required(form: dict, rules) -> list[dict]:
    """Required controls the form has not claimed yet. JavaScript ``unclaimedRequired``."""
    claimed = form.get("controls") or []
    return [n for n in required_controls(form, rules) if n["id"] not in claimed]
