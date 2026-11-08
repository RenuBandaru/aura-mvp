"""Who does what on a case: owners, advisers, training gates, separation of duties, catalog matching."""

from __future__ import annotations

import re

from .constants import PEOPLE, by_id, lead_id, unit_of
from .jsx import UNDEF, js_or, js_str, truthy
from .rules import norm_rules

# Roles that may own a use case (and so sign it off).
OWNER_ROLES = ["submitter", "stakeholder", "exec"]


def owner_of(c: dict):
    """The owner's person id: the form's ownerId, else the person named as owner, else the submitter. JavaScript ``ownerOf``."""
    form = c.get("form") or {}
    if truthy(form.get("ownerId")):
        return form["ownerId"]
    named = next((p for p in PEOPLE if p["name"] == form.get("owner")), None) if c.get("form") else None
    if named and truthy(named.get("id")):
        return named["id"]
    return c.get("submitterId")


def sync_owner(c: dict) -> None:
    """Keep the owner's name in step with the owner's id. JavaScript ``syncOwner``."""
    if truthy(c["form"].get("ownerId")):
        c["form"]["owner"] = by_id(c["form"]["ownerId"])["name"]


def adviser_for_unit(unit_id, r0):
    """The adoption adviser for a business unit; the governance lead if none is named. JavaScript ``adviserForUnit``."""
    u = next((x for x in (norm_rules(r0).get("units") or []) if x["id"] == unit_id), None)
    if u and truthy(u.get("adviserId")) and by_id(u["adviserId"]):
        return u["adviserId"]
    return lead_id()


def assign_adviser(c: dict, r0, unit_id=None) -> dict:
    """Set the case's unit (given, or kept, or the submitter's) and its adviser. JavaScript ``assignAdviser``."""
    c["unitId"] = js_or(unit_id, c.get("unitId"), unit_of(c.get("submitterId")))
    c["adviserId"] = adviser_for_unit(c["unitId"], r0)
    return c


def role_name(p: dict) -> str:
    """A person's role in lower-case words, for email text. JavaScript ``roleName``."""
    names = {"lead": "governance lead", "adviser": "adoption adviser", "sme": "expert", "exec": "executive",
             "auditor": "auditor", "submitter": "submitter", "stakeholder": "stakeholder"}
    return js_or(names.get(p.get("role")), p.get("role"))


# ---- Training (an optional gate on submitting) ----

TRAIN_DAY = 86400000


def training_applies(t: dict, person: dict) -> bool:
    """Whether a training course applies to this person's role. JavaScript ``trainingApplies``."""
    ap = t.get("appliesTo")
    return not truthy(ap) or ap == "all" or (isinstance(ap, list) and person.get("role") in ap)


def training_rec(training, pid, tid):
    """A person's completion record for one course, or None. JavaScript ``trainingRec``."""
    return ((training or {}).get(pid) or {}).get(tid) or None


def training_state(training, pid, t: dict, now) -> str:
    """'due' (never done), 'overdue', 'soon' (expires within 30 days) or 'current'. JavaScript ``trainingState``."""
    r = training_rec(training, pid, t["id"])
    if not r:
        return "due"
    exp = r["at"] + js_or(t.get("refreshMonths"), 12) * 30.4375 * TRAIN_DAY
    if now > exp:
        return "overdue"
    return "soon" if exp - now < 30 * TRAIN_DAY else "current"


def training_blocks(training, person: dict, r0, now) -> list[dict]:
    """Courses this person must finish before submitting. JavaScript ``trainingBlocks``.

    The gate is off (nothing blocks) when no training records are passed in, as in tests and the
    sample builder.
    """
    if not truthy(training):
        return []
    return [t for t in (norm_rules(r0).get("trainings") or [])
            if truthy(t.get("requiredToSubmit")) and training_applies(t, person)
            and training_state(training, person["id"], t, now) in ("due", "overdue")]


def training_msg(blocks: list[dict]) -> str:
    """The message shown to someone the training gate stops. JavaScript ``trainingMsg``."""
    msg = "Training is required before you can submit: " + "; ".join(t["title"] for t in blocks) + ". Open Training in the menu to complete it."
    if blocks and truthy(blocks[0].get("contact")):
        msg += " Questions or stuck? Contact " + blocks[0]["contact"] + "."
    return msg


