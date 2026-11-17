# AURA MVP

AURA is a prototype workflow for proposing, reviewing and monitoring AI use cases: a person suggests an
idea, an adviser helps develop it, triage scores the risk, a review panel (and executives for critical
cases) decide, and approved cases go through a pilot and into monitored production.

This repository is the move from the build 27 wireframe (HTML and JavaScript in one page) to:

- a **Python engine** (`engine/aura_engine`) that holds all governance logic,
- a **Python API** (`api/`) that holds the data, knows who is acting and calls the engine. It runs on a
  laptop with plain Python, or on Azure Functions,
- a **React app** (`web/`, Vite and TypeScript) for the screens.

All data in this repository is invented sample data. Default rules are placeholders, not policy.

## See the app on your laptop

You need Python 3.11 or newer and Node.js 18 or newer. The first time, from the project folder:

```bash
cd web && npm install && npm run build && cd ..   # builds the screens into web/dist
python api/dev_server.py
```

After that, `python api/dev_server.py` is enough. Restart it after any Python change, and run
`npm run build` again after any change in `web/`.

Then open http://localhost:7071. Use **Viewing as** at the top right to act as any of the 24 sample
people: Dana Whitfield (submitter), Elena Duarte (governance lead), Sam Okafor (panel), Margaret Hale
(executive) and so on. Changes are kept in `api/.data/aura.json`; switch Viewing as to Demo admin and use
**Data and demo** to reset to the sample data. Press Ctrl+C in the terminal to stop.

To load your own people and use cases, act as Demo admin and open **Data and demo**: download the CSV
templates, then use Remove sample use cases and tools, Import people, fix any gaps the Rules page reports
(business unit advisers, consult area experts), and Import use cases. People can also be added one at a
time on the **People** page. Download a backup before any of these. Real data belongs only in the deployed
app's storage, never in this repository.

While changing the screens, use the live-reloading dev server instead:

```bash
cd web
npm install       # once
npm run dev       # then open http://localhost:5173; keep api/dev_server.py running too
```

`npm run build` refreshes `web/dist`.

## Run the tests

You need Python 3.11 or newer. Node is only needed to regenerate the golden traces.

```bash
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
python -m pytest                   # about 4,600 tests, about 10 seconds
```

Try the engine on its own from a Python prompt (run from the `engine` folder):

```python
import aura_engine as E
NOW = 1793804400000                       # a fixed moment, in milliseconds since 1970
data = E.build_seed(NOW)                  # 18 sample use cases, sample AI tools, rules
case = data["cases"][0]
dana = E.by_id("p_dana")
ctx = {"rules": E.default_rules(), "now": NOW, "rv": 1, "training": data["meta"]["training"]}
[a["label"] for a in E.actions_for(case, dana, ctx)]   # what Dana can do with this case
```

## Deploy to UAT

`azure-pipelines.yml` deploys UAT from the Azure DevOps project. It runs the tests, packages the API with
the engine beside it, builds the website, and, after an approval on the `AURA-UAT` environment, deploys to
the Function App and Static Web App in the UAT resource group. It signs in through a federated service
connection and fetches the website's upload token during each run, so the repository holds no secrets.

To release: test on dev, merge to `main`, download a backup on UAT, then push `main` to the Azure Repos copy
(`git push bwc main`) and approve the run. Before the first run, set `serviceConnection` in the file to the
service connection's name. Deploys change code only; UAT's data file stays as it is.

## How we know the port is right

- `tests/equivalence`: the build 27 JavaScript engine was run on fixed inputs and every result was
  fingerprinted (4,504 checks: the sample data, every engine function on every sample case, and 90
  repeatable walks of 24 workflow steps each). The Python engine must reproduce every fingerprint.
- `tests/behavior`: the 110 behavior checks that build 27 ran in node, rewritten as readable pytest tests.

See [docs/code-guide.md](docs/code-guide.md) for a tour of the code and how to read it.
