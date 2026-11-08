"""Triage (is the submission complete and inside the guardrails?) and scoring (how risky is it?).

When a case is submitted:

1. :func:`run_triage` checks the form. Missing information, a guardrail that fires, or too few
   data readiness checks sends the case back to the submitter ("remediate").
2. If triage passes, :func:`run_scoring` adds up risk points from the rules, plus points for
   reach (scope) and autonomy. The total is the inherent score, which sets the base tier.
   Minimum tier rules can raise the tier. Claimed controls earn credit; the inherent score minus
   that credit is the residual score.
"""

from __future__ import annotations

from .constants import DAY, TIER_LABEL, max_tier, t_idx
from .controls import control_credit
from .forms import FORM_FIELDS, is_blank
from .jsx import UNDEF, clone, js_or, js_str, strip_end, truthy
from .matching import form_gaps, gate_question_ids, rule_hit, rules_of, unclaimed_required
from .rules import norm_rules, tier_from_score
from .audit import seal_audit

SCORED_STAGES = ["vetting", "panel", "exec", "pilot", "production"]


def _plural(n: int, word: str) -> str:
    return f"{n} {word}{'s' if n > 1 else ''}"


def run_triage(form: dict, r0) -> dict:
    """Check a submitted form. JavaScript ``runTriage``.

    Returns ``{flags, blockers, ready, reasons, result}``. ``result`` is ``"pass"`` when there are no
    reasons to send it back, otherwise ``"remediate"``. The reasons are the text the submitter sees.
    """
    rules = norm_rules(r0)
    missing = [f["label"] for f in FORM_FIELDS if is_blank(form.get(f["k"]))]
    g = form_gaps(form, rules)
    for n in unclaimed_required(form, rules):
        missing.append("claim the required control: " + n["text"])
    attesters = form.get("attesters") or {}
    need_att = []
    for cid in form.get("controls") or []:
        k = next((x for x in rules["controls"] if x["id"] == cid), None)
        if k and k.get("attest") == "required" and not truthy(attesters.get(cid)):
            need_att.append(k["text"])
    if need_att:
        missing.append("someone to confirm: " + ", ".join(need_att))
    if not (form.get("measures") or []):
        missing.append("at least one KPI with a target and a stop limit")
    if g["questions"]:
        missing.append(_plural(len(g["questions"]), "risk question") + " unanswered")
    if g["readiness"]:
        missing.append(_plural(len(g["readiness"]), "data readiness check") + " unanswered")

    blockers = [{"id": r["id"], "text": js_or(r.get("message"), r.get("label")), "blocker": True}
                for r in rules_of(rules, "guardrail") if rule_hit(r, form, rules)]
    flags = [{"id": r["id"], "text": r["label"], "weight": r["points"], "blocker": False} for r in rules_of(rules, "points") if rule_hit(r, form, rules)]
    flags += [{"id": b["id"], "text": b["text"], "weight": 0, "blocker": True} for b in blockers]

    checks = [r for r in rules["readiness"] if r.get("enabled") is not False]
    ready_count = sum(1 for r in checks if (form.get("readiness") or {}).get(r["id"]) is True)
    ready = {"count": ready_count, "of": len(checks), "need": rules["minReady"], "ok": ready_count >= rules["minReady"]}

    reasons = []
    if missing:
        reasons.append("Missing information: " + "; ".join(missing) + ".")
    for i, b in enumerate(blockers):
        tail = " Resubmit when these are addressed." if i == len(blockers) - 1 else ""
        reasons.append("Guardrail: " + strip_end(js_str(b["text"]), r"\.") + "." + tail)
    if not ready["ok"] and not g["readiness"]:
        reasons.append(f"Data readiness: {ready_count} of {ready['of']} checks met, {js_str(ready['need'])} needed. The use case may not be feasible yet.")
    elif not ready["ok"]:
        reasons.append(f"Data readiness: {ready_count} of {ready['of']} checks met so far, {js_str(ready['need'])} needed.")
    return {"flags": flags, "blockers": blockers, "ready": ready, "reasons": reasons, "result": "remediate" if reasons else "pass"}


_AUTONOMY_WORDS = {"assist": "assists a person", "automate": "acts on its own", "advice": "advice only"}


