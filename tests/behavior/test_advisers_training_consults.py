"""Advisers, the training gate, suggested consults and the catalog matcher (build 27 check file t4.js, 19 checks)."""

import aura_engine as E
from aura_engine.constants import PEOPLE, by_id
from aura_engine.jsx import clone, truthy

from .helpers import NOW, R, SEED, TRAINING, Helpers, person, throws

h = Helpers(training=True)


def new_pump_case():
    """Priya's new suggestion. Her unit's adviser is Grant."""
    return E.assign_adviser(E.new_case("UC-9001", "Test idea for pumps", "Predict pump failures from vibration data.", "p_priya", NOW, 1), R)


# ---- Advisers ----

def test_every_unit_has_an_adviser():
    for u in R["units"]:
        assert by_id(u["adviserId"])["role"] != "unknown", u["id"]


def test_every_person_has_a_unit():
    for p in PEOPLE:
        assert any(u["id"] == p["unit"] for u in R["units"]), p["id"]


def test_sample_cases_have_advisers():
    for c in SEED["cases"]:
        assert c.get("adviserId"), c["id"]


def test_new_case_adviser_comes_from_the_unit():
    assert new_pump_case()["adviserId"] == "p_grant"


def test_suggestion_adviser_can_develop_other_adviser_cannot():
    nc = new_pump_case()
    assert h.has(nc, "p_grant", "develop")
    assert not h.has(nc, "p_jordan", "develop")
    assert h.has(nc, "p_priya", "ask_adviser")
    h.perform(clone(nc), "develop", {}, "p_grant")  # build 27 ran this between checks; it must not fail


def test_ask_adviser_then_help_done():
    c = h.perform(new_pump_case(), "ask_adviser", {"message": "Where do I start?"}, "p_priya")
    assert any("p_grant" in m["to"] and "Help requested" in m["subject"] for m in c["outbox"]), "no mail"
    assert h.has(c, "p_grant", "help_done")
    d = h.perform(c, "help_done", {}, "p_grant")
    assert not h.has(d, "p_grant", "help_done"), "still offered"


def test_lead_is_adviser_for_legal_unit():
    c = E.assign_adviser(E.new_case("UC-9002", "x", "y", "p_claire", NOW, 1), R)
    assert c["adviserId"] == "p_elena"


# ---- The training gate on submitting ----

def test_untrained_submitter_blocked():
    c = E.assign_adviser(E.new_case("UC-9003", "Idea", "Idea text here", "p_tomas", NOW, 1), R)
    d = h.perform(c, "develop", {}, "p_tomas")
    sa = h.action(d, "p_tomas", "submit")
    assert sa and truthy(sa.get("blockedMsg")), "no blockedMsg"
    msg = throws(lambda: h.perform(d, "submit", {"form": {}}, "p_tomas"), r"Training is required")
    assert "ai-training@example.com" in msg


def test_trained_submitter_not_blocked():
    assert E.training_blocks(TRAINING, person("p_priya"), R, NOW) == []


def test_gate_off_when_training_not_required():
    r2 = clone(R)
    for t in r2["trainings"]:
        t["requiredToSubmit"] = False
    assert E.training_blocks(TRAINING, person("p_tomas"), r2, NOW) == []


# ---- Which consults are suggested ----

def f(**o):
    return {**E.blank_form("x", "p_priya"), **o}


def test_data_steward_recommended_by_default():
    assert E.consult_needs(f(ucType="use", answers={}), R)["ca_data"]["level"] == "recommended"


def test_data_steward_required_with_personal_data():
    assert E.consult_needs(f(ucType="use", answers={"q_pii": True}), R)["ca_data"]["level"] == "required"


def test_ai_safety_not_for_decisions_alone():
    assert "ca_ai" not in E.consult_needs(f(ucType="use", answers={"q_decide": True, "q_hall": False}, autonomy="advice"), R)


def test_ai_safety_for_decisions_and_hallucination():
    n = E.consult_needs(f(ucType="use", answers={"q_decide": True, "q_hall": True}), R)
    assert n["ca_ai"]["level"] == "recommended"


def test_ai_safety_required_for_outside_content_and_tools():
    n = E.consult_needs(f(ucType="build", answers={"q_model": True, "q_outside": True, "q_tools": True}), R)
    assert n["ca_ai"]["level"] == "required"


def test_it_standards_only_while_listing_is_pending():
    listed = E.consult_needs(f(ucType="vendor", answers={"q_listed": "listed"}), R)
    pending = E.consult_needs(f(ucType="vendor", answers={"q_listed": "pending"}), R)
    assert "ca_it" not in listed and pending["ca_it"]["level"] == "recommended"


def test_cyber_required_when_it_acts_on_it_systems():
    n = E.consult_needs(f(ucType="build", autonomy="automate", answers={"q_target": "it"}), R)
    assert n["ca_cyber"]["level"] == "required"


def test_consult_dialog_suggests_and_forces_required_only():
    c = clone(next(x for x in SEED["cases"] if x["id"] == "UC-1012"))
    c.update(legacy=False, stage="panel", consults=[], panelNotes=[])
    c["form"]["answers"] = {**c["form"]["answers"], "q_pii": True}
    a = h.action(c, "p_elena", "consult")
    assert a, "no consult action"
    smes = next(x for x in a["fields"] if x.get("name") == "smes")
    assert "ca_data" in smes["value"], "steward not suggested"
    c2 = h.perform(c, "consult", {"smes": ["p_jack"], "reqSmes": [], "question": "Q"}, "p_elena")
    assert any(k["personId"] == "p_omar" and k["required"] for k in c2["consults"]), "steward not forced"
    assert not next(k for k in c2["consults"] if k["personId"] == "p_jack")["required"], "Jack should be recommended"


# ---- The catalog matcher ----

def test_matcher_ranks_and_skips_stop_words():
    tools = [{"id": "t1", "name": "Vibration monitor", "purpose": "Pump vibration sensors", "status": "approved"},
             {"id": "t2", "name": "Other", "purpose": "with that", "status": "approved"}]
    m = E.match_catalog("that with Predict pump failures from vibration sensors", tools, [], 10)
    assert [x["ref"]["id"] for x in m] == ["t1"]
