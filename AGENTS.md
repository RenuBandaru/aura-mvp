# AURA MVP: rules for working in this repository

AURA is a Penn State capstone prototype of an AI use case governance workflow, built for Bradford White.
This repository moves the build 27 wireframe (HTML and JavaScript) to a React frontend and a Python backend.

## Standing rules

1. **Sample data only.** Never add real Bradford White data, names, systems or documents. Everything in
   `engine/aura_engine/seed.py` and the default rules is invented for the demo.
2. **Defaults are placeholders, not policy.** Tiers, quorums, review days, questions and controls are
   starting values for the demo. Never describe them as Bradford White policy.
3. **US spelling** in code, comments, UI text and docs.
4. **Project palette** for any UI: navy `#004677`, yellow `#ffc20e`, light blue-grey `#b2c7d6`, grey `#aaaaaa`.
5. **Keep the engine separate from the UI.** `engine/aura_engine` is pure logic: no database, no network,
   no clock, no web framework. The API layer loads and saves data and calls the engine; the React app
   only talks to the API.
6. **Run the tests after every change**, and commit tests together with the code they cover:
   `python -m pytest` from the repository root.
7. **No governance rules in React.** If a screen needs to decide something (who can act, what is
   missing), the engine or `api/aura_api/views.py` decides and the screen shows the answer.
8. **The outbox is simulated.** Emails are recorded on the case (`outbox`) and never sent.
9. **Check behavior in code before describing it.** Read the engine and run the tests rather than
   relying on memory or older documents.

## The engine port

- `engine/reference/` holds the frozen build 27 `engine.js` and `seed.js` and the original node checks.
  **Never edit these files.** They are the specification the Python port is tested against.
- The Python engine must give exactly the same results as build 27: the same audit hashes, email text and
  error messages. `tests/equivalence/test_golden.py` proves this against `tests/equivalence/golden.json`.
- An intended change in behavior (a new backlog item, a bug fix) is made in Python only, and the golden
  checks it affects are then updated on purpose, with the reason in the commit message. Do not regenerate
  `golden.json` to make a failing test pass without understanding why it failed.
- JavaScript behaviors the engine depends on (truthiness, `||`, number formatting, JSON text, dates in
  New York time) are copied by the helpers in `engine/aura_engine/jsx.py`. Use them instead of plain
  Python when a value ends up in an email, an audit entry or a hash.
- Data stays as plain dictionaries with the original camelCase keys (`submitterId`, `panelNotes`), so the
  API can send them to React unchanged. Python function names are snake_case; each docstring names the
  JavaScript function it replaces.

## Layout

| Path | What it is |
| --- | --- |
| `engine/aura_engine/` | The governance engine (Python package) |
| `engine/reference/` | Frozen build 27 JavaScript, for comparison only |
| `tests/equivalence/` | Golden traces from build 27 and the test that replays them |
| `tests/behavior/` | The 110 build 27 behavior checks, ported to pytest |
| `docs/code-guide.md` | How the code is organized and how to read it |
| `api/` | The API: data store, views for screens, routes; runs with `dev_server.py` or Azure Functions |
| `web/` | The React app (Vite, TypeScript). Screens only: every rule comes from the API |
| `tests/api/` | API tests through the same dispatch both hosts use |
