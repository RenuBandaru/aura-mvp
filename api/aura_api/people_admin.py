"""People, imports and backups for the demo admin. Not in build 27, where the people were fixed.

The people behind "Viewing as" live in the data file (``store.people``), so the demo admin can add the
real team on the deployed site. Real names therefore never enter this repository: the templates here
hold invented example rows only.

* :func:`people_page`, :func:`save_person`, :func:`delete_person`: the People page.
* :func:`import_people` and :func:`import_cases`: CSV imports on the Data page. A file with any bad row
  changes nothing; the answer lists the rows to fix.
* :func:`backup` and :func:`restore`: the whole data set as one JSON file.
* :func:`clear_samples`: remove the sample use cases and AI tools before loading real ones.
"""

from __future__ import annotations

import csv
import io
import json
import re
from datetime import datetime, timezone

from aura_engine import constants
from aura_engine.errors import EngineError
from aura_engine.jsx import js_json
from aura_engine.rules import norm_rules

from . import views
from .store import Store, clock_ms

ADMIN_ID = "p_admin"  # the demo admin is kept by every import and cannot be deleted
MAX_ERRORS = 15

# Words people may write in the Role column, mapped to AURA's roles. Labels from ROLE_LABEL count too.
ROLE_WORDS = {
    "submitter": "submitter", "adviser": "adviser", "advisor": "adviser", "ai adviser": "adviser", "ai advisor": "adviser",
    "lead": "lead", "governance lead": "lead", "panel": "panel", "panel reviewer": "panel", "reviewer": "panel",
    "sme": "sme", "expert": "sme", "stakeholder": "stakeholder", "exec": "exec", "executive": "exec",
    "auditor": "auditor", "admin": "admin",
}
# Column headings accepted in the people CSV, mapped to fields.
PEOPLE_COLUMNS = {
    "name": "name", "full name": "name", "email": "email", "work email": "email", "e-mail": "email",
    "role": "role", "aura role": "role", "business unit": "unit", "unit": "unit", "bu": "unit",
    "title": "title", "job title": "title", "title or area": "title", "area": "title", "area covered": "title",
}
# Column headings accepted in the use case CSV.
CASE_COLUMNS = {
    "id": "id", "uc": "id", "uc id": "id", "use case id": "id", "ref": "id", "reference": "id",
    "title": "title", "heading": "title", "use case": "title", "name": "title", "description": "idea", "idea": "idea", "summary": "idea",
    "submitter": "submitter", "submitter email": "submitter", "submitted by": "submitter", "owner": "submitter",
    "business unit": "unit", "unit": "unit",
}

PEOPLE_TEMPLATE = [
    ["Name", "Email", "Role", "Business unit", "Title or area"],
    ["Jane Example", "jane.example@example.com", "Subject matter expert", "Finance, HR and IT", "Cybersecurity"],
    ["Sam Placeholder", "sam.placeholder@example.com", "Panel reviewer", "Finance, HR and IT", "Panel reviewer, finance"],
    ["Alex Sample", "alex.sample@example.com", "Submitter", "Plant operations and manufacturing", "Line supervisor"],
]
CASES_TEMPLATE = [
    ["ID", "Title", "Description", "Submitter email", "Business unit"],
    ["UC-90", "Example: draft maintenance summaries", "Summarize technician notes into a weekly report for the plant manager.",
     "alex.sample@example.com", "Plant operations and manufacturing"],
    ["", "Example: answer questions about product manuals", "", "", ""],
]
CASE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9-]{0,19}$")


def _admin(pid: str | None) -> dict:
    p = next((x for x in constants.PEOPLE if x["id"] == pid), None)
    if not p:
        raise EngineError("Choose who you are acting as.")
    if p["role"] != "admin":
        raise EngineError("Only the demo admin can manage people and data.")
    return p


def _norm(text) -> str:
    return re.sub(r"\s+", " ", str(text or "")).strip()


def _unit_id(rules: dict, text: str) -> str | None:
    """A business unit by id or name (any case); '' for blank; None when it matches nothing."""
    t = _norm(text).lower()
    if not t:
        return ""
    return next((u["id"] for u in rules.get("units") or [] if t in (u["id"].lower(), u["label"].lower())), None)


def _role(text: str) -> str | None:
    t = _norm(text).lower()
    labels = {v.lower(): k for k, v in constants.ROLE_LABEL.items()}
    return ROLE_WORDS.get(t) or labels.get(t)


