"""Shared helpers for the behavior tests, ported from the build 27 node checks.

The build 27 checks (engine/reference/checks/t*.js) all started with the same few helpers. They are
reproduced here with the same names in Python style, so a Python test reads almost line for line like
the JavaScript one it replaces:

* ``get(id)``             a fresh copy of a sample use case,
* ``acts(c, pid)``        the actions a person has on a case,
* ``names(c, pid)``       those action ids as one comma separated string (``"(off)"`` marks disabled ones),
* ``run(c, pid, aid)``    find the action, fill its fields with test values and perform it,
* ``vote(c, pid, dec)``   record a review decision,
* ``fresh(id)``           a panel case with consults, notes, votes and the review draft cleared,
* ``throws(f, pattern)``  assert that ``f`` raises an :class:`EngineError` whose message matches,
* ``mails_to(c, n0, pid)`` emails added since index ``n0`` that are addressed to a person.

Every test uses the same fixed moment (``NOW``) as the golden traces, so results never depend on the
day the tests are run.
"""

from __future__ import annotations

import re

import pytest

import aura_engine as E
from aura_engine.constants import PEOPLE, by_id
from aura_engine.errors import EngineError
from aura_engine.jsx import clone, js_or, truthy

NOW = 1793804400000  # Sunday 8 November 2026, 10:00 in New York
DAY = 86400000
R = E.default_rules()
SEED = E.build_seed(NOW)
TRAINING = SEED["meta"]["training"]


def ctx(training: bool = False, now: int = NOW) -> dict:
    """The context the engine needs. Some build 27 check files passed the training records, some did not."""
    out = {"rules": R, "now": now, "rv": 1}
    if training:
        out["training"] = TRAINING
    return out


def person(pid: str) -> dict:
    return next((p for p in PEOPLE if p["id"] == pid), None) or by_id(pid)


def get(case_id: str) -> dict:
    return clone(next(c for c in SEED["cases"] if c["id"] == case_id))


def fill(a: dict, extra: dict | None = None) -> dict:
    """Plausible values for every field of an action, then ``extra`` on top. Same rules as build 27's ``fill``."""
    inp = {}
    for f in a.get("fields") or []:
        t, name, value = f.get("type"), f.get("name"), f.get("value")
        if t == "overrides":
            for th in f.get("threads") or []:
                inp["ov_" + th["slug"]] = "accepted for test"
                inp["ovc_" + th["slug"]] = True
        elif t == "measures":
            inp[name] = value
        elif t == "checks":
            inp[name] = value if truthy(value) and len(value) else [o["v"] for o in (f.get("options") or [])[:2]]
        elif t == "select":
            first = next((o for o in f.get("options") or [] if truthy(o.get("v"))), {})
            inp[name] = js_or(value, first.get("v"))
        elif t == "number":
            inp[name] = value if value is not None and value != "" else 5
        elif t in ("support", "panelnotes", "hidden", "note") or not name:
            continue
        else:
            inp[name] = js_or(value, "test text")
    inp.update(extra or {})
    return inp


class Helpers:
    """The helpers bound to one context (with or without training records)."""

    def __init__(self, training: bool = False):
        self.cx = ctx(training)

    def acts(self, c, pid):
        return E.actions_for(c, person(pid), self.cx)

    def has(self, c, pid, aid) -> bool:
        return any(a["id"] == aid for a in self.acts(c, pid))

    def action(self, c, pid, aid):
        return next((a for a in self.acts(c, pid) if a["id"] == aid), None)

    def names(self, c, pid) -> str:
        return ", ".join(a["id"] + ("(off)" if truthy(a.get("disabled")) else "") for a in self.acts(c, pid))

    def perform(self, c, aid, inp, pid):
        return E.perform(c, aid, inp, person(pid), self.cx)

    def run(self, c, pid, aid, extra=None):
        a = self.action(c, pid, aid)
        if not a:
            pytest.fail("no action " + aid + " for " + pid + " have " + self.names(c, pid))
        return E.perform(c, aid, fill(a, extra), person(pid), self.cx)

    def vote(self, c, pid, dec, strength=None, text=None, extra=None):
        inp = {"decision": dec, "strength": js_or(strength, "firm"), "text": js_or(text, "my note")}
        inp.update(extra or {})
        return self.run(c, pid, "rv_vote", inp)

    def fresh(self, case_id="UC-1012"):
        c = get(case_id)
        c["consults"] = []
        c["panelNotes"] = []
        c.pop("votes", None)
        c["reviewDraft"] = None
        return c


def throws(f, pattern: str | None = None, flags=0) -> str:
    """Assert ``f()`` raises an EngineError (matching ``pattern`` if given) and return its message."""
    with pytest.raises(EngineError) as e:
        f()
    if pattern:
        assert re.search(pattern, e.value.message, flags), "wrong error: " + e.value.message
    return e.value.message


def mails_to(c, n0, pid):
    return [m for m in c["outbox"][n0:] if pid in m["to"]]


def mail_text(m) -> str:
    """An email's body plus its structured extra part (``x``), as build 27's checks searched them."""
    x = m.get("x")
    return m["body"] + (x if isinstance(x, str) else "")
