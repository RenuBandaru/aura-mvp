"""People, CSV imports and backups for the demo admin. Every name and email here is invented."""

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "api"))

from aura_api.routes import dispatch  # noqa: E402
from aura_api.store import Store  # noqa: E402
from aura_engine import constants  # noqa: E402

NOW = "1793804400000"
PEOPLE_CSV = ("Name,Email,Role,Business unit,Title or area\r\n"
              "Jane Example,jane.example@example.com,Subject matter expert,\"Finance, HR and IT\",Cybersecurity\r\n"
              "Sam Placeholder,sam.placeholder@example.com,panel reviewer,u_corp,Finance\r\n"
              "Lee Lead,lee.lead@example.com,Governance lead,Legal and compliance,Chair\r\n"
              "Ada Adviser,ada.adviser@example.com,Advisor,Plant operations and manufacturing,AI adoption\r\n")


@pytest.fixture
def api(monkeypatch):
    monkeypatch.setenv("AURA_FIXED_NOW", NOW)
    store = Store(None)

    def call(method, path, pid="p_admin", body=None, **query):
        return dispatch(store, method, path, query, body, {"X-Aura-Person": pid} if pid else {})

    call.store = store
    return call


def test_only_the_admin_manages_people(api):
    assert api("GET", "/api/people", pid="p_elena") == (400, {"error": "Only the demo admin can manage people and data."})
    status, out = api("GET", "/api/people")
    assert status == 200 and len(out["people"]) == 24 and out["ruleGaps"] == []
    dana = next(p for p in out["people"] if p["id"] == "p_dana")
    assert dana["cases"] > 0 and dana["deleteBlock"].startswith("Named on")


def test_add_edit_and_delete_a_person(api):
    status, out = api("POST", "/api/people", body={"person": {"name": "Jane Example", "email": "Jane.Example@example.com",
                                                              "role": "sme", "unit": "u_corp", "title": "Cybersecurity"}})
    assert status == 200
    jane = next(p for p in out["people"] if p["name"] == "Jane Example")
    assert jane["id"] == "p_jane_example" and jane["email"] == "jane.example@example.com" and jane["deleteBlock"] == ""
    # The new person appears in "Viewing as" and can act.
    assert any(p["id"] == "p_jane_example" for p in api("GET", "/api/bootstrap", pid=None)[1]["people"])
    assert api("GET", "/api/queue", pid="p_jane_example")[0] == 200
    status, out = api("POST", "/api/people", body={"person": {**jane, "role": "Panel reviewer"}})
    assert next(p for p in out["people"] if p["id"] == "p_jane_example")["role"] == "panel"
    assert api("POST", "/api/people/p_jane_example/delete")[0] == 200
    assert api("GET", "/api/queue", pid="p_jane_example") == (400, {"error": "Choose who you are acting as."})


def test_person_checks(api):
    def save(**p):
        return api("POST", "/api/people", body={"person": p})
    assert save(name="", role="sme") == (400, {"error": "Give the person a name."})
    assert save(name="X", role="boss") == (400, {"error": "Pick a role for X."})
    assert save(name="X", role="sme", unit="Mars") == (400, {"error": "\"Mars\" is not one of the business units."})
    assert save(name="X", role="sme", email="nope") == (400, {"error": "\"nope\" does not look like an email address."})
    assert save(id="p_admin", name="Demo admin", role="sme") == (400, {"error": "The demo admin keeps the admin role."})
    status, out = api("POST", "/api/people/p_dana/delete")
    assert status == 400 and out["error"].startswith("Dana Whitfield cannot be deleted. Named on ")


def test_import_people_merges_and_reports_bad_rows(api):
    bad = PEOPLE_CSV + "No Role,nr@example.com,Wizard,,\r\n,blank@example.com,sme,,\r\n"
    status, out = api("POST", "/api/admin/people/import", body={"csv": bad})
    assert status == 200 and out["applied"] is False
    assert out["errors"] == ["Row 6: Pick a role for No Role.", "Row 7: Give the person a name."]
    assert len(api("GET", "/api/people")[1]["people"]) == 24  # nothing changed
    status, out = api("POST", "/api/admin/people/import", body={"csv": PEOPLE_CSV})
    assert out == {"applied": True, "added": 4, "updated": 0, "removed": 0, "ruleGaps": [], "skippedColumns": []}
    # Importing again updates the same people (matched by email) instead of adding them twice.
    again = PEOPLE_CSV.replace("Cybersecurity", "Data protection")
    assert api("POST", "/api/admin/people/import", body={"csv": again})[1]["updated"] == 4
    jane = next(p for p in api("GET", "/api/people")[1]["people"] if p["email"] == "jane.example@example.com")
    assert jane["title"] == "Data protection" and jane["role"] == "sme" and jane["unit"] == "u_corp"


