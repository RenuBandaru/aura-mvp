"""The AI tool catalog (B-06): a simple list of known AI tools.

People report tools they use; the governance lead sets each tool's status. A use case that
reaches production gets a catalog entry once (:func:`ensure_tool`). Production review stays on
the use case, which the tool links to.
"""

from __future__ import annotations

import re

from .audit import seal_audit
from .constants import by_id, with_role
from .errors import EngineError
from .jsx import UNDEF, clone, js_or, js_str, num_or_zero, truthy
from .people import owner_of

TOOL_STATUS = {"draft": "Draft", "reported": "Reported", "review": "Under review", "approved": "Approved", "not_approved": "Not approved", "retired": "Retired"}
TOOL_SOURCE = {"reported": "Reported by a person", "use_case": "Created from a use case"}
TOOL_FIELDS = ["name", "vendor", "purpose", "users", "accessNote", "link", "ownerId"]


def next_tool_id(tools) -> str:
    """The next catalog id, from T-1001 up. JavaScript ``nextToolId``."""
    nums = [num_or_zero(js_str(t.get("id"))[2:]) for t in (tools or [])]
    return "T-" + js_str(max([1000] + nums) + 1)


def new_tool(tool_id: str, reporter_id: str, now) -> dict:
    """A private draft catalog entry. JavaScript ``newTool``."""
    return {"outbox": [], "id": tool_id, "status": "draft", "name": "", "vendor": "", "purpose": "", "users": "", "accessNote": "", "link": "",
            "ownerId": reporter_id, "reportedBy": reporter_id, "source": "reported", "useCaseId": None, "createdAt": now, "reportedAt": None,
            "history": [{"ts": now, "actor": reporter_id, "action": "Draft started", "note": ""}]}


def tool_visible(t: dict, person: dict) -> bool:
    """A reporter's draft is private to them. Everything else is visible to everyone. JavaScript ``toolVisible``."""
    return t.get("status") != "draft" or t.get("reportedBy") == person.get("id")


def tool_actions(t: dict, actor: dict) -> list[dict]:
    """What this person can do with a catalog entry. JavaScript ``toolActions``."""
    out = []

    def A(action_id, label, **opts):
        out.append({"id": action_id, "label": label, "tone": "", "fields": [], **opts})

    if t.get("status") == "draft":
        if t.get("reportedBy") == actor.get("id"):
            A("report_tool", "Report this AI tool", tone="primary", form=True)
            A("save_tool", "Save draft", form=True)
            A("discard_tool", "Discard draft")
        return out
    lead = actor.get("role") == "lead"
    if lead or actor.get("id") == t.get("ownerId"):
        A("edit_tool", "Save changes", tone="primary", form=True)
    if lead:
        A("set_tool_status", "Change status", fields=[
            {"name": "status", "label": "New status", "type": "select", "required": True,
             "options": [{"v": x, "l": TOOL_STATUS[x]} for x in ("reported", "review", "approved", "not_approved", "retired") if x != t.get("status")]},
            {"name": "note", "label": "Note (optional)", "type": "textarea", "required": False}])
    return out


