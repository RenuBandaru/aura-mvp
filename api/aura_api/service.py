"""What the API can do, as plain functions. Each one takes the store and the person acting.

These functions do not know about HTTP. :mod:`aura_api.routes` maps URLs to them, so the same code
serves the laptop dev server, the Azure Functions app and the tests.

Every change follows the same pattern as build 27's ``doAction``: ask the engine for the new version
of a case, then save it. The engine refuses anything not allowed by raising ``EngineError``, so nothing
here re-checks permissions.
"""

from __future__ import annotations

import base64
import json

import aura_engine as E
from aura_engine import constants
from aura_engine.constants import PEOPLE
from aura_engine.errors import EngineError
from aura_engine.controls import CTL_STATUS
from aura_engine.forms import FORM_FIELDS, ONGOING_BASIS
from aura_engine.matching import options_of
from aura_engine.rules import norm_rules
from aura_engine.tools import TOOL_STATUS, next_tool_id
from aura_engine.jsx import clone

from . import rules_admin, views
from .store import Store, clock_ms

MAX_UPLOAD = 2_000_000  # bytes accepted by the API; the engine applies the real evidence limit


class NotFound(Exception):
    """The case, tool or file does not exist."""


def person(pid: str | None) -> dict:
    """The person acting. Unknown ids are refused so a typo never acts as a stand-in person."""
    p = next((x for x in PEOPLE if x["id"] == pid), None)
    if not p:
        raise EngineError("Choose who you are acting as.")
    return p


def _case(store: Store, case_id: str) -> dict:
    c = store.case(case_id)
    if not c:
        raise NotFound("No use case " + case_id + ".")
    return c


# ---- reading ----

def bootstrap(store: Store) -> dict:
    """What the app loads once: people, rules and labels."""
    rules = store.rules
    return {"people": [views.person_view(p) for p in PEOPLE], "rules": rules, "stageLabels": constants.STAGE_LABEL,
            "tierLabels": constants.TIER_LABEL, "roleLabels": constants.ROLE_LABEL, "stages": constants.STAGES,
            "formFields": FORM_FIELDS, "toolStatus": TOOL_STATUS, "scopeOpts": constants.SCOPE_OPTS, "autonomyOpts": constants.AUTONOMY_OPTS,
            "ongoingBasis": ONGOING_BASIS, "ctlStatus": CTL_STATUS,
            # the answer choices for every question, including "Not known" where allowed (engine optionsOf)
            "questionOptions": {q["id"]: options_of(q) for q in rules["questions"]}}


def queue(store: Store, pid: str) -> dict:
    p, ctx = person(pid), store.ctx()
    items = views.queue_for(p, store.cases, ctx)
    in_queue = {i["id"] for i in items}
    rows = [views.case_row(c, ctx) for c in sorted(store.cases, key=lambda x: x["id"]) if c["id"] not in in_queue]
    return {"items": items, "mine": [r for r in rows if r["submitterId"] == pid],
            "advised": [r for r in rows if r["adviserId"] == pid and r["submitterId"] != pid]}


def list_cases(store: Store, pid: str) -> list[dict]:
    person(pid)
    ctx = store.ctx()
    return [views.case_row(c, ctx) for c in sorted(store.cases, key=lambda x: x["id"])]


def get_case(store: Store, pid: str, case_id: str) -> dict:
    return views.case_detail(_case(store, case_id), person(pid), store.ctx())


def preview_form(store: Store, pid: str, case_id: str, form: dict) -> dict:
    """Live checks for a form being edited. Nothing is saved."""
    person(pid)
    c = _case(store, case_id)
    return views.form_preview(views.clean_form(form or {}, c.get("form") or {}), store.rules)


def outbox(store: Store, pid: str, who: str | None = None) -> list[dict]:
    person(pid)
    return views.outbox_for(store.data, who or None)[:200]


def file_content(store: Store, pid: str, file_id: str) -> dict:
    person(pid)
    f = store.file(file_id)
    if not f:
        raise NotFound("No file " + file_id + ".")
    return f


# ---- changing use cases ----

