"""The tamper-evident audit trail.

Every case keeps a list of audit entries (``c["audit"]``). Each entry stores the hash of the entry
before it (``prev``) and its own hash (``hash``), so changing or removing any earlier entry breaks
the chain from that point on. The first entry points at ``"genesis:<case id>"``.

In the database, the audit table is also insert-only (UPDATE and DELETE are denied), so tampering
is prevented there and detected here. See db/ and the implementation plan.

The hash is SHA-256 over a JSON array of the entry's fields, written exactly as JavaScript's
``JSON.stringify`` writes it, so hashes made by build 27 and by this port are identical.
"""

from __future__ import annotations

import hashlib

from .jsx import js_json, nullish, truthy


def sha256(msg: str) -> str:
    """SHA-256 of the text's UTF-8 bytes, as 64 lowercase hex characters (build 27 had its own copy of this)."""
    return hashlib.sha256(msg.encode("utf-8")).hexdigest()


def audit_hash(e: dict) -> str:
    """The hash of one audit entry. JavaScript ``auditHash``.

    The fields go into a fixed-order array, so the order of keys in the entry does not matter.
    """
    fields = [e.get("prev"), e.get("ts"), e.get("actor"), e.get("action"), e.get("note"), e.get("from"), e.get("to"),
              truthy(e.get("auto")), e.get("tag") or "", None if nullish(e.get("rv")) else e.get("rv")]
    return sha256(js_json(fields))


def seal_audit(c: dict, rv, now) -> dict:
    """Chain any audit entries not yet sealed, and stamp decisions made at this moment. JavaScript ``sealAudit``.

    ``rv`` is the rules version in force. A vetting, panel or executive decision made at ``now``
    gets the rules version and the hash of the newest audit entry (``head``), which ties the
    decision to the exact history it was made on.
    """
    prev = "genesis:" + c["id"]
    for e in c["audit"]:
        if truthy(e.get("hash")):
            prev = e["hash"]
            continue
        if nullish(e.get("rv")):
            e["rv"] = rv
        e["prev"] = prev
        e["hash"] = audit_hash(e)
        prev = e["hash"]
    for d in (c.get("vetting"), c.get("panelDecision"), c.get("execDecision")):
        if truthy(d) and d.get("at") == now:
            if nullish(d.get("rv")):
                d["rv"] = rv
            if not truthy(d.get("head")):
                d["head"] = prev
    return c


def verify_audit(c: dict) -> dict:
    """Check the chain. JavaScript ``verifyAudit``.

    Returns ``{ok, entries}`` or ``{ok: False, entries, brokenAt, reason}``, where ``brokenAt`` is
    the 1-based position of the first entry that does not check out.
    """
    prev = "genesis:" + c["id"]
    n = len(c["audit"])
    for i, e in enumerate(c["audit"]):
        if not truthy(e.get("hash")):
            return {"ok": False, "entries": n, "brokenAt": i + 1, "reason": "This entry was never sealed."}
        if e.get("prev") != prev:
            return {"ok": False, "entries": n, "brokenAt": i + 1, "reason": "An earlier entry was removed, added or reordered."}
        if audit_hash(e) != e["hash"]:
            return {"ok": False, "entries": n, "brokenAt": i + 1, "reason": "This entry was changed after it was written."}
        prev = e["hash"]
    hashes = {e.get("hash") for e in c["audit"]}
    for d in (c.get("vetting"), c.get("panelDecision"), c.get("execDecision")):
        if truthy(d) and truthy(d.get("head")) and d["head"] not in hashes:
            return {"ok": False, "entries": n, "brokenAt": n, "reason": "A decision points at an audit entry that no longer exists."}
    return {"ok": True, "entries": n}
