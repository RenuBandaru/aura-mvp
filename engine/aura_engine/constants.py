"""Fixed names and lists the whole engine shares: stages, tiers, roles, and the sample people.

Nothing here changes while the app runs. The editable policy (questions, rules, points,
deadlines) lives in the rules object built by :func:`aura_engine.rules.default_rules`.

The sample people are invented. They stand in for real Bradford White staff until the app signs
people in with Entra ID (see the implementation plan). Their ids, such as ``p_elena``, appear in
every sample case and in the tests, so they must not change.
"""

from __future__ import annotations

from .jsx import truthy

APP_VERSION = "0.3"
APP_BUILD = 27

# One day in milliseconds. All engine times are milliseconds since 1 January 1970 (UTC), as in JavaScript.
DAY = 86400000

TIERS = ["low", "moderate", "high", "critical"]
TIER_LABEL = {"low": "Low", "moderate": "Moderate", "high": "High", "critical": "Critical"}

# The order a case moves through. "closed" is the end for rejected cases.
STAGES = ["suggestion", "use_case", "vetting", "panel", "exec", "pilot", "production", "closed"]
STAGE_LABEL = {
    "suggestion": "Suggestion", "use_case": "Use case", "vetting": "Vetting", "panel": "Panel review",
    "exec": "Executive review", "pilot": "Pilot", "production": "Production", "closed": "Closed",
}
ROLE_LABEL = {
    "submitter": "Submitter", "adviser": "Adoption adviser", "lead": "Governance lead", "panel": "Panel reviewer",
    "sme": "Subject matter expert", "stakeholder": "Process stakeholder", "exec": "Executive",
    "auditor": "Auditor (read-only)", "admin": "Demo admin",
}


def _p(pid: str, unit: str, name: str, role: str, title: str) -> dict:
    return {"id": pid, "unit": unit, "name": name, "role": role, "title": title}


# The sample people, in the same order as build 27 (the order matters: "the first lead" is used in places).
PEOPLE = [
    _p("p_dana", "u_ops", "Dana Whitfield", "submitter", "Plant operations"),
    _p("p_marcus", "u_eng", "Marcus Lee", "submitter", "Product engineering"),
    _p("p_priya", "u_cs", "Priya Nair", "submitter", "Customer service"),
    _p("p_jordan", "u_corp", "Jordan Ellis", "adviser", "AI adoption team"),
    _p("p_elena", "u_legal", "Elena Duarte", "lead", "Governance lead, panel chair"),
    _p("p_sam", "u_corp", "Sam Okafor", "panel", "Panel reviewer, finance"),
    _p("p_naomi", "u_corp", "Naomi Park", "panel", "Panel reviewer, IT"),
    _p("p_ravi", "u_corp", "Ravi Menon", "sme", "Cybersecurity"),
    _p("p_claire", "u_legal", "Claire Dubois", "sme", "Legal"),
    _p("p_jack", "u_ops", "Jack Tran", "sme", "Operations"),
    _p("p_hannah", "u_ops", "Hannah Cole", "stakeholder", "Production manager"),
    _p("p_luis", "u_cs", "Luis Garcia", "stakeholder", "Field service lead"),
    _p("p_tamika", "u_ops", "Tamika Rowe", "stakeholder", "Quality manager"),
    _p("p_margaret", "u_ops", "Margaret Hale", "exec", "Chief operating officer"),
    _p("p_victor", "u_corp", "Victor Shaw", "exec", "Chief financial officer"),
    _p("p_ines", "u_eng", "Ines Alvarez", "exec", "Chief technology officer"),
    _p("p_auditor", "u_legal", "Rhea Callahan", "auditor", "Internal audit, read-only"),
    _p("p_admin", "u_corp", "Demo admin", "admin", "Manages rules and sample data"),
    _p("p_noor", "u_eng", "Noor Haddad", "adviser", "AI adoption team"),
    _p("p_grant", "u_cs", "Grant Mercer", "adviser", "AI adoption team"),
    _p("p_mei", "u_corp", "Mei Lin", "sme", "IT standards"),
    _p("p_omar", "u_corp", "Omar Reyes", "sme", "Data steward"),
    _p("p_mina", "u_eng", "Mina Kowalski", "sme", "AI safety"),
    _p("p_tomas", "u_ops", "Tomas Brandt", "submitter", "New hire, plant operations"),
]

