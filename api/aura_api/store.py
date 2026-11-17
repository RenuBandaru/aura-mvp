"""Where AURA's data lives while the app runs.

The whole data set is one dictionary, the same shape build 27 kept in the browser::

    {"cases": [...], "tools": [...], "files": [...], "rules": {...}, "versions": [...], "meta": {...}, "people": [...]}

``people`` is the list behind "Viewing as". It starts as the invented sample people; the demo admin can
edit it or import a CSV on the deployed site, so real names live only in the deployed data file.

:class:`Store` holds it in memory, guarded by a lock so two requests cannot change it at once, and can
save it to a JSON file so data survives a restart. The Azure version will keep the same methods and
store each case as a database row instead; nothing outside this module needs to change.
"""

from __future__ import annotations

import json
import os
import threading
import time
from pathlib import Path

import aura_engine as E


def clock_ms() -> int:
    """The current time in milliseconds, or a fixed time from ``AURA_FIXED_NOW`` (used by the tests)."""
    fixed = os.environ.get("AURA_FIXED_NOW")
    return int(fixed) if fixed else int(time.time() * 1000)


class Store:
    """The app's data, with simple load, save and reset."""

    def __init__(self, path: str | os.PathLike | None = None):
        self.path = Path(path) if path else None
        self.lock = threading.RLock()
        self.data: dict = {}
        if self.path and self.path.exists():
            self.data = json.loads(self.path.read_text(encoding="utf-8"))
            self.data.setdefault("people", E.sample_people())  # files saved before people were editable
            self.activate()
        else:
            self.reset()

    # ---- whole data set ----

    def reset(self) -> None:
        """Start again from the sample data, built at the current time so due dates look natural."""
        with self.lock:
            people = E.sample_people()
            E.use_people(people)  # the seed is built from the sample people
            self.data = E.build_seed(clock_ms())
            self.data["people"] = people
            self.save()

    def activate(self) -> None:
        """Point the engine at this store's people. Called before every request."""
        E.use_people(self.people)

    def replace_all(self, data: dict) -> None:
        """Swap in a whole data set (a restored backup) and save it."""
        with self.lock:
            self.data = data
            self.activate()
            self.save()

    def now(self) -> int:
        """The demo's current time: the real (or fixed) clock plus the demo clock offset set on the Data and demo page."""
        return clock_ms() + int((self.data.get("meta") or {}).get("clockOffsetMs") or 0)

    def log_admin(self, pid: str, what: str, prev: list | None = None) -> None:
        """Note a reset, import or restore in meta.adminLog (the last 30), shown on the Data and demo page."""
        log = list(self.data["meta"].get("adminLog") or []) if prev is None else list(prev)
        self.data["meta"]["adminLog"] = (log + [{"at": self.now(), "by": pid, "what": what}])[-30:]

    def save(self) -> None:
        if not self.path:
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(E.js_json(self.data), encoding="utf-8")
        tmp.replace(self.path)  # replace in one step, so a crash never leaves a half-written file

    @property
    def rules(self) -> dict:
        return self.data["rules"]

    def ctx(self, now: int | None = None) -> dict:
        """The context the engine needs for every call."""
        return {"rules": self.rules, "now": self.now() if now is None else now, "rv": self.rules_version(),
                "training": self.data["meta"].get("training")}

    def rules_version(self) -> int:
        return max([v["n"] for v in self.data.get("versions") or []] or [1])

    # ---- people ----

    @property
    def people(self) -> list[dict]:
        return self.data["people"]

    def person(self, pid: str) -> dict | None:
        return next((p for p in self.people if p["id"] == pid), None)

    # ---- use cases ----

    @property
    def cases(self) -> list[dict]:
        return self.data["cases"]

    def case(self, case_id: str) -> dict | None:
        return next((c for c in self.cases if c["id"] == case_id), None)

    def put_case(self, c: dict) -> None:
        """Insert or replace a case by id."""
        for i, old in enumerate(self.cases):
            if old["id"] == c["id"]:
                self.cases[i] = c
                return
        self.cases.append(c)

    def next_case_id(self) -> str:
        """``UC-`` and one more than the highest number used. JavaScript ``nextId`` in ui.js."""
        nums = [int(c["id"][3:]) for c in self.cases if c["id"][3:].isdigit()]
        return "UC-" + str(max([1000] + nums) + 1)

    # ---- AI tools and uploaded files ----

    @property
    def tools(self) -> list[dict]:
        return self.data["tools"]

    def tool(self, tool_id: str) -> dict | None:
        return next((t for t in self.tools if t["id"] == tool_id), None)

    def put_tool(self, t: dict) -> None:
        for i, old in enumerate(self.tools):
            if old["id"] == t["id"]:
                self.tools[i] = t
                return
        self.tools.append(t)

    def drop_tool(self, tool_id: str) -> None:
        self.data["tools"] = [t for t in self.tools if t["id"] != tool_id]

    def add_file(self, f: dict) -> None:
        self.data.setdefault("files", []).append(f)

    def file(self, file_id: str) -> dict | None:
        return next((f for f in self.data.get("files") or [] if f["id"] == file_id), None)
