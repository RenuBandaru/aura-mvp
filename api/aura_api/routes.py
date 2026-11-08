"""Maps HTTP requests to :mod:`aura_api.service` functions, independent of the web host.

:func:`dispatch` takes the method, the path, the query string values, the JSON body and the headers,
and returns ``(status, json_body)``. Both hosts (``dev_server.py`` and ``function_app.py``) call it.

Endpoints (all under ``/api``; every one needs the ``X-Aura-Person`` header naming the person acting,
except ``GET /api/bootstrap``)::

    GET  /api/bootstrap                          people, rules and labels
    GET  /api/queue                              cases waiting for me
    GET  /api/cases                              all cases (list rows)
    POST /api/cases                              log a suggestion {title, idea, unitId?}
    GET  /api/cases/{id}                         the case page
    POST /api/cases/{id}/actions/{action}        carry out an action {input}
    POST /api/cases/{id}/preview                 live checks for a form being edited {form}
    GET  /api/similar?text=...&exclude=UC-1001   look-alike tools and cases
    GET  /api/outbox?who=p_dana                  simulated emails
    GET  /api/files/{id}                         an uploaded evidence file
    GET  /api/tools                              the AI tool catalog
    POST /api/tools                              start reporting a tool (a private draft)
    GET  /api/tools/{id}                         one tool
    POST /api/tools/{id}/actions/{action}        act on a tool {input}
    POST /api/admin/sweep                        reminder sweep (lead or admin)
    POST /api/admin/reset                        reset to the sample data (admin)

Errors come back as ``{"error": message}``: 400 when the engine refuses (the message is for people),
404 when something does not exist.

Who is acting: for the local demo the React app sends the person picked in its "Viewing as" menu.
With Microsoft sign-in this header is replaced by the signed-in user, mapped to a person
(see docs/code-guide.md, "What comes next").
"""

from __future__ import annotations

import re
import traceback

from aura_engine.errors import EngineError

from . import service as S
from .service import NotFound

PERSON_HEADER = "x-aura-person"

# (method, path pattern, handler(store, pid, match, query, body)). The first match wins.
ROUTES = [
    ("GET", r"/api/bootstrap", lambda st, pid, m, q, b: S.bootstrap(st)),
    ("GET", r"/api/queue", lambda st, pid, m, q, b: S.queue(st, pid)),
    ("GET", r"/api/cases", lambda st, pid, m, q, b: S.list_cases(st, pid)),
    ("POST", r"/api/cases", lambda st, pid, m, q, b: S.create_case(st, pid, b.get("title"), b.get("idea"), b.get("unitId"))),
    ("GET", r"/api/cases/(?P<id>[\w-]+)", lambda st, pid, m, q, b: S.get_case(st, pid, m["id"])),
    ("POST", r"/api/cases/(?P<id>[\w-]+)/actions/(?P<action>\w+)", lambda st, pid, m, q, b: S.perform(st, pid, m["id"], m["action"], b.get("input"))),
    ("POST", r"/api/cases/(?P<id>[\w-]+)/preview", lambda st, pid, m, q, b: S.preview_form(st, pid, m["id"], b.get("form"))),
    ("GET", r"/api/similar", lambda st, pid, m, q, b: S.similar(st, pid, q.get("text", ""), q.get("exclude"))),
    ("GET", r"/api/outbox", lambda st, pid, m, q, b: S.outbox(st, pid, q.get("who"))),
    ("GET", r"/api/files/(?P<id>[\w-]+)", lambda st, pid, m, q, b: S.file_content(st, pid, m["id"])),
    ("GET", r"/api/tools", lambda st, pid, m, q, b: S.list_tools(st, pid)),
    ("POST", r"/api/tools", lambda st, pid, m, q, b: S.new_tool(st, pid)),
    ("GET", r"/api/tools/(?P<id>[\w-]+)", lambda st, pid, m, q, b: S.get_tool(st, pid, m["id"])),
    ("POST", r"/api/tools/(?P<id>[\w-]+)/actions/(?P<action>\w+)", lambda st, pid, m, q, b: S.tool_action(st, pid, m["id"], m["action"], b.get("input"))),
    ("POST", r"/api/admin/sweep", lambda st, pid, m, q, b: S.reminder_sweep(st, pid)),
    ("POST", r"/api/admin/reset", lambda st, pid, m, q, b: S.reset(st, pid)),
]
_COMPILED = [(method, re.compile(pattern + r"/?\Z"), fn) for method, pattern, fn in ROUTES]


def actor_id(headers: dict) -> str | None:
    """The person acting, from the request headers (case-insensitive)."""
    return next((v for k, v in headers.items() if k.lower() == PERSON_HEADER), None)


def dispatch(store, method: str, path: str, query: dict, body: dict | None, headers: dict) -> tuple[int, object]:
    """Handle one API request. Never raises: every failure becomes an error response."""
    for m, pattern, fn in _COMPILED:
        match = pattern.match(path)
        if match and m == method:
            try:
                return 200, fn(store, actor_id(headers), match.groupdict(), query or {}, body or {})
            except EngineError as e:
                return 400, {"error": e.message}
            except NotFound as e:
                return 404, {"error": str(e)}
            except Exception:  # a bug: log it, and do not leak details to the browser
                traceback.print_exc()
                return 500, {"error": "Something went wrong on the server. The details are in the server log."}
    return 404, {"error": "No such endpoint: " + method + " " + path}
