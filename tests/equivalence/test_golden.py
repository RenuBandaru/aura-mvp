"""Proves the Python engine gives exactly the same answers as the build 27 JavaScript engine.

``golden.json`` was written by ``record.js``, which ran the frozen JavaScript engine and stored a short
fingerprint (SHA-256) of every result. This file repeats every one of those checks in Python and compares
fingerprints. A mismatch means the port differs from build 27 somewhere in that result.

There are three kinds of check (see record.js for how they were chosen):

* ``seed``: the whole sample data set built at a fixed moment.
* ``fn``:   one engine function on fixed arguments, for example ``runScoring`` on every sample case.
* ``walk``: a repeatable sequence of actions on a sample case. Each step is either a person performing an
  action (with the exact input the recorder used) or the automated reminder sweep.

To see what the JavaScript side produced for one check, run from the repository root:
    TZ=America/New_York node tests/equivalence/record.js --dump KEY
and compare it with ``python tests/equivalence/test_golden.py KEY``, which prints the Python result.
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
from functools import lru_cache
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "engine"))

import aura_engine as E  # noqa: E402  (the path must be set first)
from aura_engine import constants, controls, people, review  # noqa: E402
from aura_engine.errors import EngineError  # noqa: E402
from aura_engine.jsx import UNDEF, clone, js_json  # noqa: E402

GOLDEN = json.loads((Path(__file__).parent / "golden.json").read_text(encoding="utf-8"))
NOW = GOLDEN["now"]


# ---------------------------------------------------------------------------------------------
# Fingerprints. These must produce byte-for-byte the same text as record.js before hashing.
# ---------------------------------------------------------------------------------------------

def _sort_keys(v):
    if isinstance(v, list):
        return [_sort_keys(x) for x in v]
    if isinstance(v, dict):
        return {k: _sort_keys(v[k]) for k in sorted(v)}
    return v


def canon(v) -> str:
    """The canonical JSON text of a result: JavaScript ``JSON.stringify`` output with keys sorted."""
    plain = json.loads(js_json(None if v is UNDEF else v))
    return json.dumps(_sort_keys(plain), separators=(",", ":"), ensure_ascii=False)


def digest(v) -> str:
    return hashlib.sha256(canon(v).encode("utf-8")).hexdigest()[:24]


# ---------------------------------------------------------------------------------------------
# Shared fixtures and the argument markers used in golden.json.
# ---------------------------------------------------------------------------------------------

@lru_cache(maxsize=1)
def seed() -> dict:
    """The sample data, limited to build 27's people.

    The experts added after build 27 (``constants.ADDED_EXPERTS``) get training records too. Build 27 never
    had them, so their records are left out here; ``tests/behavior/test_added_experts.py`` covers them.
    """
    data = E.build_seed(NOW)
    for p in constants.ADDED_EXPERTS:
        data["meta"]["training"].pop(p["id"], None)
    return data


BUILD27_IDS = {p["id"] for p in constants.PEOPLE[: constants.BUILD27_PEOPLE_COUNT]}


@lru_cache(maxsize=1)
def rules() -> dict:
    return E.default_rules()


def person(pid: str) -> dict:
    """A person by id. ``system`` is the automated actor used by the reminder sweep."""
    if pid == "system":
        return constants.SYSTEM
    return next((p for p in constants.PEOPLE if p["id"] == pid), None) or constants.by_id(pid)


def ctx_at(now, training=True) -> dict:
    return {"rules": rules(), "now": now, "rv": 1, "training": seed()["meta"]["training"] if training else UNDEF}


def case(case_id: str) -> dict:
    return clone(next(c for c in seed()["cases"] if c["id"] == case_id))


def resolve(a):
    """Turns the markers in a check's arguments into real objects, always fresh copies."""
    if isinstance(a, list):
        return [resolve(x) for x in a]
    if isinstance(a, dict):
        if "$case" in a:
            return case(a["$case"])
        if "$rules" in a:
            return clone(rules())
        if "$person" in a:
            return person(a["$person"])
        if "$cases" in a:
            return clone(seed()["cases"])
        if "$tools" in a:
            return clone(seed()["tools"])
        if "$training" in a:
            return clone(seed()["meta"]["training"])
        if "$undefined" in a:
            return UNDEF
        if "$ctx" in a:
            return ctx_at(a["$ctx"]["now"], a["$ctx"].get("training") is not False)
        return {k: resolve(v) for k, v in a.items()}
    return a


