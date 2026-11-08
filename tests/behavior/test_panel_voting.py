"""How review decisions are recorded, combined and finalized (build 27 check file t6.js, 28 checks).

Words used below:
* firm / leaning: a reviewer either holds a decision ("firm") or is still leaning towards it.
* quorum: how many firm, agreeing reviewers a tier needs before anyone can finalize.
* deadlock: reviewers disagree (or someone is waiting on input) and someone must break the tie.
* blockers: things that stop a firm decision, such as a required expert who has not answered.
* terms: the pilot or production conditions in the review draft. Changing them drops other reviewers'
  firm votes, because they agreed to the old wording.
"""

import aura_engine as E
from aura_engine.jsx import truthy

from .helpers import DAY, NOW, R, Helpers, ctx, get, mail_text, mails_to, throws

h = Helpers(training=False)
acts, names, run, vote, fresh, has = h.acts, h.names, h.run, h.vote, h.fresh, h.has
SYSTEM_ACTOR = {"id": "system"}


def pending_expert(cid="k1"):
    return {"id": cid, "kind": "sme", "personId": "p_jack", "status": "pending", "required": True, "requestedAt": NOW}


def test_firm_approve_needs_the_terms_filled_leaning_does_not():
    c = fresh()
    throws(lambda: vote(c, "p_sam", "approve", "firm", None, {"limits": ""}), "Complete these")
    vote(c, "p_sam", "approve", "leaning", None, {"limits": ""})


def test_high_tier_needs_three_firm_approvals():
    c = vote(vote(fresh(), "p_sam", "approve"), "p_naomi", "approve")
    assert not E.rev_ready(c, R), "ready at 2"
    c = vote(c, "p_elena", "approve")
    r = E.rev_ready(c, R)
    assert r and r["ok"] and r["dec"] == "approve", r
    assert has(c, "p_sam", "panel_approve"), "no finalize for a panel member"


def test_a_dissent_even_leaning_blocks_finalizing():
    c = fresh()
    for p in ("p_sam", "p_naomi", "p_elena"):
        c = vote(c, p, "approve")
    c = vote(c, "p_naomi", "remediate", "leaning")
    assert not E.rev_ready(c, R)


def test_approve_vs_approve_and_waive_is_a_deadlock():
    c = vote(vote(vote(fresh(), "p_sam", "approve"), "p_naomi", "waive"), "p_elena", "approve")
    assert not E.rev_ready(c, R)
    dl = E.rev_deadlock(c, R, NOW)
    assert dl, "no deadlock"
    assert sorted(o["v"] for o in E.deadlock_options(c, dl)) == ["approve"]


def test_absent_reviewer_does_not_block_at_moderate():
    c = fresh("UC-1012")
    c["tier"] = "moderate"
    c = vote(vote(c, "p_sam", "approve"), "p_elena", "approve")
    r = E.rev_ready(c, R)
    assert r and r["ok"], "not ready with 2 of 3 at moderate"


def test_pending_required_consult_stops_firm_allows_leaning():
    c = fresh()
    c["consults"] = [pending_expert()]
    throws(lambda: vote(c, "p_sam", "approve", "firm"), "firm decision yet")
    for d in ("approve", "await", "abstain"):
        vote(c, "p_sam", d, "leaning")


def test_editing_terms_drops_other_reviewers_firm_votes_and_mails_only_them():
    c = vote(vote(vote(fresh(), "p_sam", "approve"), "p_naomi", "approve"), "p_elena", "approve", "leaning")
    n0 = len(c["outbox"])
    c = run(c, "p_elena", "review_draft", {"scope": "A much wider pilot across three sites."})
    v = E.rev_votes(c)
    assert not v["p_sam"]["firm"] and not v["p_naomi"]["firm"], "not dropped"
    assert not v["p_elena"]["firm"], "editor changed"
    assert mails_to(c, n0, "p_sam") and mails_to(c, n0, "p_naomi"), "no mail"
    assert not mails_to(c, n0, "p_elena"), "editor mailed"
    assert "Pilot scope" in mails_to(c, n0, "p_sam")[0]["body"], "fields not named"
    n1 = len(c["outbox"])
    c = run(c, "p_elena", "review_draft", {"scope": "Another change."})
    assert len(c["outbox"]) == n1, "mailed again while leaning"


