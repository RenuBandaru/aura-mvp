"""Quorum rules for the panel and the executives (build 27 check file t9.js, 7 checks).

The executive step needs three firm, agreeing executives (``execQuorum``). On the panel the lead does
not have to vote to finalize, break a deadlock, or waive the quorum.
"""

import aura_engine as E

from .helpers import NOW, R, Helpers, get

h = Helpers(training=False)
acts, names, run, vote, fresh, has = h.acts, h.names, h.run, h.vote, h.fresh, h.has


def test_default_exec_quorum_is_3():
    assert R["execQuorum"] == 3


def test_three_executives_exist():
    assert len(E.with_role("exec")) >= 3


def test_exec_two_firm_do_not_finalize_three_do_and_a_leaning_third_blocks():
    c = vote(vote(get("UC-1007"), "p_margaret", "approve"), "p_victor", "approve")
    assert not E.rev_ready(c, R), "ready at 2"
    c = vote(c, "p_ines", "approve", "leaning")
    assert not E.rev_ready(c, R), "ready with a leaning third"
    c = vote(c, "p_ines", "approve")
    r = E.rev_ready(c, R)
    assert r and r["N"] == 3 and r["firm"] == 3, r


def test_exec_dissent_is_a_deadlock_any_executive_can_break():
    c = vote(vote(vote(get("UC-1007"), "p_margaret", "approve"), "p_victor", "approve"), "p_ines", "reject")
    assert E.rev_deadlock(c, R, NOW), "no deadlock"
    for p in ("p_margaret", "p_victor", "p_ines"):
        assert has(c, p, "exec_break"), p + " cannot break"


def test_panel_moderate_two_firm_members_finalize_without_the_lead_voting():
    c = fresh("UC-1012")
    c["tier"] = "moderate"
    c = vote(vote(c, "p_sam", "approve"), "p_naomi", "approve")
    r = E.rev_ready(c, R)
    assert r and r["ok"], "not ready"
    assert has(c, "p_elena", "panel_approve"), "lead cannot finalize: " + names(c, "p_elena")


def test_panel_lead_can_break_a_deadlock_without_having_voted():
    c = fresh("UC-1012")
    c["tier"] = "moderate"
    c = vote(vote(c, "p_sam", "approve"), "p_naomi", "remediate", "leaning")
    assert has(c, "p_elena", "panel_break"), "no break: " + names(c, "p_elena")
    r = run(c, "p_elena", "panel_break", {"outcome": "remediate", "note": "Please address the concern."})
    assert r["stage"] != "panel"


def test_panel_lead_can_waive_the_quorum_without_having_voted():
    pool = [p["id"] for p in E.with_role("panel")]
    c = vote(fresh("UC-1012"), pool[0], "approve")
    for p in pool[1:]:
        c = vote(c, p, "abstain", "leaning", "")
    assert E.rev_quorum_waivable(c, R), "not waivable"
    assert has(c, "p_elena", "panel_waivequorum"), "lead has no waive: " + names(c, "p_elena")
