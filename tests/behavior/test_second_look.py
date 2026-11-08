"""Returns, resubmission and asking experts for a second look (build 27 check file t7.js, 13 checks).

When a case is returned to the submitter and comes back, earlier expert and stakeholder answers are
kept. At vetting the lead sees what changed and may ask any of them for a "second look". A second look
is a new consult record linked to the old one (``prevId`` / ``supersededBy``), so nothing is lost.
Each person's baseline is their own snapshot of the form (``formSnap``) taken when they answered.
"""

import re

import aura_engine as E
from aura_engine.jsx import clone

from .helpers import NOW, R, Helpers, get, mail_text

h = Helpers(training=False)
perform = h.perform


def answered_consults():
    """An answered required expert (Jack) and an answered stakeholder (Hannah)."""
    return [
        {"id": "k1", "kind": "sme", "personId": "p_jack", "areaId": None, "question": "Q1", "requestedAt": NOW - 900000, "dueAt": NOW,
         "status": "responded", "required": True, "response": {"stance": "concerns", "text": "OLD-EXPERT-COMMENT", "at": NOW - 800000}},
        {"id": "k2", "kind": "stakeholder", "personId": "p_hannah", "question": "Q2", "requestedAt": NOW - 900000,
         "status": "responded", "required": False, "response": {"stance": "support", "text": "OLD-STAKE-COMMENT", "at": NOW - 800000}},
    ]


def mk_vet():
    """UC-1006 returned with both answers on file, then resubmitted with a changed problem and autonomy."""
    c = get("UC-1006")
    c["consults"] = answered_consults()
    c = perform(c, "vet_remediate", {"note": "Fix the data section."}, "p_elena")
    assert len(c["consults"]) == 2, "consults cleared"
    c["stage"] = "vetting"
    c["form"]["problem"] = "A changed problem statement."
    c["form"]["autonomy"] = "autonomous"
    return c


def required_need(c):
    n = next((x for x in E.consult_needs(c["form"], R).values() if x["level"] == "required"), None)
    assert n, "no required need on " + c["id"]
    return n


def returned_with(consults, case_id="UC-1017"):
    """A case returned from vetting with these consults, then back at vetting."""
    c = get(case_id)
    c["consults"] = consults(c) if callable(consults) else consults
    c["stage"] = "vetting"
    c = perform(c, "vet_remediate", {"note": "x"}, "p_elena")
    c["stage"] = "vetting"
    return c


def test_remediation_keeps_expert_and_stakeholder_responses():
    c = mk_vet()
    assert len(c["consults"]) == 2 and c["consults"][0].get("response"), "lost"
    assert c.get("formAtReturn"), "no snapshot"


def test_lead_sees_a_diff_and_second_look_choices_at_vetting():
    a = h.action(mk_vet(), "p_elena", "vet_to_panel")
    again = next((f for f in a["fields"] if f.get("name") == "again"), None)
    assert again and len(again["options"]) == 2
    diffnote = next(f for f in a["fields"] if f.get("name") == "diffnote")
    assert "Problem" in diffnote["label"] and "Autonomy" in diffnote["label"], diffnote["label"]


def test_second_look_makes_a_new_pending_record_and_keeps_the_old_one():
    c = mk_vet()
    n0 = len(c["outbox"])
    c = perform(c, "vet_to_panel", {"note": "", "again": ["k1", "k2"]}, "p_elena")
    assert c["stage"] == "panel" and len(c["consults"]) == 4
    k1 = next(k for k in c["consults"] if k["id"] == "k1")
    nk = next(k for k in c["consults"] if k.get("prevId") == "k1")
    assert k1.get("response") and k1.get("supersededBy") == nk["id"], "old not kept"
    assert nk["status"] == "pending"
    m = [x for x in c["outbox"][n0:] if "Second look" in x["subject"]]
    assert len(m) == 2
    assert "OLD-EXPERT-COMMENT" in mail_text(m[0]), "old comment missing"
    assert "Problem" in mail_text(m[0]), "diff missing"
    assert not next(k for k in c["consults"] if k.get("prevId") == "k2")["required"], "stakeholder required"


