"""Claimed controls, their support (confirmation or evidence), KPIs, and the open items an approver must accept.

A submitter claims controls (safeguards) on the form: ``form["controls"]`` is a list of control
ids. Each claimed control earns its credit against the risk score when claimed. A person named
as its confirmer (``form["attesters"][control_id]``) is asked to confirm it; a declined
confirmation removes the credit. Evidence (text, a link or a file) also supports a control.
"""

from __future__ import annotations

import re

from .constants import by_id
from .errors import EngineError
from .jsx import UNDEF, is_nan, js_or, js_str, nullish, to_num, truthy
from .matching import control_needs, ctl_applies, unclaimed_required
from .rules import norm_rules, tier_from_score

EVIDENCE_MAX = 500 * 1024
EVIDENCE_TYPES = "pdf, png, jpg, gif, webp, txt, md, json, csv, docx, xlsx, pptx, zip"
EVIDENCE_EXT = re.compile(r"\.(pdf|png|jpe?g|gif|webp|txt|md|json|csv|docx|xlsx|pptx|zip)\Z", re.IGNORECASE)

CTL_STATUS = {"confirmed": "Confirmed", "evidence": "Has evidence", "neither": "No confirmation or evidence", "declined": "Confirmation declined"}


def att_of(atts, control_id):
    """The attestation (confirmation request) for one control, or None. JavaScript ``attOf``."""
    return next((a for a in (atts or []) if a.get("controlId") == control_id), None)


def control_credit(form: dict, rules: dict, atts) -> dict:
    """Credit earned by the claimed controls. JavaScript ``controlCredit``.

    A claimed control earns its credit unless its confirmation was declined. A control that does
    not apply to the answers earns nothing and is listed as inapplicable.
    """
    credit = 0
    withheld, inapplicable = [], []
    for cid in form.get("controls") or []:
        k = next((x for x in rules["controls"] if x["id"] == cid), None)
        if not k:
            continue
        if not ctl_applies(k, form, rules):
            inapplicable.append(cid)
            continue
        a = att_of(atts, cid)
        if a and a.get("status") == "declined":
            withheld.append({"id": cid, "why": "declined"})
        else:
            credit += k["credit"]
    return {"credit": credit, "withheld": withheld, "inapplicable": inapplicable}


def has_evidence(c: dict, control_id) -> bool:
    """Whether a control has evidence: text on the form or the confirmation, or a file or link. JavaScript ``hasEvidence``."""
    form_text = js_str(js_or(((c.get("form") or {}).get("evidence") or {}).get(control_id), "")).strip()
    att_text = js_str(js_or((att_of(c.get("attestations"), control_id) or {}).get("evidence"), "")).strip()
    item = any(e.get("controlId") == control_id and not truthy(e.get("removed")) for e in (c.get("evidenceItems") or []))
    return bool(form_text or att_text or item)


def control_status(c: dict, control_id) -> str:
    """'declined', 'confirmed', 'evidence' or 'neither'. JavaScript ``controlStatus``."""
    a = att_of(c.get("attestations"), control_id)
    if a and a.get("status") == "declined":
        return "declined"
    if a and a.get("status") == "confirmed":
        return "confirmed"
    return "evidence" if has_evidence(c, control_id) else "neither"