def test_leaners_get_no_mail_when_terms_change_and_saver_keeps_firm_vote():
    c = vote(vote(fresh(), "p_sam", "approve", "leaning"), "p_naomi", "approve", "firm")
    n0 = len(c["outbox"])
    c = vote(c, "p_elena", "approve", "firm", None, {"scope": "Different scope for the pilot."})
    assert not mails_to(c, n0, "p_sam"), "leaner mailed"
    assert mails_to(c, n0, "p_naomi"), "firm not mailed"
    assert E.rev_votes(c)["p_elena"]["firm"], "saver lost vote"


def test_refirming_then_another_change_mails_again():
    c = vote(vote(fresh(), "p_sam", "approve"), "p_naomi", "approve")
    c = run(c, "p_elena", "review_draft", {"scope": "Change one."})
    c = vote(c, "p_sam", "approve")
    n0 = len(c["outbox"])
    c = run(c, "p_elena", "review_draft", {"scope": "Change two."})
    assert mails_to(c, n0, "p_sam"), "no second mail"


def test_what_changed_since_my_last_firm_decision():
    c = vote(fresh(), "p_sam", "approve")
    c = run(c, "p_elena", "review_draft", {"scope": "Narrower pilot."})
    a = h.action(c, "p_sam", "rv_vote")
    assert any(f.get("name") == "chg" and "Pilot scope" in f["label"] for f in a["fields"]), "no change note"


def test_break_deadlock_lead_only_and_remediate_splits_offer_only_remediation():
    c = vote(vote(vote(fresh(), "p_sam", "approve"), "p_naomi", "remediate", "leaning"), "p_elena", "approve")
    assert has(c, "p_elena", "panel_break"), "lead has no break"
    assert not has(c, "p_sam", "panel_break"), "panel member can break"
    o = E.deadlock_options(c, E.rev_deadlock(c, R, NOW))
    assert [x["v"] for x in o] == ["remediate"], o
    throws(lambda: run(c, "p_elena", "panel_break", {"outcome": "approve", "rationale": "x"}), "Choose how")
    r = run(c, "p_elena", "panel_break", {"outcome": "remediate", "rationale": "Please fix the consent wording and resubmit."})
    assert r["stage"] == "use_case"
    m = [x for x in r["outbox"] if "Returned" in x["subject"]][-1]
    assert "my note" not in m["body"], "reviewer notes leaked"
    assert "consent wording" in m["body"], "summary missing"
    assert r.get("rounds") and r["rounds"][-1]["how"] == "deadlock", "round not kept"


def test_break_deadlock_among_approval_variants_majority_wins():
    c = vote(vote(vote(fresh(), "p_sam", "approve"), "p_naomi", "approve"), "p_elena", "waive")
    assert [x["v"] for x in E.deadlock_options(c, E.rev_deadlock(c, R, NOW))] == ["approve"]
    r = run(c, "p_elena", "panel_break", {"outcome": "approve", "rationale": "Majority view: pilot first."})
    assert r["stage"] == "pilot"


def test_not_voted_is_not_a_deadlock_but_withholding_is():
    c = fresh()
    c["tier"] = "moderate"
    c = vote(vote(c, "p_sam", "approve"), "p_elena", "approve")
    assert not E.rev_deadlock(c, R, NOW), "deadlock without disagreement"
    c = vote(c, "p_naomi", "await", "leaning")
    dl = E.rev_deadlock(c, R, NOW)
    assert dl, "await should deadlock"
    assert E.deadlock_options(c, dl)[0]["v"] == "remediate", "approve over await"


def test_waive_quorum_only_for_abstentions_lead_only_and_recorded():
    c = vote(vote(fresh("UC-1012"), "p_sam", "abstain", "leaning", ""), "p_naomi", "abstain", "leaning", "")
    c = vote(c, "p_elena", "approve")
    assert E.rev_quorum_waivable(c, R), "not waivable"
    assert not has(c, "p_sam", "panel_waivequorum"), "non-lead has it"
    r = run(c, "p_elena", "panel_waivequorum", {})
    assert r["stage"] == "pilot"
    assert "1 of 3 reviewers" in r["audit"][-1]["note"], r["audit"][-1]["note"]


