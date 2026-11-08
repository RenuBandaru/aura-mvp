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


def test_audit_log_is_newest_first_and_filters_by_case(api):
    status, out = api("GET", "/api/audit", who="UC-1012")
    assert status == 200 and out["total"] == len(out["entries"]) > 0
    assert {e["caseId"] for e in out["entries"]} == {"UC-1012"}
    times = [e["ts"] for e in out["entries"]]
    assert times == sorted(times, reverse=True)


def test_tamper_is_caught_by_verify(api):
    _, before = api("POST", "/api/audit/verify")
    assert all(r["ok"] for r in before["results"])
    assert api("POST", "/api/admin/tamper", pid="p_dana")[0] == 400   # only the admin may
    status, t = api("POST", "/api/admin/tamper", pid="p_admin")
    assert status == 200
    _, after = api("POST", "/api/audit/verify")
    bad = [r for r in after["results"] if not r["ok"]]
    assert len(bad) == 1 and bad[0]["id"] == t["caseId"] and bad[0]["brokenAt"] == t["entry"]


def test_audit_export_is_csv_oldest_first(api):
    status, out = api("GET", "/api/audit/export")
    lines = out["csv"].split("\n")
    assert status == 200 and out["filename"] == "audit-log.csv"
    assert lines[0].startswith("Time,Case,Title,Actor")
    assert lines[1] < lines[-1]  # ISO times sort as text, so the first row is the oldest


# ---- training ----

def test_completing_training_clears_what_is_due(api):
    _, before = api("GET", "/api/training", pid="p_hannah")
    due = [t for t in before["mine"] if t["state"] in ("due", "overdue")]
    assert before["dueCount"] == len(due) == 1 and before["canMark"]
    status, after = api("POST", "/api/training/" + due[0]["id"] + "/complete", pid="p_hannah")
    assert status == 200 and after["dueCount"] == 0
    done = next(t for t in after["mine"] if t["id"] == due[0]["id"])
    assert done["state"] == "current" and done["completedAt"] == int(NOW) and done["completedVersion"] == due[0]["version"]


def test_completing_keeps_other_courses_and_refuses_admin(api):
    _, before = api("GET", "/api/training", pid="p_dana")
    first = before["mine"][0]
    api("POST", "/api/training/" + before["mine"][1]["id"] + "/complete", pid="p_dana")
    _, after = api("GET", "/api/training", pid="p_dana")
    assert after["mine"][0]["completedAt"] == first["completedAt"]  # the other record is untouched
    assert api("POST", "/api/training/t_intro/complete", pid="p_admin")[0] == 400
    assert api("POST", "/api/training/t_nope/complete", pid="p_dana")[0] == 404


def test_only_managers_see_who_has_completed_what(api):
    assert api("GET", "/api/training", pid="p_dana")[1]["matrix"] is None
    _, lead = api("GET", "/api/training", pid="p_elena")
    assert len(lead["matrix"]["rows"]) == 22 and lead["canRemind"]
    assert all(set(r["states"]) == {t["id"] for t in lead["matrix"]["trainings"]} for r in lead["matrix"]["rows"])


def test_training_reminders_go_to_the_outbox(api):
    assert api("POST", "/api/training/remind", pid="p_dana")[0] == 400
    status, out = api("POST", "/api/training/remind", pid="p_elena")
    assert status == 200 and out["peopleReminded"] > 0
    _, mails = api("GET", "/api/outbox", pid="p_elena")
    reminders = [m for m in mails if m["subject"] == "Reminder: training due"]
    assert len(reminders) == out["peopleReminded"] and reminders[0]["ref"]["id"] == "TRAINING"
    assert reminders[0]["body"].startswith("Please complete: ")


# ---- dashboard ----

def test_dashboard_figures_from_the_sample_data(api):
    status, d = api("GET", "/api/dashboard")
    assert status == 200
    k = d["kpis"]
    assert k["open"] == 14 and k["overdue"]["count"] == 5 and k["overdue"]["pct"] == 36
    assert k["overdue"]["goal"] == {"text": "25%", "met": False} and k["value"]["text"] == "$829K"
    assert sum(s["total"] for s in d["pipeline"]) == 18
    assert [c["id"] for c in d["mostOverdue"]][:2] == ["UC-1007", "UC-1005"]
    assert {a["id"] for a in d["alerts"]} == {"UC-1001", "UC-1005"}
    assert d["exceptions"]["days"] == 180 and d["exceptions"]["rows"]


def test_dashboard_training_summary_is_for_managers_only(api):
    assert api("GET", "/api/dashboard", pid="p_dana")[1]["training"] is None
    rows = api("GET", "/api/dashboard", pid="p_elena")[1]["training"]
    assert rows and all(r["ok"] + r["notDone"] == r["applies"] for r in rows)