def test_not_reconsulted_the_old_response_stands_and_nothing_is_held():
    c = perform(mk_vet(), "vet_to_panel", {"note": ""}, "p_elena")
    assert len(c["consults"]) == 2
    assert not E.rev_blockers(c, R)["pend"]


def test_second_look_on_a_held_expert_blocks_until_they_respond():
    c = perform(mk_vet(), "vet_to_panel", {"note": "", "again": ["k1"]}, "p_elena")
    nk = next(k for k in c["consults"] if k.get("prevId") == "k1")
    if nk["required"]:
        assert E.rev_blockers(c, R)["pend"], "not held"
        c = perform(c, "respond", {"stance": "support", "text": "NEW-EXPERT-COMMENT"}, "p_jack")
        assert not E.rev_blockers(c, R)["pend"], "still held"
        assert len([k for k in c["consults"] if k["personId"] == "p_jack"]) == 2, "old lost"


def test_lead_can_ask_again_from_the_consult_dialog_at_the_panel():
    c = perform(mk_vet(), "vet_to_panel", {"note": ""}, "p_elena")
    again = next((f for f in h.action(c, "p_elena", "consult")["fields"] if f.get("name") == "again"), None)
    assert again and again["options"], "no again field"
    c = perform(c, "consult", {"smes": [], "stakeholders": [], "again": [again["options"][0]["v"]]}, "p_elena")
    assert any(k.get("prevId") for k in c["consults"]), "not asked"


def test_area_no_longer_triggered_second_look_is_optional():
    c = mk_vet()
    c["consults"][0]["areaId"] = "ca_does_not_exist"
    c = perform(c, "vet_to_panel", {"note": "", "again": ["k1"]}, "p_elena")
    assert not next(k for k in c["consults"] if k.get("prevId") == "k1")["required"]


def test_required_area_still_triggered_second_look_holds_until_response():
    holder = {}

    def consults(c):
        n = holder["n"] = required_need(c)
        return [{"id": "k1", "kind": "sme", "personId": n["personId"], "areaId": n["id"], "question": "Q", "requestedAt": NOW - 900000, "dueAt": NOW,
                 "status": "responded", "required": True, "response": {"stance": "concerns", "text": "OLD", "at": NOW - 800000}}]

    c = perform(returned_with(consults), "vet_to_panel", {"note": "", "again": ["k1"]}, "p_elena")
    n = holder["n"]
    assert next(k for k in c["consults"] if k.get("prevId") == "k1")["required"], "not required"
    assert E.rev_blockers(c, R)["pend"], "not held"
    c = perform(c, "respond", {"stance": "support", "text": "NEW"}, n["personId"])
    assert not E.rev_blockers(c, R)["pend"], "still held"
    assert len([k for k in c["consults"] if k["personId"] == n["personId"] and k.get("response")]) == 2, "old lost"


def two_rounds():
    """UC-1017 with a round one answer that has its own form snapshot, returned once and changed since."""
    holder = {}

    def consults(c):
        n = holder["n"] = required_need(c)
        snap = {**clone(c["form"]), "problem": "Round one problem text."}
        return [{"id": "k1", "kind": "sme", "personId": n["personId"], "areaId": n["id"], "question": "Q", "requestedAt": NOW - 900000, "dueAt": NOW,
                 "status": "responded", "required": True, "response": {"stance": "concerns", "text": "ROUND1-COMMENT", "at": NOW - 800000}, "formSnap": snap}]

    c = returned_with(consults)
    c["form"]["solution"] = "Changed after return one."
    return c, holder["n"]


def test_baseline_is_each_persons_own_snapshot_not_the_last_return():
    c, _ = two_rounds()
    c["formAtReturn"] = clone(c["form"])
    c["form"]["users"] = "Changed after return two."
    assert "Changed since:" in E.second_look_options(c, R)[0]["l"]
    d = "|".join(E.form_diff(c["consults"][0]["formSnap"], c["form"], R))
    assert "Problem" in d and "Users" in d, d
    assert "Problem" not in "|".join(E.form_diff(c["formAtReturn"], c["form"], R)), "last-return diff should not include round one"