def perform(store: Store, pid: str, case_id: str, action_id: str, inp: dict | None) -> dict:
    """Carry out an action and save the result. Port of build 27's ``doAction``."""
    actor = person(pid)
    inp = dict(inp or {})
    upload = inp.pop("upload", None)  # {"name", "type", "dataUrl"} for evidence files
    with store.lock:
        c, ctx = _case(store, case_id), store.ctx()
        if upload and action_id == "add_evidence":
            inp.update(_upload_meta(store, upload))
        if isinstance(inp.get("form"), dict):  # the use case form as the browser typed it
            inp["form"] = views.clean_form(inp["form"], c.get("form") or {})
        nxt = E.perform(c, action_id, inp, actor, ctx)
        made = E.ensure_tool(nxt, store.tools, ctx["now"], ctx["rv"])  # a case reaching production joins the AI tool catalog
        if made:
            nxt = made["c"]
            store.put_tool(made["tool"])
        if upload and action_id == "add_evidence":
            store.add_file({"id": inp["fileId"], "caseId": case_id, "name": inp["fileName"], "type": inp["type"], "size": inp["size"], "data": upload["dataUrl"]})
        store.put_case(nxt)
        store.save()
    return views.case_detail(nxt, actor, store.ctx())


def _upload_meta(store: Store, upload: dict) -> dict:
    data_url = upload.get("dataUrl") or ""
    try:
        size = len(base64.b64decode(data_url.split(",", 1)[1], validate=False))
    except (IndexError, ValueError):
        raise EngineError("The file could not be read.")
    if size > MAX_UPLOAD:
        raise EngineError("A file can be up to 500 KB.")
    file_id = "F-" + str(1001 + len(store.data.get("files") or []))
    return {"fileId": file_id, "fileName": upload.get("name") or "file", "size": size, "type": upload.get("type") or "application/octet-stream"}


def create_case(store: Store, pid: str, title: str, idea: str, unit_id: str | None = None) -> dict:
    """Log a new suggestion. Port of the ``create`` handler in build 27's ui.js."""
    actor = person(pid)
    title, idea = (title or "").strip(), (idea or "").strip()
    if not title or not idea:
        raise EngineError("Add a title and a short description.")
    if actor["role"] in ("admin", "auditor"):
        raise EngineError("This role cannot log suggestions.")
    with store.lock:
        ctx = store.ctx()
        nc = E.assign_adviser(E.new_case(store.next_case_id(), title, idea, pid, ctx["now"], ctx["rv"]), store.rules, unit_id or None)
        if nc.get("adviserId") and nc["adviserId"] != pid:
            nc["outbox"].append({"ts": ctx["now"], "n": len(nc["outbox"]), "to": [nc["adviserId"]], "subject": "New idea in your business unit: " + title,
                                 "body": actor["name"] + " logged a new idea: " + idea, "kind": "notice", "auto": True})
        store.put_case(nc)
        store.save()
    return views.case_detail(nc, actor, store.ctx())


def similar(store: Store, pid: str, text: str, exclude: str | None = None) -> list[dict]:
    """Existing tools and cases that look like an idea, so people reuse before they build."""
    person(pid)
    return E.match_catalog(text or "", store.tools, store.cases, 5, exclude)


def reminder_sweep(store: Store, pid: str) -> dict:
    """Send due reminders on every case under review. Governance lead or demo admin only."""
    actor = person(pid)
    if actor["role"] not in ("lead", "admin"):
        raise EngineError("Only the governance lead can run the reminder sweep.")
    n = 0
    with store.lock:
        ctx = store.ctx()
        for c in [x for x in store.cases if x["stage"] in ("panel", "exec")]:
            r = E.remind_case(c, ctx, E.SYSTEM)
            if r:
                store.put_case(r)
                n += 1
        store.save()
    return {"casesReminded": n}


def reset(store: Store, pid: str) -> dict:
    if person(pid)["role"] != "admin":
        raise EngineError("Only the demo admin can reset the data.")
    store.reset()
    return {"ok": True}


# ---- audit log ----

def audit_log(store: Store, pid: str, who: str | None = None, q: str | None = None) -> dict:
    """The Audit log page: entries newest first, filtered, plus how many matched in all."""
    viewer = person(pid)
    rows = views.filter_audit(views.audit_entries(store.cases, viewer), who, q)
    return {"entries": rows[:views.AUDIT_PAGE], "total": len(rows)}


# ---- verify audit trail ----

def verify_audit_trail(store: Store, pid: str) -> dict:
    """Check the hash chain on every case. JavaScript ``verifyaudit`` (the button handler)."""
    person(pid)
    return {"at": clock_ms(), "results": [{"id": c["id"], **E.verify_audit(c)} for c in store.cases]}


def audit_export(store: Store, pid: str) -> dict:
    """The whole Audit log as CSV text. The browser turns it into a file download."""
    return {"filename": "audit-log.csv", "csv": views.audit_csv(store.cases, person(pid))}