def test_dashboard_exceptions_period(api):
    _, everything = api("GET", "/api/dashboard", exDays="0")
    _, month = api("GET", "/api/dashboard", exDays="30")

    def total(d):
        return sum(r["total"] for r in d["exceptions"]["rows"])
    assert total(month) <= total(everything)
    assert api("GET", "/api/dashboard", exDays="7")[0] == 400


def test_cases_export_is_csv_by_id(api):
    status, out = api("GET", "/api/cases/export")
    lines = out["csv"].split("\n")
    assert status == 200 and out["filename"] == "use-cases.csv"
    assert lines[0].startswith("ID,Title,Proposed solution,Stage") and lines[1].startswith("UC-1001,")


# ---- rules editor ----

def _rules(api):
    return api("GET", "/api/rules", pid="p_admin")[1]


def test_only_the_admin_edits_rules(api):
    assert api("GET", "/api/rules", pid="p_elena")[0] == 400
    page = _rules(api)
    assert page["version"] == 1 and page["versions"][0]["n"] == 1 and page["labels"]["kindOrder"][0] == "guardrail"


def test_inspect_explains_what_each_item_is_used_by(api):
    draft = _rules(api)["rules"]
    status, info = api("POST", "/api/rules/inspect", pid="p_admin", body={"draft": draft})
    assert status == 200 and info["changes"] == [] and info["dirtyTabs"] == []
    assert info["questions"]["q_us"]["deleteBlock"].startswith("Used by")
    assert info["rules"]["g_enc"]["when"] == '"Unencrypted data" is Yes or Not known'


def test_adding_a_rule_then_saving_makes_a_new_version(api):
    draft = _rules(api)["rules"]
    item = {"kind": "points", "label": "Test rule", "enabled": True, "when": [{"src": "q:q_us", "in": ["yes"]}], "points": 2}
    status, out = api("POST", "/api/rules/item", pid="p_admin", body={"draft": draft, "kind": "rule", "item": item, "isNew": True})
    assert status == 200 and out["draft"]["rules"][-1]["id"] == "pt_test_rule"
    _, info = api("POST", "/api/rules/inspect", pid="p_admin", body={"draft": out["draft"]})
    assert info["changes"] == ["Rule added: Test rule."] and info["dirtyTabs"] == ["rules"]
    assert api("POST", "/api/rules/save", pid="p_admin", body={"draft": out["draft"], "reason": " "})[0] == 400
    status, saved = api("POST", "/api/rules/save", pid="p_admin", body={"draft": out["draft"], "reason": "Testing"})
    assert saved == {"saved": True, "version": 2}
    page = _rules(api)
    assert page["version"] == 2 and page["versions"][0]["summary"] == ["Rule added: Test rule."]
    assert api("GET", "/api/bootstrap", pid=None)[1]["rules"]["rules"][-1]["id"] == "pt_test_rule"


def test_an_edit_with_a_blank_condition_is_refused(api):
    draft = _rules(api)["rules"]
    item = {"kind": "points", "label": "x", "when": [{"src": "q:q_us", "in": []}]}
    assert api("POST", "/api/rules/item", pid="p_admin", body={"draft": draft, "kind": "rule", "item": item, "isNew": True}) == \
        (400, {"error": "Condition 1 needs at least one answer ticked."})


def test_save_refuses_errors_and_waits_for_warnings(api):
    draft = _rules(api)["rules"]
    used = dict(draft, questions=[q for q in draft["questions"] if q["id"] != "q_us"])  # deleting an answered question
    _, out = api("POST", "/api/rules/save", pid="p_admin", body={"draft": used, "reason": "x", "acceptWarnings": True})
    assert out["saved"] is False and out["errors"]
    assert _rules(api)["version"] == 1
    assert api("POST", "/api/rules/save", pid="p_admin", body={"draft": {"nope": 1}, "reason": "x"}) == \
        (400, {"error": "The rules are missing required sections."})


def test_what_if_scores_imaginary_answers(api):
    draft = _rules(api)["rules"]
    _, calm = api("POST", "/api/rules/whatif", pid="p_admin", body={"draft": draft, "input": {}})
    _, risky = api("POST", "/api/rules/whatif", pid="p_admin", body={"draft": draft, "input": {"answers": {"q_enc": "unknown"}}})
    assert calm["stops"] == [] and [s["id"] for s in risky["stops"]] == ["g_enc"]
    assert calm["questions"] and all({"id", "text", "options"} <= set(q) for q in calm["questions"])


def test_loading_an_old_version_and_rescoring(api):
    assert api("GET", "/api/rules/versions/1", pid="p_admin")[1]["rules"]["questions"]
    assert api("GET", "/api/rules/versions/9", pid="p_admin")[0] == 404
    assert api("POST", "/api/rules/rescore", pid="p_dana")[0] == 400
    status, out = api("POST", "/api/rules/rescore", pid="p_elena")
    assert status == 200 and out["rescored"] > 0