def support_view(c: dict, r0) -> dict:
    """Each claimed control with how well it is backed, and the net score after supported controls. JavaScript ``supportView``.

    ``counted`` is the credit the scoring gives (everything not declined). ``supported`` counts only
    controls that are confirmed or have evidence; ``net`` is the inherent score minus that.
    """
    rules = norm_rules(r0)
    form = c.get("form") or {}
    needs = control_needs(form, rules)
    rows = []
    for cid in form.get("controls") or []:
        k = next((x for x in rules["controls"] if x["id"] == cid), None)
        if not k:
            continue
        a = att_of(c.get("attestations"), k["id"])
        rows.append({
            "na": not ctl_applies(k, form, rules), "id": k["id"], "text": k["text"], "short": js_or(k.get("short"), k["text"]),
            "credit": k["credit"], "status": control_status(c, k["id"]), "pending": bool(a and a.get("status") == "pending"),
            "asked": a["personId"] if a else None, "required": (needs.get(k["id"]) or {}).get("level") == "required",
        })
    counted = sum(r["credit"] for r in rows if not r["na"] and r["status"] != "declined")
    supported = sum(r["credit"] for r in rows if not r["na"] and r["status"] in ("confirmed", "evidence"))
    inh = c["scoring"]["inherent"] if truthy(c.get("scoring")) else None
    net = None if inh is None else max(0, inh - supported)
    return {"rows": rows, "counted": counted, "supported": supported, "net": net, "netTier": None if net is None else tier_from_score(net, rules)}


def ov_slug(thread_id) -> str:
    """A form-safe name for an open item, used in field names like ``ov_<slug>``. JavaScript ``ovSlug``."""
    return re.sub(r"[^a-zA-Z0-9]+", "_", js_str(thread_id))


def loose_threads(c: dict, r0) -> list[dict]:
    """Open items an approver must knowingly accept before approving. JavaScript ``looseThreads``.

    In order: claimed controls that are declined or have neither confirmation nor evidence,
    required controls not claimed, concerns raised by consulted people, and conditions to clear.
    Each item has an ``id`` (such as ``ctl:c_test``) and a ``slug`` used to name its form fields.
    """
    rules = norm_rules(r0)
    out = []
    sv = support_view(c, rules)
    for r in sv["rows"]:
        if r["na"]:
            continue
        if r["status"] == "declined":
            a = att_of(c.get("attestations"), r["id"]) or {}
            out.append({"id": "ctl:" + r["id"], "kind": "declined", "label": r["text"], "head": js_or(r["short"], r["text"]),
                        "who": by_id(a.get("personId"))["name"], "detail": js_or(a.get("text"), "")})
        elif r["status"] == "neither":
            out.append({"id": "ctl:" + r["id"], "kind": "unsupported", "label": r["text"], "head": js_or(r["short"], r["text"]),
                        "detail": "no confirmation yet and no evidence" if r["pending"] else "no confirmation and no evidence"})
    for n in unclaimed_required(c.get("form") or {}, rules):
        out.append({"id": "req:" + n["id"], "kind": "missing", "label": n["text"], "head": n["text"], "detail": "required for this use case but not claimed"})
    for k in c.get("consults") or []:
        resp = k.get("response")
        if k.get("status") == "responded" and truthy(resp) and resp.get("stance") in ("concerns", "serious"):
            p = by_id(k.get("personId"))
            head = "Expert - " + js_or(p.get("title"), "Expert") if k.get("kind") == "sme" else "Stakeholder"
            out.append({"id": "k:" + js_str(k.get("id", UNDEF)), "kind": "concern", "stance": resp["stance"], "label": p["name"], "head": head,
                        "who": p["name"], "detail": resp.get("text", UNDEF)})
    for x in (c.get("scoring") or {}).get("conditions") or []:
        out.append({"id": "cond:" + x["id"], "kind": "condition", "label": x["label"], "head": x["label"],
                    "detail": "to clear before " + ("pilot" if x.get("clearBy") == "pilot" else "production")})
    for t in out:
        t["slug"] = ov_slug(t["id"])
    return out


def thread_sig(t: dict) -> str:
    """The signature saved with an accepted risk, so a changed item has to be accepted again.

    JavaScript writes it inline as ``t.kind + '|' + t.detail + '|' + t.label``.
    """
    return js_str(t.get("kind", UNDEF)) + "|" + js_str(t.get("detail", UNDEF)) + "|" + js_str(t.get("label", UNDEF))


# ---- KPIs (measures) ----

MEASURE_SLOTS = 4
MEAS_DIR = {"lower": "Lower is better", "higher": "Higher is better"}
MEAS_STATE = {"stop": "Stop limit passed", "scale": "Scale-up target reached", "met": "Target met", "short": "Below target"}


