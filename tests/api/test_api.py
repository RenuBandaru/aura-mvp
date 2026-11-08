"""The API end to end, through the same ``dispatch`` function both web hosts use.

Each test gets a fresh in-memory store built at a fixed time, so results never depend on the clock.
"""

import base64
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "api"))

from aura_api.routes import dispatch  # noqa: E402
from aura_api.store import Store  # noqa: E402

NOW = "1793804400000"


@pytest.fixture
def api(monkeypatch):
    monkeypatch.setenv("AURA_FIXED_NOW", NOW)
    store = Store(None)

    def call(method, path, pid="p_elena", body=None, **query):
        return dispatch(store, method, path, query, body, {"X-Aura-Person": pid} if pid else {})

    call.store = store
    return call


def test_bootstrap_lists_people_and_rules(api):
    status, out = api("GET", "/api/bootstrap", pid=None)
    assert status == 200 and len(out["people"]) == 24 and out["rules"]["questions"]


def test_unknown_person_is_refused(api):
    assert api("GET", "/api/cases", pid="p_nobody") == (400, {"error": "Choose who you are acting as."})


def test_unknown_case_and_endpoint_are_404(api):
    assert api("GET", "/api/cases/UC-9999")[0] == 404
    assert api("GET", "/api/nothing")[0] == 404


def test_queue_matches_the_people_who_can_act(api):
    _, q = api("GET", "/api/queue", pid="p_elena")
    assert "UC-1006" in [i["id"] for i in q["items"]]  # the lead vets UC-1006
    _, auditor = api("GET", "/api/queue", pid="p_auditor")
    assert auditor["items"] == []  # the auditor only reads


def test_suggestion_to_use_case_and_mail_to_adviser(api):
    status, made = api("POST", "/api/cases", pid="p_priya", body={"title": "Pump failure alerts", "idea": "Predict pump failures from vibration data."})
    assert status == 200 and made["case"]["adviserId"] == "p_grant"
    cid = made["case"]["id"]
    assert made["case"]["outbox"][-1]["to"] == ["p_grant"]
    status, dev = api("POST", f"/api/cases/{cid}/actions/develop", pid="p_grant", body={"input": {}})
    assert status == 200 and dev["case"]["stage"] == "use_case"


def test_engine_refusals_come_back_as_400_with_the_message(api):
    status, out = api("POST", "/api/cases/UC-1012/actions/submit", pid="p_sam", body={"input": {}})
    assert status == 400 and out["error"] == "This action is not available to Sam Okafor right now."


def test_reviewer_notes_are_hidden_from_the_submitter(api):
    _, sam = api("POST", "/api/cases/UC-1012/actions/rv_vote", pid="p_sam", body={"input": {"decision": "approve", "strength": "leaning", "text": "Secret view"}})
    assert any(e["action"].startswith("Panel note") for e in sam["case"]["audit"])
    sub = sam["case"]["submitterId"]
    _, seen = api("GET", "/api/cases/UC-1012", pid=sub)
    assert not any(e["action"].startswith("Panel note") for e in seen["case"]["audit"])
    assert any(e["action"] == "Reviewer note recorded" for e in seen["case"]["audit"])


def test_form_preview_shows_required_consults(api):
    _, out = api("POST", "/api/cases/UC-1008/preview", pid="p_dana", body={"form": {"ucType": "use", "answers": {"q_pii": True}, "scope": "team", "autonomy": "advice", "controls": []}})
    assert out["consultNeeds"]["ca_data"]["level"] == "required"


def test_evidence_upload_is_stored_with_the_case(api):
    _, c = api("GET", "/api/cases/UC-1012", pid="p_dana")
    owner = c["case"]["submitterId"]
    _, c = api("GET", "/api/cases/UC-1012", pid=owner)
    add = next((a for a in c["actions"] if a["id"] == "add_evidence"), None)
    assert add, [a["id"] for a in c["actions"]]
    control = c["case"]["form"]["controls"][0]
    data = "data:text/plain;base64," + base64.b64encode(b"evidence text").decode()
    status, out = api("POST", "/api/cases/UC-1012/actions/add_evidence", pid=owner,
                      body={"input": {"controlId": control, "note": "", "upload": {"name": "notes.txt", "type": "text/plain", "dataUrl": data}}})
    assert status == 200, out
    file_id = next(f["id"] for f in api.store.data["files"] if f["name"] == "notes.txt")
    assert api("GET", f"/api/files/{file_id}")[1]["data"] == data


def test_ai_tool_report_flow(api):
    _, t = api("POST", "/api/tools", pid="p_dana")
    assert t["status"] == "draft"
    _, others = api("GET", "/api/tools", pid="p_sam")
    assert t["id"] not in [x["id"] for x in others]  # a draft is private
    form = {"name": "Meeting notes bot", "purpose": "Summarize meetings", "ownerId": "p_dana"}
    status, rep = api("POST", f"/api/tools/{t['id']}/actions/report_tool", pid="p_dana", body={"input": {"form": form}})
    assert status == 200 and rep["status"] == "reported"


def test_sweep_and_reset_are_restricted(api):
    assert api("POST", "/api/admin/sweep", pid="p_dana")[0] == 400
    assert api("POST", "/api/admin/sweep", pid="p_elena")[0] == 200
    assert api("POST", "/api/admin/reset", pid="p_elena")[0] == 400
    assert api("POST", "/api/admin/reset", pid="p_admin")[0] == 200


def test_outbox_filters_by_person(api):
    _, mails = api("GET", "/api/outbox", who="p_grant")
    assert mails and all("p_grant" in m["to"] for m in mails)