def _new_id(name: str, taken: set[str]) -> str:
    base = "p_" + (re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")[:30] or "person")
    pid, n = base, 2
    while pid in taken:
        pid, n = base + "_" + str(n), n + 1
    return pid


def _references(store: Store) -> dict[str, dict]:
    """For each person id: how many cases and tools name them, and which rules do."""
    out: dict[str, dict] = {}
    texts = [("case", json.dumps(c)) for c in store.cases] + [("tool", json.dumps(t)) for t in store.tools]
    for p in store.people:
        key = json.dumps(p["id"])
        r = {"cases": sum(1 for kind, t in texts if kind == "case" and key in t),
             "tools": sum(1 for kind, t in texts if kind == "tool" and key in t),
             "rules": [u["label"] + " (business unit adviser)" for u in store.rules.get("units") or [] if u.get("adviserId") == p["id"]]
             + [a["label"] + " (consult area)" for a in store.rules.get("consultAreas") or [] if a.get("personId") == p["id"]]}
        out[p["id"]] = r
    return out


def rule_gaps(store: Store) -> list[str]:
    """Rules that name someone who is missing or no longer fits, so the admin can fix them in the Rules editor."""
    ids = {p["id"]: p for p in store.people}
    gaps = []
    for u in store.rules.get("units") or []:
        p = ids.get(u.get("adviserId"))
        if not p or p["role"] not in ("adviser", "lead"):
            gaps.append("Business unit \"" + u["label"] + "\" has no adviser in the people list. Pick one on Rules, Business units.")
    for a in store.rules.get("consultAreas") or []:
        if a.get("enabled") is False:
            continue
        if a.get("personId") not in ids:
            gaps.append("Consult area \"" + a["label"] + "\" names someone who is not in the people list. Pick an expert on Rules, Consult areas.")
    if not any(p["role"] == "lead" for p in store.people):
        gaps.append("Nobody has the Governance lead role. AURA needs one to triage and chair the panel.")
    return gaps


# ---- People page ----

def _row(p: dict, refs: dict, units: dict) -> dict:
    r = refs.get(p["id"], {"cases": 0, "tools": 0, "rules": []})
    used = r["cases"] or r["tools"] or r["rules"]
    block = ""
    if p["id"] == ADMIN_ID:
        block = "The demo admin is always kept."
    elif used:
        parts = ([str(r["cases"]) + " use case(s)"] if r["cases"] else []) + ([str(r["tools"]) + " AI tool(s)"] if r["tools"] else []) + r["rules"]
        block = "Named on " + ", ".join(parts) + "."
    return {**views.person_view(p), "email": p.get("email", ""), "unitLabel": units.get(p.get("unit") or "", ""),
            "cases": r["cases"], "tools": r["tools"], "rules": r["rules"], "deleteBlock": block}


def people_page(store: Store, pid: str) -> dict:
    _admin(pid)
    refs = _references(store)
    units = {u["id"]: u["label"] for u in store.rules.get("units") or []}
    return {"people": [_row(p, refs, units) for p in store.people],
            "roles": [{"id": r, "label": constants.ROLE_LABEL[r]} for r in constants.ROLES],
            "units": [{"id": u["id"], "label": u["label"]} for u in store.rules.get("units") or []],
            "ruleGaps": rule_gaps(store)}


def _clean_person(people: list[dict], rules: dict, raw: dict, existing: dict | None) -> dict:
    """A person from the form or a CSV row, checked against ``people``. Raises EngineError with a message meant for people."""
    name = _norm(raw.get("name"))
    email = _norm(raw.get("email")).lower()
    role = raw.get("role") if raw.get("role") in constants.ROLES else _role(raw.get("role") or "")
    unit = _unit_id(rules, raw.get("unit") or "")
    if not name:
        raise EngineError("Give the person a name.")
    if not role:
        raise EngineError("Pick a role for " + name + ".")
    if unit is None:
        raise EngineError("\"" + _norm(raw.get("unit")) + "\" is not one of the business units.")
    if email and not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
        raise EngineError("\"" + email + "\" does not look like an email address.")
    pid = existing["id"] if existing else None
    if email and any(p.get("email", "").lower() == email and p["id"] != pid for p in people):
        raise EngineError("Someone else already has the email " + email + ".")
    if existing and existing["id"] == ADMIN_ID and role != "admin":
        raise EngineError("The demo admin keeps the admin role.")
    out = {"id": pid or "", "unit": unit, "name": name, "role": role, "title": _norm(raw.get("title"))}
    if email:
        out["email"] = email
    return out


def save_person(store: Store, pid: str, raw: dict) -> dict:
    """Add a person (no id) or change one (with id)."""
    _admin(pid)
    raw = raw or {}
    with store.lock:
        existing = store.person(raw.get("id")) if raw.get("id") else None
        if raw.get("id") and not existing:
            raise EngineError("That person is no longer in the list. Reload the page.")
        p = _clean_person(store.people, store.rules, raw, existing)
        if existing:
            existing.clear()
            existing.update(p)
        else:
            p["id"] = _new_id(p["name"], {x["id"] for x in store.people})
            store.people.append(p)
        store.save()
    return people_page(store, pid)


def delete_person(store: Store, pid: str, target: str) -> dict:
    _admin(pid)
    with store.lock:
        p = store.person(target)
        if not p:
            raise EngineError("That person is no longer in the list. Reload the page.")
        row = _row(p, _references(store), {})
        if row["deleteBlock"]:
            raise EngineError(p["name"] + " cannot be deleted. " + row["deleteBlock"] + " Change their role instead.")
        store.data["people"] = [x for x in store.people if x["id"] != target]
        store.activate()
        store.save()
    return people_page(store, pid)


# ---- CSV ----

def _read_csv(text: str, columns: dict) -> tuple[list[tuple[int, dict]], list[str]]:
    """Rows as {field: value} with their line numbers, plus problems with the headings."""
    text = (text or "").lstrip("﻿")
    if not text.strip():
        return [], ["The file is empty."]
    reader = csv.reader(io.StringIO(text))
    head = next(reader, [])
    fields = [columns.get(_norm(h).lower()) for h in head]
    rows = []
    for line, cells in enumerate(reader, start=2):
        if not any(_norm(c) for c in cells):
            continue
        row = {}
        for f, c in zip(fields, cells):
            if f and not row.get(f):
                row[f] = _norm(c)
        rows.append((line, row))
    return rows, []


def _csv_text(rows: list[list[str]]) -> str:
    buf = io.StringIO()
    csv.writer(buf, lineterminator="\r\n").writerows(rows)
    return buf.getvalue()


def people_template(store: Store, pid: str) -> dict:
    _admin(pid)
    return {"filename": "aura-people-template.csv", "csv": _csv_text(PEOPLE_TEMPLATE)}


def cases_template(store: Store, pid: str) -> dict:
    _admin(pid)
    return {"filename": "aura-use-cases-template.csv", "csv": _csv_text(CASES_TEMPLATE)}


def people_export(store: Store, pid: str) -> dict:
    _admin(pid)
    units = {u["id"]: u["label"] for u in store.rules.get("units") or []}
    rows = [PEOPLE_TEMPLATE[0]] + [[p["name"], p.get("email", ""), constants.ROLE_LABEL.get(p["role"], p["role"]),
                                    units.get(p.get("unit") or "", ""), p.get("title", "")] for p in store.people]
    return {"filename": "aura-people.csv", "csv": _csv_text(rows)}


def import_people(store: Store, pid: str, text: str, mode: str = "merge") -> dict:
    """Add or update people from a CSV. ``mode`` ``"replace"`` also removes everyone not in the file.

    People are matched by email, then by name. Nothing changes unless every row is valid.
    """
    _admin(pid)
    rows, errors = _read_csv(text, PEOPLE_COLUMNS)
    if not errors and not rows:
        errors.append("The file has headings but no people.")
    with store.lock:
        people = [dict(p) for p in store.people]
        seen, added, updated = set(), 0, 0
        for line, raw in rows:
            match = next((p for p in people if raw.get("email") and p.get("email", "").lower() == raw["email"].lower()), None) \
                or next((p for p in people if p["name"].lower() == raw.get("name", "").lower()), None)
            try:
                p = _clean_person(people, store.rules, raw, match)  # checked against the list being built
            except EngineError as e:
                errors.append("Row " + str(line) + ": " + e.message)
                continue
            if match:
                if match["id"] in seen:
                    errors.append("Row " + str(line) + ": " + p["name"] + " appears twice in the file.")
                    continue
                match.clear()
                match.update(p)
                updated += 1
            else:
                p["id"] = _new_id(p["name"], {x["id"] for x in people})
                people.append(p)
                added += 1
            seen.add(p["id"])
        removed = []
        if mode == "replace" and not errors:
            refs = _references(store)
            for p in people:
                if p["id"] in seen or p["id"] == ADMIN_ID:
                    continue
                r = refs.get(p["id"], {"cases": 0, "tools": 0})
                if r["cases"] or r["tools"]:
                    errors.append(p["name"] + " is not in the file but is named on use cases or AI tools. "
                                  "Use \"Remove sample use cases and tools\" first, or add them to the file.")
                else:
                    removed.append(p["id"])
            people = [p for p in people if p["id"] not in removed]
        if errors:
            return {"applied": False, "errors": errors[:MAX_ERRORS], "moreErrors": max(0, len(errors) - MAX_ERRORS)}
        store.data["people"] = people
        store.activate()
        store.log_admin(pid, "Imported people (" + str(added) + " added, " + str(updated) + " updated, " + str(len(removed)) + " removed)")
        store.save()
    return {"applied": True, "added": added, "updated": updated, "removed": len(removed), "ruleGaps": rule_gaps(store)}


def import_cases(store: Store, pid: str, text: str, default_submitter: str | None = None) -> dict:
    """Log each row as a new suggestion from its submitter, exactly as if they used "New suggestion".

    Only a title is required. A blank description uses the title; a blank submitter uses
    ``default_submitter``; a given ID (such as ``UC-03``) is kept when no other case has it.
    """
    _admin(pid)
    rows, errors = _read_csv(text, CASE_COLUMNS)
    if not errors and not rows:
        errors.append("The file has headings but no use cases.")
    fallback = store.person(default_submitter) if default_submitter else None
    taken = {c["id"].lower() for c in store.cases}
    plan = []
    for line, raw in rows:
        who = raw.get("submitter", "").lower()
        p = next((x for x in store.people if who and (x.get("email", "").lower() == who or x["name"].lower() == who)), None) if who else fallback
        unit = _unit_id(store.rules, raw.get("unit", ""))
        cid = raw.get("id", "")
        if not raw.get("title"):
            errors.append("Row " + str(line) + ": add a title.")
        elif cid and not CASE_ID.match(cid):
            errors.append("Row " + str(line) + ": \"" + cid + "\" cannot be used as an ID. Use letters, numbers and dashes, such as UC-03.")
        elif cid and cid.lower() in taken:
            errors.append("Row " + str(line) + ": another use case already has the ID " + cid + ".")
        elif not p and who:
            errors.append("Row " + str(line) + ": no one in the people list has the email or name \"" + raw.get("submitter", "") + "\". Import the people first.")
        elif not p:
            errors.append("Row " + str(line) + ": no submitter. Pick who logs rows without one.")
        elif p["role"] in ("admin", "auditor"):
            errors.append("Row " + str(line) + ": " + p["name"] + " has a role that cannot log suggestions.")
        elif unit is None:
            errors.append("Row " + str(line) + ": \"" + raw.get("unit", "") + "\" is not one of the business units.")
        else:
            if cid:
                taken.add(cid.lower())
            plan.append((cid or None, p, raw["title"], raw.get("idea") or raw["title"], unit))
    if errors:
        return {"applied": False, "errors": errors[:MAX_ERRORS], "moreErrors": max(0, len(errors) - MAX_ERRORS)}
    from .service import new_suggestion  # here, not at the top: service imports this module
    ids = [new_suggestion(store, p, title, idea, unit, cid)["id"] for cid, p, title, idea, unit in plan]
    with store.lock:
        store.log_admin(pid, "Imported " + str(len(ids)) + " use case(s)")
        store.save()
    return {"applied": True, "added": len(ids), "ids": ids}


# ---- whole data set ----

def backup(store: Store, pid: str) -> dict:
    _admin(pid)
    day = datetime.fromtimestamp(clock_ms() / 1000, timezone.utc).strftime("%Y-%m-%d")
    return {"filename": "aura-backup-" + day + ".json", "json": js_json(store.data)}


def restore(store: Store, pid: str, data) -> dict:
    """Replace everything with a backup made by :func:`backup`."""
    _admin(pid)
    if isinstance(data, str):
        try:
            data = json.loads(data)
        except ValueError:
            raise EngineError("That file is not an AURA backup (it is not readable JSON).")
    if not isinstance(data, dict) or not all(isinstance(data.get(k), list) for k in ("cases", "tools", "versions")) \
            or not isinstance(data.get("rules"), dict) or not isinstance(data.get("meta"), dict):
        raise EngineError("That file is not an AURA backup (cases, tools, rules, versions or meta are missing).")
    data.setdefault("files", [])
    data.setdefault("people", constants.sample_people())
    if not any(p.get("id") == ADMIN_ID and p.get("role") == "admin" for p in data["people"]):
        raise EngineError("That backup has no demo admin, so nobody could manage it after restoring.")
    try:
        norm_rules(data["rules"])
    except Exception:
        raise EngineError("The rules in that backup cannot be read.")
    prev = store.data["meta"].get("adminLog") or []
    store.replace_all(data)
    with store.lock:
        store.log_admin(pid, "Restored a backup (" + str(len(data["cases"])) + " use cases)", prev)
        store.save()
    return {"ok": True, "cases": len(data["cases"]), "people": len(data["people"])}


def clear_samples(store: Store, pid: str) -> dict:
    """Remove every use case, AI tool and uploaded file, keeping the people, rules and training records."""
    _admin(pid)
    with store.lock:
        n = len(store.cases)
        store.data["cases"], store.data["tools"], store.data["files"] = [], [], []
        store.log_admin(pid, "Removed " + str(n) + " use case(s) and every AI tool")
        store.save()
    return {"ok": True, "removed": n}