def test_waive_quorum_not_offered_while_someone_has_not_voted():
    c = vote(vote(fresh(), "p_sam", "abstain", "leaning", ""), "p_elena", "approve")
    assert not E.rev_quorum_waivable(c, R), "offered with Naomi unvoted"


def test_exec_deadlocks_pilot_vs_none_and_directional_and_any_exec_can_break():
    c = vote(vote(vote(get("UC-1007"), "p_margaret", "approve"), "p_victor", "waive"), "p_ines", "approve")
    dl = E.rev_deadlock(c, R, NOW)
    assert dl, "no exec deadlock"
    assert [x["v"] for x in E.deadlock_options(c, dl)] == ["approve"]
    assert run(c, "p_victor", "exec_break", {"outcome": "approve", "rationale": "Pilot first."})["stage"] == "pilot"
    c2 = vote(vote(vote(get("UC-1007"), "p_margaret", "approve"), "p_victor", "reject"), "p_ines", "approve")
    assert E.deadlock_options(c2, E.rev_deadlock(c2, R, NOW))[0]["v"] == "remediate", "directional"
    r2 = run(c2, "p_margaret", "exec_break", {"outcome": "remediate", "rationale": "Resubmit with a smaller scope."})
    assert r2["stage"] == "use_case"


def test_exec_has_no_escalate_abstain_or_await():
    a = h.action(get("UC-1007"), "p_margaret", "rv_vote")
    options = [o["v"] for o in next(f for f in a["fields"] if f.get("name") == "decision")["options"]]
    assert not set(options) & {"escalate", "abstain", "await"}, options


def test_abstain_shrinks_the_pool_until_the_lead_waives():
    c = vote(vote(fresh("UC-1012"), "p_sam", "abstain", "leaning", ""), "p_naomi", "abstain", "leaning", "")
    assert E.rev_blockers(c, R)["poolShort"], "pool not short"
    c = vote(c, "p_elena", "approve", "firm")
    assert not E.rev_ready(c, R)


def test_named_input_arrives_and_the_waiting_reviewer_is_mailed():
    c = fresh()
    c["consults"] = [{"id": "k9", "kind": "stakeholder", "personId": "p_hannah", "status": "pending", "requestedAt": NOW, "question": "q"}]
    c = vote(c, "p_sam", "await", "leaning", None, {"awaitIds": ["k9"]})
    n0 = len(c["outbox"])
    c = run(c, "p_hannah", "respond", {"stance": "support", "text": "Fine with us."})
    assert any("input you waited" in m["subject"] for m in mails_to(c, n0, "p_sam"))


def test_blockers_clear_and_all_reviewers_are_mailed_to_revisit():
    c = fresh()
    c["consults"] = [{**pending_expert("k8"), "question": "q"}]
    n0 = len(c["outbox"])
    c = run(c, "p_jack", "respond", {"stance": "support", "text": "Fine."})
    ms = [m for m in c["outbox"][n0:] if "Nothing is holding" in m["subject"]]
    assert len(ms) == 1 and "p_sam" in ms[0]["to"] and "p_elena" in ms[0]["to"], [m["to"] for m in ms]


def test_last_reviewer_declining_notifies_the_lead_once():
    c = vote(vote(fresh(), "p_elena", "approve"), "p_sam", "approve")
    c2 = vote(c, "p_naomi", "approve")
    assert c2.get("readyBy") and c2["readyBy"]["by"] == "p_naomi", c2.get("readyBy")
    n0 = len(c2["outbox"])
    c3 = run(c2, "p_naomi", "rv_decline", {})
    assert len(mails_to(c3, n0, "p_elena")) == 1


def test_reminders_none_while_blocked_one_before_deadline_then_daily():
    c = fresh()
    c["dueAt"] = NOW + 10 * DAY
    assert not E.rev_reminder_due(c, R, NOW), "early"
    d = NOW + 10 * DAY - 3600000
    assert len(E.rev_reminder_due(c, R, d)) == 3
    r = E.remind_case(c, ctx(now=d), SYSTEM_ACTOR)
    assert r, "no reminders"
    assert not E.rev_reminder_due(r, R, d + 1000), "second in same window"
    dd = NOW + 11 * DAY + 3600000
    assert len(E.rev_reminder_due(r, R, dd)) == 3, "not daily after deadline"
    r2 = E.remind_case(r, ctx(now=dd), SYSTEM_ACTOR)
    assert not E.rev_reminder_due(r2, R, dd + 1000), "twice a day"
    c["consults"] = [pending_expert("kk")]
    assert not E.rev_reminder_due(c, R, d), "reminded while blocked"


