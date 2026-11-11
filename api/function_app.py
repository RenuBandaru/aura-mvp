"""AURA API on Azure Functions (Python v2 programming model).

One HTTP function catches every ``/api/...`` path and hands it to :func:`aura_api.routes.dispatch`,
the same code the laptop dev server runs. Deploying therefore changes the host, not the behavior.

Before this goes to the BWC sandbox, two things change (see docs/code-guide.md, "What comes next"):

* **Data:** ``Store`` here keeps data in memory per running instance, which is fine for a demo but is
  lost when Azure restarts the app. It will be replaced by a store backed by Azure SQL or Table storage.
* **Sign-in:** the person acting comes from the ``X-Aura-Person`` header. Behind Microsoft Entra ID the
  signed-in user arrives in the ``X-MS-CLIENT-PRINCIPAL`` header and is mapped to a person instead.

Run locally with Azure Functions Core Tools: ``cd api && func start`` (needs ``local.settings.json``,
copy it from ``local.settings.sample.json``).
"""

import json
import os
import sys
from pathlib import Path

import azure.functions as func

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE.parent / "engine"), str(HERE)]  # the engine sits beside the API in this repository

from aura_api.routes import dispatch  # noqa: E402
from aura_api.store import Store  # noqa: E402
from aura_engine.jsx import js_json  # noqa: E402

store = Store(os.environ.get("AURA_DATA_FILE") or None, scenario_file=os.environ.get("AURA_SCENARIO_FILE") or None)
app = func.FunctionApp(http_auth_level=func.AuthLevel.ANONYMOUS)


@app.route(route="{*path}", methods=["GET", "POST"])
def api(req: func.HttpRequest) -> func.HttpResponse:
    """Every API request. Azure strips nothing: ``req.url`` still contains ``/api/...``."""
    path = "/" + req.url.split("://", 1)[-1].split("/", 1)[-1].split("?", 1)[0]
    body = None
    if req.method == "POST":
        try:
            body = req.get_json()
        except ValueError:
            return func.HttpResponse('{"error":"The request body is not valid JSON."}', status_code=400, mimetype="application/json")
    status, out = dispatch(store, req.method, path, dict(req.params), body, dict(req.headers))
    return func.HttpResponse(js_json(out), status_code=status, mimetype="application/json", charset="utf-8")