def run_scoring(form: dict, r0, atts=None) -> dict:
    """Score a form. JavaScript ``runScoring``.

    Returns the inherent score and tier, the minimum tier rules that applied, conditions to clear,
    the control credit and the residual score, a line-by-line explanation, and which questions and
    readiness checks were unanswered (scoring ignores those, so the tier may be understated).
    """
    rules = norm_rules(r0)
    explain = []
    s = 0
    for r in rules_of(rules, "points"):
        if rule_hit(r, form, rules):
            s += r["points"]
            explain.append({"label": r["label"], "points": r["points"]})
    sp = js_or(rules["scopePoints"].get(form.get("scope")), 0)
    if truthy(sp):
        s += sp
        explain.append({"label": "Scope: " + js_str(form.get("scope", UNDEF)), "points": sp})
    ap = js_or(rules["autonomyPoints"].get(form.get("autonomy")), 0)
    if truthy(ap):
        s += ap
        explain.append({"label": "Autonomy: " + js_str(_AUTONOMY_WORDS.get(form.get("autonomy"), UNDEF)), "points": ap})
    base = tier_from_score(s, rules)
    tier = base
    overrides = []
    for o in rules_of(rules, "override"):
        if rule_hit(o, form, rules):
            raised = t_idx(o["minTier"]) > t_idx(tier)
            if raised:
                tier = o["minTier"]
            overrides.append({"id": o["id"], "label": o["label"], "minTier": o["minTier"], "raised": raised})
    conditions = [{"id": r["id"], "label": r["label"], "text": js_or(r.get("message"), r.get("label")), "clearBy": js_or(r.get("clearBy"), "production")}
                  for r in rules_of(rules, "condition") if rule_hit(r, form, rules)]
    cc = control_credit(form, rules, atts)
    credit = cc["credit"]
    residual = max(0, s - credit)
    g = form_gaps(form, rules)
    return {
        "inherent": s, "baseTier": base, "tier": tier, "overrides": overrides, "conditions": conditions, "explain": explain,
        "controlCredit": credit, "withheld": cc["withheld"], "inapplicable": cc["inapplicable"], "residual": residual,
        "residualTier": tier_from_score(residual, rules),
        "missing": {"questions": [q["id"] for q in g["questions"]], "readiness": [r["id"] for r in g["readiness"]]},
    }


def estimate_days(tier: str, rules: dict):
    """A standard estimate of days to a decision: vetting plus panel, plus executives for Critical. JavaScript ``estimateDays``."""
    d = rules["deadlines"]
    return js_or(d["vetting"].get(tier), 0) + js_or(d["panel"].get(tier), 0) + (js_or(d["exec"].get(tier), 0) if tier == "critical" else 0)


def due_for(stage: str, tier, now, rules: dict):
    """When a stage is due for this tier, or None if the stage has no deadline. JavaScript ``dueFor``."""
    d = (rules["deadlines"].get(stage) or {}).get(tier) if truthy(rules["deadlines"].get(stage)) else None
    return now + d * DAY if truthy(d) else None


def rescore(c0: dict, ctx: dict):
    """Score a case again under new rules, without moving it. JavaScript ``rescore``.

    Only for cases in vetting, panel or executive review. The tier never drops below a tier the
    governance lead raised it to at vetting. Writes an audit entry explaining the change, and
    returns a new case (or None when the case is not in a stage that can be re-scored).
    """
    if not truthy(c0.get("scoring")) or c0.get("stage") not in ("vetting", "panel", "exec"):
        return None
    rules = norm_rules(ctx["rules"])
    c = clone(c0)
    sc = run_scoring(c["form"], rules, c.get("attestations"))
    old, old_inh, old_rv = c.get("tier"), c["scoring"].get("inherent"), c["scoring"].get("rv")
    rv = js_or(ctx.get("rv"), 1)
    eff = max_tier(sc["tier"], js_or((c.get("vetting") or {}).get("raisedTo") if truthy(c.get("vetting")) else None, "low"))
    c["scoring"] = {"at": ctx["now"], "rv": rv, **sc}
    c["tier"] = eff
    names = [js_or(next((q for q in rules["questions"] if q["id"] == qid), {"short": qid}).get("short"), qid) for qid in sc["missing"]["questions"]]
    names += [next((r for r in rules["readiness"] if r["id"] == rid), {"text": rid})["text"] for rid in sc["missing"]["readiness"]]
    gates = gate_question_ids(rules)
    gate_miss = sum(1 for qid in sc["missing"]["questions"] if qid in gates)
    note = (js_str(TIER_LABEL.get(old, UNDEF)) + " (" + js_str(old_inh if old_inh is not None else UNDEF) + ")"
            + (" under v" + js_str(old_rv) if truthy(old_rv) else "")
            + " to " + TIER_LABEL[eff] + " (" + js_str(sc["inherent"]) + ") under v" + js_str(rv) + ". Residual " + js_str(sc["residual"]) + ".")
    if names:
        note += " Not answered: " + "; ".join(names) + "."
        if gate_miss:
            note += " Includes " + _plural(gate_miss, "safety gate") + " that were never checked."
        note += " Scoring ignores unanswered items, so the tier may be understated."
    c["audit"].append({"ts": ctx["now"], "actor": "system", "action": "Re-scored with updated rules", "note": note,
                       "from": c["stage"], "to": c["stage"], "auto": True, "tag": ""})
    return seal_audit(c, rv, ctx["now"])


def case_gaps(c: dict, r0) -> dict:
    """Unanswered items and new guardrail hits on a case that was already scored. For display only. JavaScript ``caseGaps``."""
    rules = norm_rules(r0)
    if not truthy(c.get("scoring")) or c.get("stage") not in SCORED_STAGES:
        return {"questions": [], "readiness": [], "gates": [], "newStops": []}
    g = form_gaps(c["form"], rules)
    gates = gate_question_ids(rules)
    new_stops = [r for r in rules_of(rules, "guardrail") if rule_hit(r, c["form"], rules)]
    return {"questions": g["questions"], "readiness": g["readiness"], "gates": [q for q in g["questions"] if q["id"] in gates], "newStops": new_stops}