def tamper(store: Store, pid: str) -> dict:
    """Demo only: change one old audit entry without resealing it, so Verify audit trail catches it."""
    if person(pid)["role"] != "admin":
        raise EngineError("Only the demo admin can alter the audit trail.")
    with store.lock:
        c = clone(store.case("UC-1002") or store.cases[0])
        i = min(2, len(c["audit"]) - 1)
        c["audit"][i]["note"] = (c["audit"][i].get("note") or "") + " (edited later)"
        store.put_case(c)
        store.save()
    return {"caseId": c["id"], "entry": i + 1}


# ---- training ----

def training(store: Store, pid: str) -> dict:
    """The Training page for the person acting."""
    return views.training_page(store.rules, store.data["meta"].get("training") or {}, person(pid), clock_ms())


def complete_training(store: Store, pid: str, training_id: str) -> dict:
    """Record that the person acting finished a course, today, at its current version. JavaScript ``traindone``."""
    p = person(pid)
    if p["role"] in ("admin", "auditor"):
        raise EngineError("Training is recorded by the person who took it.")
    t = next((x for x in store.rules.get("trainings") or [] if x["id"] == training_id), None)
    if not t:
        raise NotFound("No training " + training_id + ".")
    with store.lock:
        meta = store.data["meta"]
        records = clone(meta.get("training") or {})
        records[p["id"]] = {**(records.get(p["id"]) or {}), t["id"]: {"at": clock_ms(), "ver": t.get("version")}}
        meta["training"] = records
        store.save()
    return training(store, pid)


def training_reminders(store: Store, pid: str) -> dict:
    """Email everyone with training due or overdue. Governance lead or demo admin. JavaScript ``trainremind``."""
    if person(pid)["role"] not in ("lead", "admin"):
        raise EngineError("Only the governance lead can send training reminders.")
    with store.lock:
        meta, now = store.data["meta"], clock_ms()
        mails = list(meta.get("trainingMail") or [])
        n = 0
        for x in views.training_people():
            due = views.training_due(store.rules.get("trainings") or [], meta.get("training") or {}, x, now)
            if not due:
                continue
            n += 1
            contact = ", or contact " + due[0]["contact"] + " if you are stuck" if due[0].get("contact") else ""
            mails.append({"ts": now, "n": len(mails), "to": [x["id"]], "subject": "Reminder: training due",
                          "body": "Please complete: " + "; ".join(t["title"] for t in due) + ". Open Training in AURA" + contact + ".",
                          "kind": "reminder", "auto": False})
        meta["trainingMail"] = mails
        store.save()
    return {"peopleReminded": n}


# ---- dashboard ----

def dashboard(store: Store, pid: str, ex_days: str | None = None) -> dict:
    """The Dashboard. ``ex_days`` is the exceptions period: 30, 90, 180 (the default), 365 or 0 for all time."""
    days = int(ex_days) if ex_days and ex_days.isdigit() else 180
    if days not in [d for d, _ in views.EXC_PERIODS]:
        raise EngineError("Choose a period from the list.")
    return views.dashboard(store.data, person(pid), clock_ms(), days)


def cases_export(store: Store, pid: str) -> dict:
    """Every use case as CSV text. The browser turns it into a file download."""
    person(pid)
    return {"filename": "use-cases.csv", "csv": views.cases_csv(store.cases, clock_ms())}


# ---- rules editor (demo admin) ----

def _admin(pid: str) -> dict:
    p = person(pid)
    if p["role"] != "admin":
        raise EngineError("Only the demo admin can change the rules.")
    return p


def _draft(draft) -> dict:
    """A draft from the browser, refused politely when it is not a usable set of rules (for example bad JSON)."""
    if not isinstance(draft, dict) or not all(k in draft for k in ("questions", "rules", "tiers", "deadlines")):
        raise EngineError("The rules are missing required sections.")
    try:
        return norm_rules(draft)
    except Exception:
        raise EngineError("These rules cannot be read. Check the JSON on the Advanced tab.") from None


def rules_page(store: Store, pid: str) -> dict:
    """The saved rules, their versions and the editor's fixed labels."""
    _admin(pid)
    versions = sorted(store.data.get("versions") or [], key=lambda v: -v["n"])
    scored = {}
    for c in store.cases:
        n = (c.get("scoring") or {}).get("rv")
        scored[n] = scored.get(n, 0) + 1
    return {"rules": store.rules, "version": store.rules_version(), "defaults": E.default_rules(), "labels": rules_admin.labels(),
            "versions": [{"n": v["n"], "at": v["at"], "by": v["by"], "byName": constants.by_id(v["by"])["name"], "reason": v["reason"],
                          "summary": v.get("summary") or [], "casesScored": scored.get(v["n"], 0)} for v in versions]}


