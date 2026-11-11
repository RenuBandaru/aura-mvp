"""Scenario data (``aura_engine.scenario_seed``) and the experts added after build 27.

The example scenario file in ``docs/examples`` is invented data. These tests check that loading it leaves
the default sample untouched, that each case is built through real actions, and that the added expert
areas route questions the way the file says.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

import aura_engine as E
from aura_engine.constants import ADDED_EXPERTS, BUILD27_PEOPLE_COUNT, PEOPLE, by_id
from aura_engine.jsx import clone

from .helpers import NOW

EXAMPLE = Path(__file__).resolve().parents[2] / "docs" / "examples" / "uat-scenarios.example.json"
SPEC = E.load_scenarios(EXAMPLE)
DATA = E.build_scenario_seed(NOW, SPEC)


def case(case_id: str) -> dict:
    return next(c for c in DATA["cases"] if c["id"] == case_id)


def ctx() -> dict:
    return {"rules": DATA["rules"], "now": NOW, "rv": 2, "training": DATA["meta"]["training"]}


def action_ids(c: dict, pid: str) -> list[str]:
    return [a["id"] for a in E.actions_for(c, by_id(pid), ctx()) if not a.get("disabled")]


def test_added_experts_come_after_build_27_people_and_are_experts():
    assert len(PEOPLE) == BUILD27_PEOPLE_COUNT + len(ADDED_EXPERTS)
    assert PEOPLE[BUILD27_PEOPLE_COUNT:] == ADDED_EXPERTS
    assert {p["role"] for p in ADDED_EXPERTS} == {"sme"}
    assert all(p["id"] in E.build_seed(NOW)["meta"]["training"] for p in ADDED_EXPERTS)


def test_default_sample_cases_are_unchanged_by_scenarios():
    plain = E.build_seed(NOW)
    assert DATA["cases"][: len(plain["cases"])] == plain["cases"]
    assert E.default_rules()["consultAreas"] == plain["rules"]["consultAreas"]


def test_scenario_cases_are_added_with_their_ids_and_a_sound_audit_trail():
    ids = [c["id"] for c in SPEC["cases"]]
    assert DATA["meta"]["scenario"]["cases"] == ids
    assert all(E.verify_audit(case(i))["ok"] for i in ids)
    assert [v["n"] for v in DATA["versions"]] == [1, 2]


def test_scenario_rules_add_expert_areas_for_each_added_expert():
    by_person = {a["personId"]: a for a in DATA["rules"]["consultAreas"]}
    assert all(p["id"] in by_person for p in ADDED_EXPERTS)


def test_low_case_reaches_vetting_where_the_lead_can_approve():
    c = case("EX-01")
    assert (c["stage"], c["tier"]) == ("vetting", "low")
    assert "vet_approve" in action_ids(c, "p_elena")


def test_unclear_vendor_training_terms_return_the_case_at_triage_and_require_contracts():
    c = case("EX-02")
    assert c["stage"] == "use_case" and c["returned"]
    assert any("train models outside the company" in r for r in c["returned"]["reasons"])
    assert E.consult_needs(c["form"], DATA["rules"])["ca_contracts"]["level"] == "required"


def test_a_held_expert_blocks_the_panel_decision_until_they_respond():
    c = case("EX-03")
    mina = next(k for k in c["consults"] if k["personId"] == "p_mina")
    assert c["stage"] == "panel" and mina["status"] == "pending" and mina["required"] is True
    assert "respond" in action_ids(c, "p_mina")
    assert not [a for a in action_ids(c, "p_elena") if a.startswith("panel_")]


def test_an_added_expert_can_be_consulted_and_respond():
    c = case("EX-03")
    ada = next(k for k in c["consults"] if k["personId"] == "p_ada")
    assert ada["status"] == "pending" and ada["required"] is False
    after = E.perform(c, "respond", {"stance": "support", "text": "Hand-off to an agent is clear."}, by_id("p_ada"), ctx())
    assert next(k for k in after["consults"] if k["personId"] == "p_ada")["status"] != "pending"


def test_duplicate_or_clashing_ids_are_refused():
    spec = clone(SPEC)
    spec["cases"].append(clone(spec["cases"][0]))
    with pytest.raises(E.ScenarioError, match="unique id"):
        E.build_scenario_seed(NOW, spec)
    spec = {"cases": [{**clone(SPEC["cases"][0]), "id": "UC-1001"}]}
    with pytest.raises(E.ScenarioError, match="unique id"):
        E.build_scenario_seed(NOW, spec)


def test_a_step_that_is_not_allowed_names_the_case_and_step():
    spec = {"cases": [{**clone(SPEC["cases"][0]), "steps": [{"do": "vet_approve", "by": "p_elena", "input": {}}]}]}
    with pytest.raises(E.ScenarioError, match=r"EX-01 step 1 \(vet_approve\)"):
        E.build_scenario_seed(NOW, spec)


def test_unknown_keys_and_unknown_area_people_are_refused():
    with pytest.raises(E.ScenarioError, match="unknown keys"):
        E.build_scenario_seed(NOW, {"cases": [{**clone(SPEC["cases"][0]), "colour": "red"}]})
    with pytest.raises(E.ScenarioError, match="known personId"):
        E.build_scenario_seed(NOW, {"rules": {"consultAreas": [{"id": "x", "label": "X", "personId": "p_nobody"}]}, "cases": []})


def test_load_scenarios_reports_unreadable_files(tmp_path):
    bad = tmp_path / "bad.json"
    bad.write_text("{not json", encoding="utf-8")
    with pytest.raises(E.ScenarioError, match="Cannot read"):
        E.load_scenarios(bad)
    bad.write_text(json.dumps({"cases": "none"}), encoding="utf-8")
    with pytest.raises(E.ScenarioError, match="list of cases"):
        E.load_scenarios(bad)