# How many people build 27 had. The equivalence tests compare results for these people only.
BUILD27_PEOPLE_COUNT = len(PEOPLE)

# Experts added after build 27 so the expert areas a sponsor asked for each have a sample person.
# They are invented, like everyone above. They are added at the end so build 27's order is kept.
ADDED_EXPERTS = [
    _p("p_rosa", "u_legal", "Rosa Albright", "sme", "Contracts"),
    _p("p_kenji", "u_legal", "Kenji Watanabe", "sme", "Intellectual property"),
    _p("p_felix", "u_eng", "Felix Moreau", "sme", "Product engineering, product risk and firmware"),
    _p("p_dara", "u_eng", "Dara Quinn", "sme", "Connected products engineering"),
    _p("p_bea", "u_corp", "Beatriz Soto", "sme", "Marketing and customer communications"),
    _p("p_theo", "u_corp", "Theo Lindqvist", "sme", "Sales"),
    _p("p_ada", "u_cs", "Adaeze Okoro", "sme", "Customer service"),
]
PEOPLE.extend(ADDED_EXPERTS)

# The actor recorded for automated steps, such as triage and reminders.
SYSTEM = {"id": "system", "name": "System (automated)", "role": "system", "title": ""}


def by_id(pid) -> dict:
    """Look a person up by id. Unknown ids get a stand-in record, so callers never get None.

    JavaScript ``byId``. ``by_id('system')`` gives :data:`SYSTEM`.
    """
    for p in PEOPLE:
        if p["id"] == pid:
            return p
    if pid == "system":
        return SYSTEM
    return {"id": pid, "name": pid if truthy(pid) else "Unknown", "role": "unknown", "title": ""}


def with_role(role: str) -> list[dict]:
    """Everyone with this role, in list order. JavaScript ``withRole``."""
    return [p for p in PEOPLE if p["role"] == role]


def lead_id() -> str | None:
    """The id of the first governance lead. JavaScript ``leadId``."""
    leads = with_role("lead")
    return leads[0]["id"] if leads else None


def unit_of(pid) -> str:
    """The business unit of a person, or '' if unknown. JavaScript ``unitOf``."""
    return by_id(pid).get("unit") or ""


# How bias was checked at a production review.
BIAS_OPTS = [
    ["none", "Not reviewed this period"], ["informal", "Informal check"], ["structured", "Structured test"],
    ["audit", "Independent audit"], ["na", "Not applicable: does not affect individuals"],
]

# Answer options shared by many questions.
YN_OPTS = [{"id": "yes", "label": "Yes"}, {"id": "no", "label": "No"}]
UNKNOWN_OPT = {"id": "unknown", "label": "Not known"}
SCOPE_OPTS = [
    {"id": "team", "label": "One team"}, {"id": "site", "label": "One site"},
    {"id": "company", "label": "Whole company"}, {"id": "customer", "label": "Customers or the public"},
]
AUTONOMY_OPTS = [
    {"id": "advice", "label": "Gives advice only"}, {"id": "assist", "label": "Assists a person who decides"},
    {"id": "automate", "label": "Acts on its own"},
]

RULE_KINDS = {"guardrail": "Guardrail", "condition": "Condition to clear", "require": "Required control", "override": "Minimum tier rule", "points": "Points"}
RULE_PLURAL = {"guardrail": "Guardrails", "condition": "Conditions to clear", "require": "Required controls", "override": "Minimum tier rules", "points": "Points"}
KIND_ORDER = ["guardrail", "condition", "require", "override", "points"]


def t_idx(tier) -> int:
    """Position of a tier, low = 0. Unknown tiers count as low. JavaScript ``tIdx``."""
    return TIERS.index(tier) if tier in TIERS else 0


def max_tier(a, b):
    """The higher of two tiers (the first one when equal). JavaScript ``maxTier``."""
    return a if t_idx(a) >= t_idx(b) else b
