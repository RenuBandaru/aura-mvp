# AURA code guide

This guide explains how the Python engine is organized, how one action flows through it, and what you
need to know to read, run and change it. It assumes you know the AURA workflow from the wireframe, and
some basic Python.

## 1. The big picture

```
React app (web/, next)  --HTTP-->  API (api/, next)  --function calls-->  engine (engine/aura_engine)
   screens, forms                    sign-in, load/save data                 all governance logic
```

The engine is a library of **pure functions**: give it plain data, get plain data back. It never reads a
database, the network or the clock. That is why it is easy to test, and why the API and React layers can
change without touching governance logic. It is the same split build 27 had between `engine.js` and `ui.js`.

Everything the engine works on is a dictionary:

| Thing | Shape (the main keys) |
| --- | --- |
| Use case ("case") | `id`, `title`, `stage`, `tier`, `form` (all the answers), `submitterId`, `adviserId`, `consults`, `votes`, `attestations`, `audit`, `outbox` |
| Person | `id`, `name`, `role`, `unit` (the 24 sample people are in `constants.PEOPLE`) |
| Rules | questions, scoring and guardrail rules, controls, tiers, quorums, review days (`rules.default_rules()`) |
| Context (`ctx`) | `rules`, `now` (milliseconds since 1970), `rv` (rules version), `training` (who finished training) |

Keys keep their JavaScript camelCase names (`submitterId`, `panelNotes`) so the API can hand them to React
unchanged. Python names (functions, variables) are snake_case.

## 2. The two functions everything goes through

1. **`actions_for(case, person, ctx)`** (`actions.py`) answers "what can this person do with this case
   right now?" It returns a list of actions. Each has an `id` (such as `submit`), a `label` for the button,
   and `fields` describing the form the UI should show. The React app will draw its buttons and dialogs
   from this list, so the rules about who may do what live in exactly one place.
2. **`perform(case, action_id, inputs, person, ctx)`** (`perform.py`) carries an action out and returns
   the **new** case. The case passed in is never changed.

### One action, step by step

Dana asks her adviser for help on sample case UC-1008:

```python
import aura_engine as E
NOW = 1793804400000
data = E.build_seed(NOW)
case = next(c for c in data["cases"] if c["id"] == "UC-1008")
dana = E.by_id("p_dana")
ctx = {"rules": E.default_rules(), "now": NOW, "rv": 1, "training": data["meta"]["training"]}

new = E.perform(case, "ask_adviser", {"message": "Where do I start?"}, dana, ctx)
new["audit"][-1]["action"]     # 'Help requested'
new["outbox"][-1]["subject"]   # 'Help requested: Supplier negotiation assistant', to Jordan Ellis
E.verify_audit(new)            # {'ok': True, 'entries': 5}
```

Inside `perform`:

1. **Is it allowed?** It calls `actions_for` and looks for `ask_adviser`. If the person does not have
   it, it raises `EngineError("This action is not available to ... right now.")`.
2. **Are required fields filled?** Each field marked `required` must have a value, otherwise
   `"<label> is required."`.
3. **Apply it.** A `_Run` object is made with a copy of the case. `_Run.apply()` calls the method named
   after the action, here `do_ask_adviser`. Methods such as `log()` (add an audit entry) and `mail()`
   (add an email to the outbox) are shared by all actions.
4. **Follow-ups.** `_Run.follow_ups()` does what every action needs afterwards, such as telling reviewers
   when nothing is holding a decision any more.
5. **Seal the audit trail.** `seal_audit` (`audit.py`) gives every new audit entry a SHA-256 hash that
   includes the previous entry's hash. Changing any old entry breaks the chain, which `verify_audit` detects.

Errors meant for people are always `EngineError`, and `error.message` is the text to show. The API will
turn them into a 400 response with that message.

## 3. The modules, in reading order

Start at the top; each module only uses the ones above it.

| Module | What it does |
| --- | --- |
| `jsx.py` | Small helpers that copy JavaScript behavior exactly (see section 5). Read this first. |
| `errors.py` | `EngineError`, the one error type for messages shown to people. |
| `constants.py` | Stages, tiers, the 24 sample people, role names, answer options. `by_id` looks people up. |
| `rules.py` | The default rules, migrating older saved rules (`norm_rules`), tier from score. |
| `matching.py` | Does a rule's condition match a form's answers? Which controls a form needs. Readiness gaps. |
| `people.py` | Owner and adviser, training records, conflict of duty (`duty_block`), the AI tool catalog matcher. |
| `audit.py` | The hash chain on the audit trail. |
| `forms.py` | The blank form, new cases, what changed between two versions of a form, budget and ROI. |
| `controls.py` | Control evidence and confirmation status, "loose threads" (open items to accept), KPIs and stop limits. |
| `triage.py` | Guardrails (`run_triage`), risk scoring (`run_scoring`), review time estimates, rescoring. |
| `consults.py` | Which experts and stakeholders a case should consult, and second looks after a return. |
| `review.py` | Panel and executive voting: quorum, readiness, deadlocks, approval terms, reminders. |
| `actions.py` | `actions_for`: the full list of actions per stage and role. |
| `perform.py` | `perform`: carrying out each action. The biggest module; one `do_<action>` method per action. |
| `tools.py` | The AI tool catalog (report a tool, change its status). |
| `rules_editor.py` | Checking and comparing edited rules, "where is this question used", what-if scoring. |
| `derived.py` | Read-only views: who a case is waiting on, the exceptions report, CSV export. |
| `seed.py` | The 18 sample use cases, sample tools, evidence file and training records. |

Every function's docstring names the build 27 JavaScript function it replaces, for example
`"""... JavaScript ``revDeadlock``."""`. To understand a function, read the two side by side:
`engine/reference/engine.js` is the original.