def test_respond_stores_a_snapshot_of_the_form():
    c = get("UC-1017")
    k = next((k for k in c["consults"] if k["status"] == "pending"), None)
    if not k:
        return
    c = perform(c, "respond", {"stance": "support", "text": "Fine."}, k["personId"])
    assert next(x for x in c["consults"] if x["id"] == k["id"]).get("formSnap"), "no snapshot"


def test_email_shows_the_persons_whole_history_on_the_case():
    c, n = two_rounds()
    c = perform(c, "vet_to_panel", {"note": "", "again": ["k1"]}, "p_elena")
    c = perform(c, "respond", {"stance": "support", "text": "ROUND2-COMMENT"}, n["personId"])
    c["stage"] = "vetting"
    c["formAtReturn"] = clone(c["form"])
    c["form"]["users"] = "Round three change."
    n0 = len(c["outbox"])
    k2 = next(k for k in c["consults"] if k.get("prevId") == "k1")
    c = perform(c, "vet_to_panel", {"note": "", "again": [k2["id"]]}, "p_elena")
    t = mail_text(next(x for x in c["outbox"][n0:] if "Second look" in x["subject"]))
    assert "ROUND1-COMMENT" in t and "ROUND2-COMMENT" in t, "history missing"
    assert len([k for k in c["consults"] if k["personId"] == n["personId"]]) == 3, "chain"


def test_pending_request_at_return_is_listed_held_and_can_be_cancelled():
    holder = {}

    def consults(c):
        n = holder["n"] = required_need(c)
        return [{"id": "k1", "kind": "sme", "personId": n["personId"], "areaId": n["id"], "question": "Q", "requestedAt": NOW - 900000, "dueAt": NOW,
                 "status": "pending", "required": True},
                {"id": "k2", "kind": "stakeholder", "personId": "p_hannah", "question": "Q", "requestedAt": NOW - 900000, "status": "responded",
                 "required": False, "response": {"stance": "support", "text": "ok", "at": NOW - 800000}}]

    c = returned_with(consults)
    n = holder["n"]
    assert len(c["consults"]) == 2, "cleared"
    cp = next((f for f in h.action(c, "p_elena", "vet_to_panel")["fields"] if f.get("name") == "cancelPending"), None)
    assert cp and [o["v"] for o in cp["options"]] == ["k1"], "no pending list"
    keep = perform(clone(c), "vet_to_panel", {"note": ""}, "p_elena")
    assert E.rev_blockers(keep, R)["pend"], "required pending not held"
    n0 = len(c["outbox"])
    c = perform(c, "vet_to_panel", {"note": "", "cancelPending": ["k1"], "again": ["k2"]}, "p_elena")
    ids = [k["id"] for k in c["consults"]]
    assert "k1" not in ids, "not cancelled"
    assert len(set(ids)) == len(ids), "duplicate ids"
    assert E.rev_blockers(c, R)["missing"], "required area should be missing again"
    assert any("No longer needed" in m["subject"] and n["personId"] in m["to"] for m in c["outbox"][n0:]), "no notice"


def test_pending_expert_can_respond_while_the_case_is_with_the_submitter():
    c = get("UC-1017")
    k = next(k for k in c["consults"] if k["status"] == "pending")
    c["stage"] = "vetting"
    c = perform(c, "vet_remediate", {"note": "x"}, "p_elena")
    assert c["stage"] == "use_case"
    assert h.has(c, k["personId"], "respond"), "no respond with submitter"
    c["form"]["users"] = "Changed users."
    c = perform(c, "respond", {"stance": "support", "text": "Fine by me."}, k["personId"])
    r = next(x for x in c["consults"] if x["id"] == k["id"])
    assert r["status"] == "responded" and r.get("formSnap"), "not attached"
    c["stage"] = "vetting"
    assert h.has(c, "p_elena", "vet_to_panel"), "no vetting"
    d = clone(c)
    d["form"]["problem"] = "Another change"
    o = next(x for x in E.second_look_options(d, R) if x["v"] == k["id"])
    assert re.search(r"Changed since: .*Problem", o["l"]), o["l"]