def perform_tool(t0: dict, action_id: str, inp, actor: dict, ctx: dict) -> dict:
    """Apply a catalog action and return the new entry. JavaScript ``performTool``."""
    inp = inp or {}
    t = clone(t0)
    now = ctx["now"]
    a = next((x for x in tool_actions(t0, actor) if x["id"] == action_id), None)
    if not a:
        raise EngineError("This action is not available to " + actor["name"] + " right now.")
    for f in a.get("fields") or []:
        if truthy(f.get("required")) and not js_str(js_or(inp.get(f["name"]), "")).strip():
            raise EngineError(f["label"] + " is required.")

    def log(action, note=""):
        t["history"].append({"ts": now, "actor": actor["id"], "action": action, "note": js_or(note, "")})

    def merge():
        f = js_or(inp.get("form"), {})
        for k in TOOL_FIELDS:
            if k in f:
                t[k] = js_str("" if f[k] is None else f[k]).strip()

    def tmail(to, subject, body):
        t["outbox"] = js_or(t.get("outbox"), []) + [{"ts": now, "n": len(t.get("outbox") or []), "to": [to], "subject": subject, "body": body, "kind": "notice", "auto": True}]

    if action_id == "save_tool":
        merge()
    elif action_id == "report_tool":
        merge()
        if not t["name"]:
            raise EngineError("Give the AI tool a name.")
        if not t["purpose"]:
            raise EngineError("Say what it is used for.")
        if not truthy(t.get("ownerId")) or by_id(t["ownerId"])["role"] == "unknown":
            raise EngineError("Pick an owner.")
        t["status"] = "reported"
        t["reportedAt"] = now
        if t["ownerId"] != actor["id"]:
            tmail(t["ownerId"], "AI tool reported with you as owner: " + t["name"],
                  actor["name"] + " reported this AI tool and named you as its owner. You can open it and edit its details. Reporting an AI tool carries no consequence.")
        for lead in with_role("lead"):
            if lead["id"] != actor["id"] and lead["id"] != t["ownerId"]:
                tmail(lead["id"], "New AI tool reported: " + t["name"],
                      actor["name"] + " reported this AI tool (owner: " + by_id(t["ownerId"])["name"] + "). It shows as Reported in the AI tool catalog. Reporting carries no consequence.")
        log("Reported", "Reporting an AI tool carries no consequence. Reviews apply going forward.")
    elif action_id == "discard_tool":
        t["discard"] = True
    elif action_id == "edit_tool":
        before = clone(t)
        merge()
        ch = [k for k in TOOL_FIELDS if before.get(k) != t.get(k)]
        log("Edited", "Changed: " + ", ".join(ch) + "." if ch else "No changes.")
    elif action_id == "set_tool_status":
        old = t["status"]
        t["status"] = inp.get("status")
        note = js_str(inp["note"]).strip() if truthy(inp.get("note")) else ""
        log("Status changed", TOOL_STATUS[old] + " to " + js_str(TOOL_STATUS.get(t["status"], UNDEF)) + (". " + note if truthy(inp.get("note")) else ""))
        # The owner is told. The reporter is deliberately not, so a move to Under review does not alarm them.
        if truthy(t.get("ownerId")) and t["ownerId"] != actor["id"]:
            tmail(t["ownerId"], "AI tool status changed: " + t["name"],
                  "The governance lead changed the status of this AI tool from " + TOOL_STATUS[old] + " to " + js_str(TOOL_STATUS.get(t["status"], UNDEF)) + "."
                  + (" Note: " + note if truthy(inp.get("note")) else ""))
    return t


def ensure_tool(c0: dict, tools, now, rv=None):
    """Give a production use case its catalog entry, once. Returns ``{"c": case, "tool": tool}`` or None. JavaScript ``ensureTool``."""
    if c0.get("stage") != "production" or truthy(c0.get("toolId")):
        return None
    c = clone(c0)
    tool_id = next_tool_id(tools)
    sol = re.split(r"(?<=\.)\s", js_str(js_or(c["form"].get("solution"), "")))[0][:220]
    tool = {"outbox": [], "id": tool_id, "status": "approved", "name": c.get("title"), "vendor": "", "purpose": sol, "users": js_or(c["form"].get("users"), ""),
            "accessNote": "", "link": "", "ownerId": owner_of(c), "reportedBy": c.get("submitterId"), "source": "use_case", "useCaseId": c["id"], "createdAt": now,
            "reportedAt": now, "history": [{"ts": now, "actor": "system", "action": "Created from " + c["id"],
                                             "note": "The use case reached production. Owner and key details were copied once and can now change here without touching the use case."}]}
    c["toolId"] = tool_id
    c["audit"].append({"ts": now, "actor": "system", "action": "AI tool catalog entry created", "note": tool_id, "from": c["stage"], "to": c["stage"], "auto": True, "tag": ""})
    return {"c": seal_audit(c, js_or(rv, 1), now), "tool": tool}
