"""Opt-in scenario data: the usual sample data plus extra cases described in a JSON file.

The default sample data (:func:`aura_engine.seed.build_seed`) stays exactly as it is. A scenario file adds
cases for a test session, such as user acceptance testing, without changing it. Each extra case is built
the same way as the sample cases: by having people take the real actions (develop, submit, vet, consult,
respond, vote...) through :func:`aura_engine.perform.perform`. So every scenario case is internally
consistent, has a real audit trail, and fails loudly if a step is not allowed.

A scenario file is JSON::

    {
      "label": "Short name, kept in meta",
      "rules": {"consultAreas": [ ...areas to add or replace, same shape as the default rules... ]},
      "cases": [
        {
          "id": "EX-01", "title": "...", "idea": "...", "submitter": "p_dana", "daysAgo": 10,
          "form": {"yes": ["q_hall"], "answers": {"q_svc": "co"}, "scope": "team", "autonomy": "advice", ...},
          "steps": [
            {"do": "develop", "by": "p_jordan", "daysAgo": 9},
            {"do": "submit", "by": "p_dana", "daysAgo": 8},
            {"do": "vet_to_panel", "by": "p_elena", "daysAgo": 7, "input": {"note": "..."}},
            {"do": "consult", "daysAgo": 6, "smes": ["ca_ai"], "hold": ["ca_ai"], "question": "...",
             "questions": {"ca_ai": "a question for this area only"}},
            {"do": "respond", "by": "p_mina", "daysAgo": 5, "stance": "concerns", "text": "..."}
          ]
        }
      ]
    }

``form`` takes the keyword arguments of the sample builder's ``mk_form`` (solution, problem, scope,
autonomy, controls, owner, ...), plus ``yes`` (yes/no questions answered yes), ``answers`` (any other
answers, such as picklists or "unknown") and ``ready`` (data readiness checks met; all when left out).
A ``submit`` step with no ``input`` submits that form. Everything in a scenario file in this repository
must be invented sample data; real names and records belong in the organization's own environment.
"""

from __future__ import annotations

import json
from pathlib import Path

from .constants import DAY, by_id
from .errors import EngineError
from .forms import new_case
from .jsx import clone, js_json
from .people import assign_adviser
from .seed import _Builder, build_seed

STEP_KEYS = {"do", "by", "daysAgo", "input", "smes", "hold", "stakeholders", "question", "questions", "stance", "text"}
CASE_KEYS = {"id", "title", "idea", "submitter", "daysAgo", "legacy", "form", "steps", "note"}
FORM_EXTRA = {"yes", "answers", "ready"}
SCENARIO_RULES_VERSION = 2


class ScenarioError(ValueError):
    """A scenario file that cannot be built. The message names the case and step."""


def load_scenarios(path: str | Path) -> dict:
    """Read a scenario file. Raises :class:`ScenarioError` if it is not a JSON object with cases."""
    try:
        spec = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        raise ScenarioError("Cannot read scenario file " + str(path) + ": " + str(e)) from e
    if not isinstance(spec, dict) or not isinstance(spec.get("cases"), list):
        raise ScenarioError("A scenario file must be a JSON object with a list of cases.")
    return spec


def _merged_areas(current: list[dict], added: list[dict]) -> list[dict]:
    """The consult areas with ``added`` appended, or replacing an area with the same id."""
    out = clone(current)
    for a in added:
        if not a.get("id") or not a.get("label") or by_id(a.get("personId"))["role"] == "unknown":
            raise ScenarioError("Consult area " + str(a.get("id")) + " needs an id, a label and a known personId.")
        i = next((n for n, x in enumerate(out) if x["id"] == a["id"]), None)
        if i is None:
            out.append(clone(a))
        else:
            out[i] = clone(a)
    return out


