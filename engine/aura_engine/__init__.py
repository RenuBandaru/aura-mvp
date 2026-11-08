"""AURA governance engine: the Python port of the build 27 JavaScript engine.

The engine is pure logic. It takes plain dictionaries (a use case, the rules, a person, a context
with the current time) and returns new dictionaries. It never reads a database, a clock or the
network, so the same inputs always give the same outputs. The API layer (``api/``) loads data,
calls the engine and saves what it returns; the React app (``web/``) only ever talks to the API.

The public entry points most callers need:

* :func:`actions_for` - what a person can do with a use case right now (drives the buttons in the UI).
* :func:`perform` - apply one of those actions and get the updated use case back.
* :func:`remind_case` - the daily reminder sweep for one use case.
* :func:`build_seed` - the sample data used for demos and tests (sample data only, never real BWC data).

Everything else is exported so the API and the tests can reach it without knowing which module it lives in.
"""

from .actions import actions_for
from .audit import audit_hash, seal_audit, verify_audit
from .constants import PEOPLE, SYSTEM, STAGES, TIERS, by_id, lead_id, with_role
from .consults import consult_needs, second_look_options
from .controls import (acceptance_expired, control_status, loose_threads, measure_board, measure_flags,
                       measure_state, parse_measures, support_view)
from .derived import exception_data, is_open, to_csv, waiting_on
from .errors import EngineError
from .forms import (blank_form, budget_flag, form_diff, form_diff_names, new_case, ready_status,
                    three_year_roi)
from .jsx import clone, js_json
from .matching import control_needs, form_gaps, unclaimed_required
from .people import (assign_adviser, duty_block, match_catalog, self_confirmed, training_blocks,
                     training_state)
from .perform import perform
from .review import (deadlock_options, open_unaccepted, remind_case, rev_blockers, rev_deadlock,
                     rev_need, rev_pool, rev_quorum_waivable, rev_ready, rev_reminder_due, rev_votes,
                     terms_gaps, terms_now)
from .rules import default_rules, norm_rules
from .rules_editor import describe_rule, diff_rules, option_usage, question_usage, validate_rules, what_if
from .seed import build_seed
from .tools import ensure_tool, new_tool, perform_tool, tool_actions, tool_visible
from .triage import case_gaps, estimate_days, rescore, run_scoring, run_triage

__all__ = [name for name in dir() if not name.startswith("_")]