# ---- Separation of duties (B-36) ----
# Reviewing a case (vet, panel, executive) is kept apart from backing up its claims (confirmer,
# process stakeholder). Experts are a third group that does neither.

_VERB = {"confirm": "confirm a control", "stakeholder": "be a process stakeholder", "expert": "be consulted as an expert",
         "panel": "review as a panel member", "exec": "review as an executive"}


def duty_block(c: dict, pid, kind: str) -> str:
    """Why this person may not act in this capacity on this case, or '' if they may. JavaScript ``dutyBlock``.

    ``kind`` is one of: confirm, stakeholder, expert, panel, exec.
    """
    p = by_id(pid) or {}
    nm = js_or(p.get("name"), pid)
    verb = _VERB.get(kind, "undefined")
    if pid == c.get("submitterId") or pid == owner_of(c):
        return f"{js_str(nm)} is the submitter or owner of this use case and cannot {verb} on it."
    if p.get("role") == "lead" and kind in ("confirm", "stakeholder", "expert"):
        return f"{js_str(nm)} is the governance lead, who reviews cases, and cannot {verb} on any case."
    if pid == c.get("adviserId"):
        if p.get("role") != "lead" and kind in ("expert", "panel", "exec"):
            return f"{js_str(nm)} is the adoption adviser on this use case and cannot {verb} on it."
    if any(k.get("kind") == "sme" and k.get("personId") == pid for k in (c.get("consults") or [])) and kind in ("panel", "exec", "confirm"):
        return f"{js_str(nm)} was consulted as an expert on this use case and cannot {verb} on it."
    reviews = p.get("role") in ("panel", "exec") or any(n.get("by") == pid for n in (c.get("panelNotes") or []))
    if reviews and kind in ("expert", "confirm"):
        return f"{js_str(nm)} reviews this use case and cannot {verb} on it. The consult needs someone independent of the review."
    return ""


def self_confirmed(c: dict, rules: dict) -> list[str]:
    """Claimed controls whose named confirmer is the submitter or owner. JavaScript ``selfConfirmed``."""
    bad = [x for x in (c.get("submitterId"), owner_of(c)) if truthy(x)]
    attesters = c["form"].get("attesters") or {}
    out = []
    for cid in c["form"].get("controls") or []:
        if attesters.get(cid) in bad:
            k = next((x for x in rules["controls"] if x["id"] == cid), {})
            out.append(js_or(k.get("short"), cid))
    return out


# ---- Matching new ideas against the catalog and earlier cases ----

MATCH_STOP = set(("that this with from they them their have has had will would could should about into over under than then when where which "
                  "while what your you are was were been being also only each other more most some such very can may might must not and for the "
                  "our out use used using make made way any all new").split(" "))


def match_terms(text) -> list[str]:
    """The distinct meaningful words in a text (4+ letters, not a stop word). JavaScript ``matchTerms``."""
    words = re.split(r"[^a-z0-9]+", js_str(js_or(text, "")).lower())
    out: list[str] = []
    for w in words:
        if len(w) >= 4 and w not in MATCH_STOP and w not in out:
            out.append(w)
    return out


def match_catalog(text, tools, cases, limit=None, exclude_id=None) -> list[dict]:
    """Catalog tools and cases that share words with a new idea, best match first. JavaScript ``matchCatalog``."""
    words = match_terms(text)
    if not words:
        return []

    def hits(txt):
        lc = js_str(js_or(txt, "")).lower()
        return [w for w in words if w in lc]

    items = []
    for t in tools or []:
        if t.get("status") == "draft":
            continue
        h = hits(js_str(t.get("name", UNDEF)) + " " + js_str(js_or(t.get("purpose"), "")))
        if h:
            items.append({"kind": "tool", "ref": t, "words": h, "score": len(h)})
    for c in cases or []:
        if c.get("id") == exclude_id:
            continue
        f = c.get("form") or {}
        h = hits(" ".join([js_str(c.get("title", UNDEF))] + [js_str(js_or(v, "")) for v in (c.get("idea"), f.get("problem"), f.get("solution"))]))
        if h:
            items.append({"kind": "case", "ref": c, "words": h, "score": len(h)})
    items.sort(key=lambda x: -x["score"])  # stable, like JavaScript's sort
    return items[: js_or(limit, 10)]
