"""The case page's redesign data: what holds the decision, the readiness checklist, proof states,
the independence check and the tier sensitivity. Uses the invented example scenario file."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "api"))

from aura_api import views  # noqa: E402
import aura_engine as E  # noqa: E402

NOW = 1793804400000
EXAMPLE = Path(__file__).resolve().parents[2] / "docs" / "examples" / "uat-scenarios.example.json"
DATA = E.build_scenario_seed(NOW, E.load_scenarios(EXAMPLE))
CTX = {"rules": DATA["rules"], "now": NOW, "rv": 2, "training": DATA["meta"]["training"]}


def case(case_id: str) -> dict:
    return next(c for c in DATA["cases"] if c["id"] == case_id)


def detail(case_id: str, pid: str = "p_elena") -> dict:
    return views.case_detail(case(case_id), E.by_id(pid), CTX)


def test_holding_groups_experts_reviewers_and_confirmers():
    h = detail("EX-03")["holding"]
    mina = next(a for a in h["answer"] if a["personId"] == "p_mina")
    assert mina == {"personId": "p_mina", "title": "AI safety", "kind": "sme", "holds": True, "status": "pending"}
    assert {d["personId"] for d in h["decide"]} == set(E.rev_pool(case("EX-03")))
    assert h["need"] == 3 and all(not d["firm"] for d in h["decide"])
    assert any("Mina Kowalski" in t for t in h["firmBlocked"])


def test_holding_is_empty_before_vetting():
    assert detail("EX-02")["holding"] is None


def test_readiness_lists_what_a_firm_approval_still_needs():
    r = {x["label"].split(":")[0]: x for x in detail("EX-03")["readiness"]}
    assert r["Required experts asked"]["ok"] is True
    held = r["Required and held experts answered"]
    assert held["ok"] is False and "Mina Kowalski" in held["detail"]
    assert r["Firm approvals"]["ok"] is False


def test_readiness_only_at_panel_review():
    assert detail("EX-01")["readiness"] is None


def test_proof_states_tell_a_note_from_an_uploaded_file():
    c = case("EX-03")
    with_note = {**c, "form": {**c["form"], "evidence": {"c_escalate": "Escalation procedure"}}, "evidenceItems": []}
    assert views.proof_of(with_note, "c_escalate") == "note"
    assert views.proof_of({**with_note, "evidenceItems": [{"controlId": "c_escalate"}]}, "c_escalate") == "file"
    assert views.proof_of({**c, "form": {**c["form"], "evidence": {}}, "evidenceItems": []}, "c_escalate") == "none"
    assert all(r["proof"] in ("file", "note", "none") for r in detail("EX-03")["support"]["rows"])


def test_independence_check_finds_no_conflict_in_the_example():
    ind = detail("EX-03")["independence"]
    assert ind["checked"] > 0 and ind["issues"] == []


def test_independence_check_flags_an_owner_asked_as_expert():
    c = case("EX-03")
    owner_consulted = {**c, "consults": [*c["consults"], {"kind": "sme", "personId": c["submitterId"], "status": "pending"}]}
    issues = views.independence_view(owner_consulted)["issues"]
    assert [i["personId"] for i in issues] == [c["submitterId"]]


def test_tier_sensitivity_shows_less_autonomy_and_narrower_reach():
    d = detail("EX-03")
    changes = [x["change"] for x in d["sensitivity"]]
    assert "If it gives advice only" in changes
    assert any(ch.startswith("If its reach were") for ch in changes)
    assert all(x["score"] < d["scoring"]["inherent"] for x in d["sensitivity"])