class _ScenarioBuilder(_Builder):
    """The sample builder, with the scenario's rules and rules version."""

    def __init__(self, now: int, rules: dict, tools: list[dict], rv: int):
        super().__init__(now)
        self.R = rules
        self.tools = tools
        self.rv = rv

    def ctx(self, days_ago) -> dict:
        return {"rules": self.R, "now": self.T(days_ago), "rv": self.rv}

    def start_as(self, case_id: str, title: str, idea: str, sub: str, days_ago, legacy: bool) -> dict:
        h = {"c": new_case(case_id, title, idea, sub, self.T(days_ago), self.rv)}
        if legacy:
            h["c"]["legacy"] = True
        assign_adviser(h["c"], self.R)
        self.cases.append(h)
        return h

    def scenario_form(self, form: dict) -> dict:
        o = {k: clone(v) for k, v in form.items() if k not in FORM_EXTRA}
        answers = self.yes(*form.get("yes", []))
        answers.update(form.get("answers") or {})
        o["answers"] = answers
        o["readiness"] = self.ready(*form["ready"]) if "ready" in form else self.ready()
        return self.mk_form(**o)


def _run_step(b: _ScenarioBuilder, h: dict, form: dict, st: dict) -> None:
    unknown = set(st) - STEP_KEYS
    if unknown:
        raise ScenarioError("unknown step keys " + ", ".join(sorted(unknown)))
    act, days = st.get("do"), st.get("daysAgo", 0)
    if act == "consult":
        inp = {"smes": st.get("smes", []), "stakeholders": st.get("stakeholders", []), "question": st.get("question", "")}
        if "hold" in st:
            inp["reqSmes"] = st["hold"]
        if "questions" in st:  # a separate question for each area or person: {"ca_ai": "...", "ca_cs": "..."}
            inp["questions"] = st["questions"]
        b.step(h, days, st.get("by", "p_elena"), "consult", inp)
    elif act == "respond":
        b.reply(h, days, st["by"], st.get("stance", "support"), st.get("text", ""))
    elif act in ("submit", "save_draft") and "input" not in st:
        b.step(h, days, st["by"], act, {"form": b.scenario_form(form)})
    else:
        b.step(h, days, st["by"], act, clone(st.get("input") or {}))


def _build_case(b: _ScenarioBuilder, cs: dict, used: set) -> None:
    unknown = set(cs) - CASE_KEYS
    if unknown:
        raise ScenarioError(str(cs.get("id")) + ": unknown keys " + ", ".join(sorted(unknown)))
    cid = cs.get("id")
    if not cid or cid in used:
        raise ScenarioError("Each scenario case needs a unique id; " + repr(cid) + " is missing or used twice.")
    used.add(cid)
    h = b.start_as(cid, cs["title"], cs.get("idea", ""), cs["submitter"], cs.get("daysAgo", 0), bool(cs.get("legacy", False)))
    for n, st in enumerate(cs.get("steps") or [], 1):
        try:
            _run_step(b, h, cs.get("form") or {}, st)
        except (EngineError, KeyError, TypeError, ScenarioError) as e:
            msg = getattr(e, "message", None) or str(e)
            raise ScenarioError(cid + " step " + str(n) + " (" + str(st.get("do")) + "): " + msg) from e


def build_scenario_seed(now: int, spec: dict) -> dict:
    """The default sample data plus the cases in ``spec``, built at time ``now``.

    The scenario's consult areas are saved as rules version 2, so the Rules page shows what was added.
    """
    base = build_seed(now)
    added = (spec.get("rules") or {}).get("consultAreas") or []
    rules = {**clone(base["rules"]), "consultAreas": _merged_areas(base["rules"].get("consultAreas") or [], added)}
    b = _ScenarioBuilder(now, rules, clone(base["tools"]), SCENARIO_RULES_VERSION)
    used = {c["id"] for c in base["cases"]}
    for cs in spec["cases"]:
        _build_case(b, cs, used)
    version = {"n": SCENARIO_RULES_VERSION, "at": now - DAY, "by": "system",
               "reason": "Scenario data: " + str(spec.get("label") or "extra cases"),
               "summary": ["Consult areas added for the scenario data."], "json": js_json(rules)}
    return {**base, "cases": base["cases"] + [h["c"] for h in b.cases], "tools": b.tools, "rules": rules,
            "versions": base["versions"] + [version],
            "meta": {**base["meta"], "scenario": {"label": spec.get("label") or "", "cases": [h["c"]["id"] for h in b.cases]}}}
