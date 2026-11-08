"""Facts worked out from cases for queues, exports and the dashboard."""

from __future__ import annotations

import re

from .actions import actions_for
from .constants import PEOPLE, by_id
from .jsx import js_or, js_str, truthy

# Kinds of accepted exception shown on the dashboard chart.
EXC_KINDS = [["unsupported", "Control unsupported"], ["declined", "Control declined"], ["missing", "Required control not claimed"],
             ["concern", "Concern"], ["serious", "Serious concern"], ["condition", "Condition to clear"]]


def is_open(c: dict) -> bool:
    """Still moving through review (not closed and not in production). JavaScript ``isOpen``."""
    return c.get("stage") not in ("closed", "production")


def waiting_on(c: dict, ctx: dict) -> list[dict]:
    """People who can act on the case now, for building each person's queue. JavaScript ``waitingOn``."""
    return [p for p in PEOPLE if any(not truthy(a.get("disabled")) or a["id"].startswith("panel_") or a["id"] == "respond" for a in actions_for(c, p, ctx))]


def csv_escape(v) -> str:
    """One CSV cell: quoted when it holds a quote, comma or line break. JavaScript ``csvEscape``."""
    v = "" if v is None else js_str(v)
    return '"' + v.replace('"', '""') + '"' if re.search(r'[",\n]', v) else v


def to_csv(rows) -> str:
    """Rows of cells as CSV text. JavaScript ``toCsv``."""
    return "\n".join(",".join(csv_escape(x) for x in r) for r in rows)


def exception_data(cases, since, rules) -> list[dict]:
    """Risks accepted at approval since a time, grouped by what was accepted, most frequent first. JavaScript ``exceptionData``."""
    rows: dict = {}
    for c in cases:
        for d in (c.get("panelDecision"), c.get("execDecision")):
            if not (truthy(d) and d.get("at", 0) >= since and (d.get("overrides") or [])):
                continue
            for o in d.get("overrides") or []:
                kind = "serious" if o.get("kind") == "concern" and o.get("stance") == "serious" else o.get("kind")
                head = js_or(o.get("head"), o.get("label"))
                mk = re.match(r"^k:(.+)\Z", js_or(o.get("id"), ""), re.S)
                if mk:
                    k = next((x for x in (c.get("consults") or []) if x.get("id") == mk.group(1)), None)
                    if k:
                        head = "Expert - " + js_or(by_id(k.get("personId")).get("title"), "Expert") if k.get("kind") == "sme" else "Stakeholder"
                m = re.match(r"^ctl:(.+)\Z", js_or(o.get("id"), ""), re.S) or re.match(r"^req:(.+)\Z", js_or(o.get("id"), ""), re.S)
                if m and truthy(rules):
                    k = next((x for x in rules["controls"] if x["id"] == m.group(1)), None)
                    if k:
                        head = js_or(k.get("short"), k.get("text"))
                r = rows.setdefault(head, {"head": head, "total": 0, "kinds": {}, "cases": []})
                r["total"] += 1
                r["kinds"][kind] = r["kinds"].get(kind, 0) + 1
                if c["id"] not in r["cases"]:
                    r["cases"].append(c["id"])
    return sorted(rows.values(), key=lambda r: -r["total"])