def rules_inspect(store: Store, pid: str, draft: dict) -> dict:
    _admin(pid)
    return rules_admin.inspect(_draft(draft), store.rules, store.cases)


def rules_apply_item(store: Store, pid: str, body: dict) -> dict:
    _admin(pid)
    return {"draft": rules_admin.apply_item(_draft(body.get("draft")), body.get("kind"), body.get("item"), bool(body.get("isNew")),
                                            body.get("area"), body.get("index"))}


def rules_check(store: Store, pid: str, draft: dict) -> dict:
    _admin(pid)
    return {**rules_admin.check(_draft(draft), store.rules, store.cases), "nextVersion": store.rules_version() + 1}


def rules_what_if(store: Store, pid: str, body: dict) -> dict:
    _admin(pid)
    return rules_admin.try_answers(_draft(body.get("draft")), body.get("input"), body.get("rule"))


def rules_version(store: Store, pid: str, n: str) -> dict:
    """One saved version's rules, to load into the draft."""
    _admin(pid)
    v = next((x for x in store.data.get("versions") or [] if str(x["n"]) == n), None)
    if not v:
        raise NotFound("No version " + n + " of the rules.")
    return {"rules": norm_rules(json.loads(v["json"]))}


def save_rules(store: Store, pid: str, draft: dict, reason: str, accept_warnings: bool = False) -> dict:
    """Save the draft as a new version of the rules. JavaScript ``publishRules``.

    The checks run here again, whatever the browser showed: errors always refuse, and warnings
    refuse unless the admin has seen them and chose "Save anyway". One reason covers the whole save.
    """
    actor = _admin(pid)
    draft = _draft(draft)
    reason = str(reason or "").strip()
    if not reason:
        raise EngineError("Say why the rules are changing. One reason covers the whole save.")
    with store.lock:
        v = rules_admin.check(draft, store.rules, store.cases)
        if v["errors"] or (v["warnings"] and not accept_warnings):
            return {"saved": False, **v}
        rules = norm_rules(draft)
        n = store.rules_version() + 1
        store.data.setdefault("versions", []).append({"n": n, "at": clock_ms(), "by": actor["id"], "reason": reason,
                                                      "summary": v["changes"] or ["No setting changed."], "json": E.js_json(rules)})
        store.data["rules"] = rules
        store.save()
    return {"saved": True, "version": n}


def rescore_open_cases(store: Store, pid: str) -> dict:
    """Score every case in vetting, panel or executive review again under the saved rules. JavaScript ``rescore``."""
    if person(pid)["role"] not in ("lead", "admin"):
        raise EngineError("Only the governance lead or the demo admin can re-score cases.")
    n = 0
    with store.lock:
        ctx = store.ctx()
        for c in list(store.cases):
            r = E.rescore(c, ctx)
            if r:
                store.put_case(r)
                n += 1
        store.save()
    return {"rescored": n}


# ---- AI tool catalog ----

def list_tools(store: Store, pid: str) -> list[dict]:
    p = person(pid)
    return [views.tool_view(t, p) for t in store.tools if E.tool_visible(t, p)]


def get_tool(store: Store, pid: str, tool_id: str) -> dict:
    p = person(pid)
    t = store.tool(tool_id)
    if not t or not E.tool_visible(t, p):
        raise NotFound("No AI tool " + tool_id + ".")
    return views.tool_view(t, p)


def new_tool(store: Store, pid: str) -> dict:
    p = person(pid)
    if p["role"] in ("admin", "auditor"):
        raise EngineError("This role cannot report AI tools.")
    with store.lock:
        t = E.new_tool(next_tool_id(store.tools), pid, store.ctx()["now"])
        store.put_tool(t)
        store.save()
    return views.tool_view(t, p)


def tool_action(store: Store, pid: str, tool_id: str, action_id: str, inp: dict | None) -> dict:
    p = person(pid)
    with store.lock:
        t = store.tool(tool_id)
        if not t or not E.tool_visible(t, p):
            raise NotFound("No AI tool " + tool_id + ".")
        nt = E.perform_tool(t, action_id, inp, p, store.ctx())
        if nt.get("discard"):
            store.drop_tool(tool_id)
            store.save()
            return {"discarded": True}
        store.put_tool(nt)
        store.save()
    return views.tool_view(nt, p)
