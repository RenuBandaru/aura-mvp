"""Vetting, panel and executive outcomes (build 27 check file t2.js, 25 checks).

Covers: the vetting choices for low tier cases (B-67), escalating to executives (B-62), waiving the
pilot (B-55), editing a review note (B-68), the auditor's read-only role (B-72), the approval notice
email (B-63), the time estimate in the scoring email (B-64), "not permitted" rejections (B-70),
guardrail wording (B-75) and which controls apply (B-65, B-37).
"""

import aura_engine as E
from aura_engine.jsx import clone, truthy

from .helpers import R, SEED, Helpers, get, throws

h = Helpers(training=False)
acts, names, run, vote, has = h.acts, h.names, h.run, h.vote, h.has


def panel_ready(case_id, dec="approve"):
    """A panel case where all three panel reviewers hold the same firm decision."""
    c = get(case_id)
    c["consults"], c["panelNotes"] = [], []
    c.pop("votes", None)
    for p in ("p_sam", "p_naomi", "p_elena"):
        c = vote(c, p, dec, "firm")
    return c


def exec_ready(c, dec):
    """The three executives all hold the same firm decision."""
    for p in ("p_margaret", "p_victor", "p_ines"):
        c = vote(c, p, dec, "firm")
    return c


def notices(outbox):
    return [m for m in outbox if m["subject"].startswith("Approval notice")]


# ---- B-67: what the lead can do with a low tier case at vetting ----

def test_b67_vetting_actions_for_low_case():
    c = get("UC-1006")
    c["tier"] = "low"
    n = names(c, "p_elena")
    assert "vet_to_panel" in n and "vet_raise" not in n, n


def test_b67_low_to_panel_needs_a_reason():
    c = get("UC-1006")
    c["tier"] = "low"
    throws(lambda: h.perform(c, "vet_to_panel", {}, "p_elena"))


def test_b67_low_to_panel_with_reason_keeps_tier():
    c = get("UC-1006")
    c["tier"] = "low"
    r = run(c, "p_elena", "vet_to_panel", {"note": "second look wanted", "raiseTo": ""})
    assert (r["stage"], r["tier"]) == ("panel", "low")


def test_b67_raise_tier_option():
    r = run(get("UC-1006"), "p_elena", "vet_to_panel", {"note": "raise it", "raiseTo": "critical"})
    assert (r["stage"], r["tier"]) == ("panel", "critical")


def test_b67_low_tier_quorum_matches_moderate():
    c = get("UC-1006")
    c["tier"] = "low"
    r = run(c, "p_elena", "vet_to_panel", {"note": "x", "raiseTo": ""})
    r["consults"] = []
    r = vote(r, "p_elena", "approve", "firm")
    assert not has(r, "p_elena", "panel_approve"), "one firm vote finalizes"
    r = vote(r, "p_sam", "approve", "firm")
    assert has(r, "p_sam", "panel_approve"), "two firm votes do not finalize: " + names(r, "p_sam")


# ---- B-62: escalating to the executives ----

def test_b62_escalate_high_case():
    c = panel_ready("UC-1012", "escalate")
    assert "panel_escalate" in names(c, "p_elena")
    r = run(c, "p_elena", "panel_escalate", {"note": "worth exec attention"})
    assert (r["stage"], r["tier"]) == ("exec", "high")


def test_b62_escalate_low_case():
    c = panel_ready("UC-1012", "escalate")
    c["tier"] = "low"
    r = run(c, "p_elena", "panel_escalate", {"note": ""})
    assert (r["stage"], r["tier"]) == ("exec", "low")


# ---- B-55: executives waiving the pilot ----

def test_b55_exec_waive_pilot():
    e = run(panel_ready("UC-1012", "escalate"), "p_elena", "panel_escalate", {"note": "go"})
    r = run(exec_ready(e, "waive"), "p_margaret", "exec_waive", {"waiver": "Low-risk rollout"})
    assert r["stage"] == "production" and truthy(r["pilot"].get("waived"))


def test_b55_exec_waive_on_critical_seed():
    r = run(exec_ready(get("UC-1007"), "waive"), "p_margaret", "exec_waive", {"waiver": "Reason"})
    assert r["stage"] == "production"


def test_b55_exec_waive_needs_three_executives():
    c = vote(get("UC-1007"), "p_margaret", "waive", "firm")
    c = vote(c, "p_victor", "waive", "firm")
    assert not has(c, "p_victor", "exec_waive"), "two firm executives finalize"
    c = vote(c, "p_ines", "waive", "firm")
    assert has(c, "p_ines", "exec_waive"), "three firm executives do not finalize"


# ---- B-68: a reviewer's note is edited, not duplicated ----

def test_b68_exec_note_then_edit():
    c = vote(get("UC-1007"), "p_margaret", "approve", "leaning", "first")
    assert c["stage"] == "exec"
    label = h.action(c, "p_margaret", "rv_vote")["label"]
    c = vote(c, "p_margaret", "remediate", "leaning", "second")
    mine = [n for n in c["panelNotes"] if n["by"] == "p_margaret"]
    assert label == "Change my decision" and len(mine) == 1 and mine[0]["text"] == "second"


def test_b68_panel_note_label():
    c = get("UC-1012")
    c["consults"], c["panelNotes"] = [], []
    c.pop("votes", None)
    before = h.action(c, "p_sam", "rv_vote")["label"]
    c = vote(c, "p_sam", "approve", "leaning", "a")
    after = h.action(c, "p_sam", "rv_vote")["label"]
    assert (before, after) == ("Record my decision", "Change my decision")