def py_name(js_name: str) -> str:
    """``revQuorumWaivable`` -> ``rev_quorum_waivable``: the naming rule used across the port."""
    return re.sub(r"(?<!^)([A-Z])", r"_\1", js_name).lower()


def engine_fn(js_name: str):
    name = py_name(js_name)
    for mod in (E, controls, people, review):
        if hasattr(mod, name):
            return getattr(mod, name)
    raise AttributeError("No Python port of " + js_name + " (looked for " + name + ")")


def run_fn_check(ch: dict) -> dict:
    """Runs one ``fn`` check. Returns ``{"ok": value}`` or ``{"error": message}`` like record.js."""
    if ch["fn"] == "waitingOn":
        cases, ctx = resolve(ch["args"][0]), resolve(ch["args"][1])
        return {"ok": [[p["id"] for p in E.waiting_on(c, ctx) if p["id"] in BUILD27_IDS] for c in cases]}
    try:
        return {"ok": engine_fn(ch["fn"])(*resolve(ch["args"]))}
    except EngineError as e:
        return {"error": e.message}


def replay(ch: dict, upto: int | None = None):
    """Replays a walk, yielding ``(index, step, outcome)`` where outcome is a digest or an error."""
    c = case(ch["caseId"])
    for i, st in enumerate(ch["steps"]):
        if upto is not None and i > upto:
            return
        ctx = ctx_at(st["now"])
        if st.get("sweep"):
            r = E.remind_case(c, ctx, constants.SYSTEM)
            yield i, st, {"digest": digest(r)}, c if not r else r
            if r:
                c = r
            continue
        try:
            r = E.perform(c, st["aid"], st["input"], person(st["pid"]), ctx)
            out = {"digest": digest(r)}
            c = r
        except EngineError as e:
            out = {"error": e.message}
        yield i, st, out, c


# ---------------------------------------------------------------------------------------------
# The tests. One pytest test per golden check, so a failure names the exact check.
# ---------------------------------------------------------------------------------------------

CHECKS = GOLDEN["checks"]
FN = [c for c in CHECKS if c["kind"] == "fn"]
WALKS = [c for c in CHECKS if c["kind"] == "walk"]


def test_seed_matches_build_27():
    assert digest(seed()) == next(c for c in CHECKS if c["kind"] == "seed")["digest"]


@pytest.mark.parametrize("ch", FN, ids=[c["key"] for c in FN])
def test_function_matches_build_27(ch):
    got = run_fn_check(ch)
    if "error" in ch:
        assert got.get("error") == ch["error"]
    else:
        assert "error" not in got, got.get("error")
        assert digest(got["ok"]) == ch["digest"]


@pytest.mark.parametrize("ch", WALKS, ids=[c["key"] for c in WALKS])
def test_walk_matches_build_27(ch):
    for i, st, out, _ in replay(ch):
        want = {"error": st["error"]} if "error" in st else {"digest": st["digest"]}
        assert out == want, f"step {i}: {st.get('pid')} {st.get('aid', 'sweep')}"


# ---------------------------------------------------------------------------------------------
# Debug helper: print the Python result for one check, to diff against record.js --dump.
# ---------------------------------------------------------------------------------------------

if __name__ == "__main__":
    key = sys.argv[1]
    if key == "seed":
        out = seed()
    elif key.startswith("walk:"):
        _, cid, w, upto = key.split(":")
        ch = next(c for c in WALKS if c["key"] == f"walk:{cid}:{w}")
        out = None
        for *_, c in replay(ch, int(upto)):
            out = c
    else:
        out = run_fn_check(next(c for c in FN if c["key"] == key))
    print(json.dumps(json.loads(js_json(out)), indent=1, ensure_ascii=False))