## 4. The tests

```bash
python -m pytest                                # everything
python -m pytest tests/behavior                 # the 110 readable behavior tests
python -m pytest tests/behavior -k deadlock     # only tests with "deadlock" in the name
python -m pytest tests/equivalence -x           # golden checks, stop at the first failure
```

**Behavior tests** (`tests/behavior`) are the place to learn the workflow rules. Each test is a short
story, for example `test_high_tier_needs_three_firm_approvals`: take a sample case, have reviewers vote,
check that finalizing becomes possible only at the third firm approval. `helpers.py` explains the small
helpers they share (`get`, `run`, `vote`, `fresh`, `throws`).

**Golden tests** (`tests/equivalence`) prove the port matches build 27. `record.js` ran the JavaScript
engine on fixed inputs and saved a fingerprint of each result in `golden.json`; `test_golden.py` repeats
each one in Python. A failure names the check, for example `walk:UC-1012:4` step 7. To see the difference:

```bash
TZ=America/New_York node tests/equivalence/record.js --dump walk:UC-1012:4:7 > js.json
python tests/equivalence/test_golden.py walk:UC-1012:4:7 > py.json
diff js.json py.json
```

When behavior is changed on purpose, the golden checks it touches will fail. That is expected. Never edit
the JavaScript reference to make them pass. Instead note in the commit which checks changed and why.

## 5. Why `jsx.py` exists

Build 27 is JavaScript, and a few JavaScript habits leak into results that people see or that are hashed:

| JavaScript | Python by default | Helper |
| --- | --- | --- |
| `[]` and `{}` count as true in `if (x)` | empty list and dict count as false | `truthy(x)` |
| `a \|\| b` returns `a` unless it is falsy | `a or b`, but with Python's falsiness | `js_or(a, b)` |
| `String(5.0)` is `"5"`, `String(null)` is `"null"` | `str(5.0)` is `"5.0"` | `js_str(v)` |
| `Math.round(2.5)` is 3 | `round(2.5)` is 2 | `js_round(x)` |
| `(12345).toLocaleString()` is `"12,345"` | | `to_locale(n)` |
| `JSON.stringify` (compact, drops `undefined`) | `json.dumps` spacing differs | `js_json(v)` |
| a missing key reads as `undefined` | `None` | the `UNDEF` marker |
| `new Date(t).toDateString()` in New York time | | `date_string(t)` |

Plain Python is fine for internal logic. Use the helpers wherever a value ends up in an email, an audit
note, an error message or a hash, because those must match build 27 character for character.

## 6. What to learn, and in what order

1. **Python dictionaries and lists**, including comprehensions (`[k["id"] for k in c["consults"]]`) and
   `dict.get(key, default)`. Almost every line of the engine is reading or building dictionaries.
2. **Modules and imports**: how `from .review import rev_ready` finds a function in the same package,
   and what `__init__.py` exports.
3. **pytest**: a test is any function named `test_...` that uses `assert`. Run one file, use `-k` to
   filter, read a failure report. Then read `tests/behavior/test_panel_voting.py` alongside the review
   screens of the wireframe.
4. **The action flow** in section 2: read `actions_for` for one stage (for example the panel branch in
   `actions.py`), then the matching `do_` methods in `perform.py`.
5. **The audit chain**: `audit.py` is short and shows how hashing makes the trail tamper evident.
6. **`jsx.py`**: only once the rest makes sense; you rarely need to change it.

A good first exercise: in a Python prompt, build the seed, take UC-1012 (at the panel), and call
`actions_for` for `p_sam`, `p_elena` and `p_dana`. Explain why each person sees what they see, then find
the code in `actions.py` that decided it.

## 7. The API and the screens

**The API** (`api/aura_api`) sits between the screens and the engine. Read it in this order:

| File | What it does |
| --- | --- |
| `store.py` | Holds the data (cases, tools, files, rules). Memory plus an optional JSON file locally; a database in Azure later. |
| `views.py` | Turns engine results into what a screen needs: the queue, list rows, the case page, live form checks. Ports of small helpers from build 27's `ui.js`. |
| `service.py` | One function per thing the app can do: read the queue, perform an action, log a suggestion, upload evidence. Each change asks the engine for the new case, then saves it. |
| `routes.py` | Maps URLs (such as `POST /api/cases/UC-1012/actions/rv_vote`) to those functions. Lists every endpoint at the top. |
| `../dev_server.py` | Runs the API (and the built screens) on your laptop with only the Python standard library. |
| `../function_app.py` | The same routes as an Azure Functions app. |

Who is acting: the React app sends the person picked in **Viewing as** in an `X-Aura-Person` header. With
Microsoft sign-in, that header is replaced by the signed-in user.

**The screens** (`web/src`) are React components. Start with `App.tsx` (the frame and navigation), then
`pages/CasePage.tsx` (one use case). The case page asks the API for the case and the actions the person
has, shows each action as a button, and opens `components/ActionDialog.tsx`, which draws whatever fields
the engine asked for (`components/fields.tsx`). That is why a new action in the engine shows up in the UI
without new React code. The use case form (`components/FormEditor.tsx`) sends the form to the API as you
type and shows which questions apply and what is missing.

To learn React for this code: components and props, `useState` and `useEffect`, and how a list renders
with `.map`. The official tutorial at react.dev covers all three.

## 8. What comes next

1. **Data that survives restarts in Azure.** A `Store` backed by Azure SQL or Table storage, with the same methods.
2. **Microsoft sign-in.** MSAL in React, Entra ID in front of the API, and a mapping from signed-in users to AURA people.
3. **The remaining build 27 screens**: dashboard and rules editor.
4. **Deploy to the BWC sandbox** once the above works locally.