def test_firm_reviewers_are_not_reminded():
    c = fresh()
    c["dueAt"] = NOW + DAY
    c = vote(c, "p_sam", "approve")
    due = E.rev_reminder_due(c, R, NOW + DAY)
    assert "p_sam" not in due and len(due) == 2, due


def test_finalizer_writes_the_summary_and_reviewer_notes_never_leak():
    c = fresh()
    for p in ("p_sam", "p_naomi", "p_elena"):
        c = vote(c, p, "reject", "firm", "PRIVATE-OPINION-" + p)
    throws(lambda: run(c, "p_naomi", "panel_reject", {"rationale": ""}), "(?i)required")
    r = run(c, "p_naomi", "panel_reject", {"rationale": "Legal exposure is too high.", "notPermitted": ["np"]})
    assert r["stage"] == "closed" and truthy(r["closed"].get("notPermitted"))
    assert "PRIVATE-OPINION" not in " ".join(mail_text(m) for m in r["outbox"]), "leak"


def test_review_rounds_are_kept_and_return_clears_votes():
    c = fresh()
    for p in ("p_sam", "p_naomi", "p_elena"):
        c = vote(c, p, "remediate", "firm", "note " + p)
    r = run(c, "p_sam", "panel_remediate", {"rationale": "Fix the data section."})
    last = r["rounds"][-1]
    assert len(last["votes"]) == 3 and len(last["notes"]) == 3, last
    assert not (r.get("votes") or {}), "votes not cleared"


def test_conflicted_reviewer_cannot_vote_and_old_notes_read_as_leaning():
    c = fresh()
    c["adviserId"] = "p_sam"
    assert not has(c, "p_sam", "rv_vote"), "adviser can vote"
    d = fresh()
    d["panelNotes"] = [{"by": "p_naomi", "at": NOW, "lean": "approve", "text": "x"}]
    v = E.rev_votes(d)
    assert v.get("p_naomi") and not v["p_naomi"]["firm"], "legacy"


def test_firm_plus_leaning_approve_deadlocks_only_after_the_deadline():
    c = fresh()
    c["tier"], c["dueAt"] = "moderate", NOW + DAY
    c = vote(vote(c, "p_sam", "approve", "firm"), "p_elena", "approve", "leaning")
    c["dueAt"] = NOW + DAY
    assert not E.rev_deadlock(c, R, NOW), "early deadlock"
    c["dueAt"] = NOW - 1000
    dl = E.rev_deadlock(c, R, NOW)
    assert dl and dl.get("lean"), "no lean deadlock"
    assert run(c, "p_elena", "panel_break", {"outcome": "approve", "rationale": "Pilot first."})["stage"] == "pilot"
    c["consults"] = [pending_expert("kz")]
    assert not E.rev_deadlock(c, R, NOW), "deadlock while blocked"


def test_lean_only_outcomes_after_the_deadline_resolve_to_themselves():
    for d in ("remediate", "reject", "waive", "escalate"):
        c = fresh()
        c["tier"], c["dueAt"] = "moderate", NOW + DAY
        c = vote(vote(c, "p_sam", d, "firm"), "p_elena", d, "leaning")
        assert not E.rev_deadlock(c, R, NOW), d + " early"
        c["dueAt"] = NOW - 1000
        dl = E.rev_deadlock(c, R, NOW)
        assert dl, d + " none"
        assert [o["v"] for o in E.deadlock_options(c, dl)] == [d]
    c = fresh()
    c["tier"] = "moderate"
    c = vote(vote(c, "p_sam", "reject", "firm"), "p_elena", "reject", "leaning")
    c["dueAt"] = NOW - 1000
    r = run(c, "p_elena", "panel_break", {"outcome": "reject", "rationale": "Not acceptable.", "notPermitted": []})
    assert r["stage"] == "closed"