def _num_or_none(v):
    """A typed KPI number, or None when blank or not a number."""
    if v == "" or nullish(v) or is_nan(v):
        return None
    return to_num(v)


def parse_measures(rows, strict: bool = False) -> list[dict]:
    """Check and tidy the KPI rows typed by a submitter or an approver. Blank rows are skipped. JavaScript ``parseMeasures``.

    With ``strict``, each KPI needs a target and a stop limit on the right side of the target,
    and a scale-up target (if any) at least as good as the target. Raises EngineError otherwise.
    """
    out = []
    for i, r in enumerate(rows or []):
        name = js_str(js_or(r.get("name") if isinstance(r, dict) else None, "")).strip()
        if not name:
            continue
        m = {"id": js_or(r.get("id"), "m" + str(i + 1)), "name": name, "dir": "higher" if r.get("dir") == "higher" else "lower",
             "target": _num_or_none(r.get("target", UNDEF)), "scaleUp": _num_or_none(r.get("scaleUp", UNDEF)), "stop": _num_or_none(r.get("stop", UNDEF))}
        if strict:
            if m["target"] is None or m["stop"] is None:
                raise EngineError('KPI "' + name + '" needs a number for its target and for its stop limit.')
            if m["dir"] == "lower" and not (m["stop"] > m["target"]):
                raise EngineError('KPI "' + name + '": where lower is better, the stop limit must be above the target.')
            if m["dir"] == "higher" and not (m["stop"] < m["target"]):
                raise EngineError('KPI "' + name + '": where higher is better, the stop limit must be below the target.')
            if m["scaleUp"] is not None and ((m["dir"] == "lower" and m["scaleUp"] > m["target"]) or (m["dir"] == "higher" and m["scaleUp"] < m["target"])):
                raise EngineError('KPI "' + name + '": the scale-up target must be at least as good as the target.')
        out.append(m)
    return out


def measure_state(m: dict, v):
    """'stop' (past the stop limit), 'scale' (reached scale-up), 'met', 'short', or None. JavaScript ``measureState``."""
    if nullish(v) or is_nan(v):
        return None
    v = to_num(v)
    lo = m.get("dir") == "lower"
    if not nullish(m.get("stop")) and (v >= m["stop"] if lo else v <= m["stop"]):
        return "stop"
    if not nullish(m.get("scaleUp")) and (v <= m["scaleUp"] if lo else v >= m["scaleUp"]):
        return "scale"
    if not nullish(m.get("target")) and (v <= m["target"] if lo else v >= m["target"]):
        return "met"
    return "short"


def measure_board(c: dict) -> list[dict]:
    """The approved KPIs with the latest value recorded for each. JavaScript ``measureBoard``."""
    ms = (c.get("acceptance") or {}).get("measures") or [] if truthy(c.get("acceptance")) else []
    rows = []
    for m in ms:
        last = None
        for x in c.get("measurements") or []:
            if truthy(x.get("values")) and not nullish(x["values"].get(m["id"])):
                last = {"v": x["values"][m["id"]], "at": x.get("at"), "by": x.get("by")}
        rows.append({"m": m, "value": last["v"] if last else None, "at": last["at"] if last else None,
                     "state": measure_state(m, last["v"]) if last else None})
    return rows


def measure_flags(c: dict) -> list[dict]:
    """KPIs past their stop limit, for cases in pilot or production. JavaScript ``measureFlags``."""
    return [r for r in measure_board(c) if r["state"] == "stop"] if c.get("stage") in ("pilot", "production") else []


def acceptance_expired(c: dict, now) -> bool:
    """Whether the approval of a live case has run out. JavaScript ``acceptanceExpired``."""
    ac = c.get("acceptance")
    return bool(truthy(ac) and c.get("stage") in ("pilot", "production") and truthy(ac.get("validUntil")) and now > ac["validUntil"])