def test_start_fresh_then_replace_people_and_import_cases(api):
    # Replacing is refused while sample cases still name the sample people.
    out = api("POST", "/api/admin/people/import", body={"csv": PEOPLE_CSV, "mode": "replace"})[1]
    assert out["applied"] is False and "Remove sample use cases and tools" in out["errors"][0]
    assert api("POST", "/api/admin/clear")[1] == {"ok": True, "removed": 18}
    out = api("POST", "/api/admin/people/import", body={"csv": PEOPLE_CSV, "mode": "replace"})[1]
    assert out["applied"] and out["added"] == 4 and out["removed"] == 23
    # The rules still name sample advisers and experts, so the admin is told what to fix.
    assert any("Business unit" in g for g in out["ruleGaps"]) and any("Consult area" in g for g in out["ruleGaps"])
    names = [p["name"] for p in api("GET", "/api/bootstrap", pid=None)[1]["people"]]
    assert sorted(names) == ["Ada Adviser", "Demo admin", "Jane Example", "Lee Lead", "Sam Placeholder"]

    cases = ("ID,Title,Description,Submitter email\r\n"
             "UC-03,Example chat assistant,,\r\n"
             ",Example invoice capture,Read invoices into the ledger,sam.placeholder@example.com\r\n")
    out = api("POST", "/api/admin/cases/import", body={"csv": cases})[1]
    assert out["applied"] is False and out["errors"] == ["Row 2: no submitter. Pick who logs rows without one."]
    out = api("POST", "/api/admin/cases/import", body={"csv": cases, "defaultSubmitter": "p_ada_adviser"})[1]
    assert out == {"applied": True, "added": 2, "ids": ["UC-03", "UC-1001"], "skippedColumns": []}
    status, case = api("GET", "/api/cases/UC-03", pid="p_ada_adviser")
    assert status == 200 and case["case"]["stage"] == "suggestion" and case["case"]["idea"] == "Example chat assistant"
    # The same ID cannot be imported twice.
    out = api("POST", "/api/admin/cases/import", body={"csv": cases, "defaultSubmitter": "p_ada_adviser"})[1]
    assert out["errors"][0] == "Row 2: another use case already has the ID UC-03."


def test_backup_and_restore(api):
    api("POST", "/api/people", body={"person": {"name": "Jane Example", "role": "sme"}})
    status, out = api("GET", "/api/admin/backup")
    assert status == 200 and out["filename"].startswith("aura-backup-") and out["filename"].endswith(".json")
    saved = out["json"]
    api("POST", "/api/admin/reset")
    assert not any(p["name"] == "Jane Example" for p in constants.PEOPLE)
    assert api("POST", "/api/admin/restore", body={"data": saved})[1] == {"ok": True, "cases": 18, "people": 25}
    assert any(p["name"] == "Jane Example" for p in api("GET", "/api/bootstrap", pid=None)[1]["people"])
    assert api("POST", "/api/admin/restore", body={"data": "{oops"}) == (400, {"error": "That file is not an AURA backup (it is not readable JSON)."})
    no_admin = json.loads(saved)
    no_admin["people"] = [p for p in no_admin["people"] if p["id"] != "p_admin"]
    assert api("POST", "/api/admin/restore", body={"data": no_admin})[1]["error"].startswith("That backup has no demo admin")


def test_templates_hold_only_invented_rows(api):
    for path in ("/api/admin/people/template", "/api/admin/cases/template"):
        status, out = api("GET", path)
        assert status == 200 and out["filename"].endswith(".csv") and "example.com" in out["csv"]
    assert api("GET", "/api/admin/people/export")[1]["csv"].startswith("Name,Email,Role,Business unit,Title or area")