# ---- B-72: the auditor only reads ----

def test_b72_auditor_has_no_actions():
    for c in SEED["cases"]:
        assert not acts(c, "p_auditor"), c["id"]


# ---- B-63: one approval notice for every kind of approval ----

def test_b63_notice_on_panel_approve():
    c = panel_ready("UC-1012", "approve")
    before = len(c["outbox"])
    r = run(c, "p_elena", "panel_approve", {})
    new = r["outbox"][before:]
    assert len(new) == 1 and len(notices(new)) == 1


def test_b63_notice_on_vetting_approve():
    c = get("UC-1006")
    c["tier"] = "low"
    m = notices(run(c, "p_elena", "vet_approve", {})["outbox"])
    assert len(m) == 1 and "Next review" in m[0]["body"]


def test_b63_notice_on_panel_waive():
    c = panel_ready("UC-1012", "waive")
    before = len(c["outbox"])
    m = notices(run(c, "p_elena", "panel_waive", {})["outbox"][before:])
    assert len(m) == 1 and "Pilot: waived" in m[0]["body"] and "Next review" in m[0]["body"]


def test_b63_notice_on_exec_approve_and_waive():
    r = run(exec_ready(get("UC-1007"), "approve"), "p_margaret", "exec_approve", {})
    assert len(notices(r["outbox"])) == 1
    r2 = run(exec_ready(get("UC-1007"), "waive"), "p_margaret", "exec_waive", {"waiver": "rr"})
    assert len(notices(r2["outbox"])) == 1


# ---- B-64: the scoring email carries the review time estimate ----

def test_b64_estimate_in_scoring_notice():
    c = get("UC-1008")
    form = clone(c["form"])
    form["answers"] = {**c["form"]["answers"], "q_train": "no", "q_sens": "int", "q_svc": "co"}
    r = run(c, "p_dana", "submit", {"form": form})
    assert any("under review" in m["subject"] for m in r["outbox"]), "no estimate mail (" + r["stage"] + ")"


# ---- B-70: rejected as "not permitted", and undoing that ----

def test_b70_reject_not_permitted_and_reopen_rules():
    c = run(panel_ready("UC-1012", "reject"), "p_elena", "panel_reject", {"rationale": "We never allow this.", "notPermitted": ["np"]})
    assert c["stage"] == "closed" and truthy(c["closed"].get("notPermitted"))
    sub, adv = c["submitterId"], c["adviserId"]
    for pid in (sub, adv, "p_elena"):
        assert "reopen" not in names(c, pid), "reopen offered to " + pid
    assert "allow_again" in names(c, "p_elena"), "lead cannot undo"
    assert "allow_again" not in names(c, adv), "adviser can undo"
    c = run(c, "p_elena", "allow_again", {"note": "revisit"})
    assert not truthy(c["closed"].get("notPermitted"))
    for pid in (sub, adv, "p_elena"):
        assert "reopen" in names(c, pid), "reopen missing for " + pid


def test_b70_plain_reject_can_be_reopened_by_owner_adviser_lead():
    c = run(panel_ready("UC-1012", "reject"), "p_elena", "panel_reject", {"rationale": "Not now.", "notPermitted": []})
    assert not truthy(c["closed"].get("notPermitted"))
    for pid in ("p_elena", c["adviserId"], c["submitterId"]):
        assert "reopen" in names(c, pid), pid


def test_b70_exec_reject_not_permitted_flag():
    c = run(exec_ready(get("UC-1007"), "reject"), "p_margaret", "exec_reject", {"rationale": "No.", "notPermitted": ["np"]})
    assert truthy(c["closed"].get("notPermitted"))


def test_b70_pilot_reject_not_permitted_flag():
    c = run(get("UC-1004"), "p_elena", "pilot_reject", {"note": "Bad.", "notPermitted": ["np"]})
    assert truthy(c["closed"].get("notPermitted"))


# ---- B-75, B-65, B-37: guardrail wording and which controls apply ----

def test_b75_triage_return_text():
    reason = get("UC-1008")["returned"]["reason"]
    assert reason.startswith("Guardrail:") and reason.endswith("Resubmit when these are addressed.")
    assert "safety gate" not in reason.lower()


def _form(**o):
    return {"ucType": "use", "answers": {}, "scope": "team", "autonomy": "advice", "controls": [], **o}


def test_b65_model_type_needs_documentation_control():
    assert E.control_needs(_form(ucType="model"), R)["c_docs"]["level"] == "required"
    assert E.control_needs(_form(answers={"q_model": "yes"}), R)["c_docs"]["level"] == "required", "central yes"
    n3 = E.control_needs(_form(answers={"q_model": "no"}), R)
    assert "c_docs" in n3 and not truthy(n3["c_docs"].get("level")), "should be optional"


def test_b37_controls_offered_only_when_they_apply():
    ids = E.control_needs(_form(), R).keys()
    for i in ("c_escalate", "c_kill", "c_bounds", "c_validate", "c_rollback", "c_share"):
        assert i not in ids, "offered " + i
    n2 = E.control_needs(_form(scope="customer", autonomy="automate"), R)
    assert truthy(n2.get("c_escalate")) and truthy(n2.get("c_kill")), "missing when applicable"
