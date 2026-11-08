# AURA MVP

AURA is a prototype workflow for proposing, reviewing and monitoring AI use cases: a person suggests an
idea, an adviser helps develop it, triage scores the risk, a review panel (and executives for critical
cases) decide, and approved cases go through a pilot and into monitored production.

This repository is the move from the build 27 wireframe (HTML and JavaScript in one page) to:

- a **Python engine** (`engine/aura_engine`) that holds all governance logic, **done in this step**,
- a **Python API** on Azure Functions that loads and saves data and calls the engine, **next**,
- a **React app** (Vite, TypeScript, Microsoft sign-in) for the screens, **after the API**.

All data in this repository is invented sample data. Default rules are placeholders, not policy.

## Quick start

You need Python 3.11 or newer. Node is only needed to regenerate the golden traces.

```bash
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
python -m pytest                   # about 4,600 tests, under 10 seconds
```

Try the engine from a Python prompt (run from the `engine` folder):

```python
import aura_engine as E
NOW = 1793804400000                       # a fixed moment, in milliseconds since 1970
data = E.build_seed(NOW)                  # 18 sample use cases, sample AI tools, rules
case = data["cases"][0]
dana = E.by_id("p_dana")
ctx = {"rules": E.default_rules(), "now": NOW, "rv": 1, "training": data["meta"]["training"]}
[a["label"] for a in E.actions_for(case, dana, ctx)]   # what Dana can do with this case
```

## How we know the port is right

- `tests/equivalence`: the build 27 JavaScript engine was run on fixed inputs and every result was
  fingerprinted (4,504 checks: the sample data, every engine function on every sample case, and 90
  repeatable walks of 24 workflow steps each). The Python engine must reproduce every fingerprint.
- `tests/behavior`: the 110 behavior checks that build 27 ran in node, rewritten as readable pytest tests.

See [docs/code-guide.md](docs/code-guide.md) for a tour of the code and how to read it.