def test_people_survive_a_restart(tmp_path, monkeypatch):
    monkeypatch.setenv("AURA_FIXED_NOW", NOW)
    path = tmp_path / "aura.json"
    store = Store(path)
    dispatch(store, "POST", "/api/people", {}, {"person": {"name": "Jane Example", "role": "sme"}}, {"X-Aura-Person": "p_admin"})
    constants.use_people(constants.sample_people())  # as if the process restarted
    again = Store(path)
    assert any(p["name"] == "Jane Example" for p in again.people)
    assert any(p["name"] == "Jane Example" for p in dispatch(again, "GET", "/api/bootstrap", {}, None, {})[1]["people"])


def test_import_cases_fills_the_form_and_adds_kpi_rows(api):
    api("POST", "/api/admin/clear")
    csv = ("ID,Title,Submitter email,Owner email,Executive sponsor,Type of AI use case,Who it reaches,What it can do on its own,"
           "Problem to solve,Expected value per year (USD),One-time cost (USD),Running cost (USD),Running cost is,"
           "KPI name,Better when,Target,Scale-up target,Stop limit,Vendor contact\r\n"
           "UC-21,Example invoice capture,p_dana,Marcus Lee,Example sponsor,vendor,Customers or the public,Acts on its own,"
           "Typing invoices by hand,\"$70,000\",29250,35000,\"total, per year\",Invoices read without a person (%),higher,80,90,35,someone\r\n"
           ",,,,,,,,,,,,,Errors per 100 invoices,lower,2,,5,\r\n")
    csv = csv.replace("p_dana", "Dana Whitfield")
    out = api("POST", "/api/admin/cases/import", body={"csv": csv})[1]
    assert out == {"applied": True, "added": 1, "ids": ["UC-21"], "skippedColumns": ["Vendor contact"]}
    f = api("GET", "/api/cases/UC-21", pid="p_dana")[1]["case"]["form"]
    assert (f["ownerId"], f["owner"], f["sponsor"], f["ucType"], f["scope"], f["autonomy"]) == \
        ("p_marcus", "Marcus Lee", "Example sponsor", "vendor", "customer", "automate")
    assert (f["problem"], f["valueUSD"], f["costUSD"], f["ongoingCostUSD"], f["ongoingBasis"]) == \
        ("Typing invoices by hand", 70000, 29250, 35000, "total_year")
    assert [(m["id"], m["name"], m["dir"], m["target"], m["scaleUp"], m["stop"]) for m in f["measures"]] == [
        ("m1", "Invoices read without a person (%)", "higher", 80, 90, 35), ("m2", "Errors per 100 invoices", "lower", 2, None, 5)]


def test_import_cases_lists_every_bad_value_and_changes_nothing(api):
    before = len(api("GET", "/api/cases")[1])
    csv = ("Title,Submitter email,Owner email,Who it reaches,One-time cost (USD),KPI name,Better when,Target,Stop limit\r\n"
           "Example A,Dana Whitfield,Demo admin,Everyone,lots,Speed,faster,10,5\r\n"
           ",,,,,Errors,lower,5,2\r\n")
    out = api("POST", "/api/admin/cases/import", body={"csv": csv})[1]
    assert out["applied"] is False and out["errors"] == [
        'Row 2: "lots" is not an amount in dollars.',
        "Row 2: Who it reaches \"Everyone\" is not one of: One team; One site; Whole company; Customers or the public.",
        "Row 2: Demo admin cannot be the owner (Demo admin).",
        "Row 2: Better when must be higher or lower for KPI \"Speed\".",
        'Row 3: KPI "Errors": where lower is better, the stop limit must be above the target.']
    assert len(api("GET", "/api/cases")[1]) == before


def test_template_imports_cleanly(api):
    api("POST", "/api/admin/people/import", body={"csv": api("GET", "/api/admin/people/template")[1]["csv"]})
    out = api("POST", "/api/admin/cases/import", body={"csv": api("GET", "/api/admin/cases/template")[1]["csv"],
                                                       "defaultSubmitter": "p_dana"})[1]
    assert out["applied"] and out["added"] == 2 and out["skippedColumns"] == []
    f = api("GET", "/api/cases/UC-90", pid="p_dana")[1]["case"]["form"]
    assert len(f["measures"]) == 2 and f["valueUSD"] == 12000


def test_people_import_warns_about_skipped_columns(api):
    out = api("POST", "/api/admin/people/import", body={"csv": PEOPLE_CSV.replace("Title or area", "Title or area,Phone")})[1]
    assert out["applied"] and out["skippedColumns"] == ["Phone"]
