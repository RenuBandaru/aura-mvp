"""Controls that stop applying (build 27 check file t3.js, 7 checks).

The story: a customer facing use case claims the "escalation path" control. Its scope then changes
to internal, so escalation no longer applies. The control must stop earning credit, show as not
applicable, stop being a loose thread, and the submitter must be able to remove it. Removing it
tells a pending confirmer they are no longer needed. A control that still applies cannot be removed.

build 27 ran these as one script that changed the case between checks; here each stage is rebuilt
by a small function, so every test can run on its own.
"""

import aura_engine as E
from aura_engine.jsx import clone, truthy

from .helpers import NOW, R, SEED, Helpers, throws

h = Helpers(training=False)


def claimed():
    """A customer facing sample case that claims the escalation control."""
    return clone(next(c for c in SEED["cases"] if c.get("form") and c["form"].get("scope") == "customer" and "c_escalate" in (c["form"].get("controls") or [])))


def now_internal():
    c = claimed()
    c["form"]["scope"] = "internal"
    return c


def with_pending_confirmer():
    c = now_internal()
    c["attestations"] = [a for a in c.get("attestations") or [] if a["controlId"] != "c_escalate"] + [
        {"controlId": "c_escalate", "personId": "p_ravi", "status": "pending", "evidence": "", "requestedAt": NOW, "at": None, "text": ""}]
    c["form"]["attesters"] = {**c["form"].get("attesters", {}), "c_escalate": "p_ravi"}
    return c


def score(c):
    return E.run_scoring(c["form"], R, c.get("attestations"))


def test_credit_while_the_control_applies():
    assert score(claimed())["inapplicable"] == []


def test_credit_drops_when_it_stops_applying():
    sc = score(now_internal())
    assert "c_escalate" in sc["inapplicable"], "not flagged"
    assert sc["controlCredit"] < score(claimed())["controlCredit"], "credit did not drop"


def test_support_view_marks_not_applicable():
    rows = E.support_view(now_internal(), R)["rows"]
    assert truthy(next(r for r in rows if r["id"] == "c_escalate").get("na"))


def test_not_a_loose_thread():
    assert not any(t["id"] == "ctl:c_escalate" for t in E.loose_threads(now_internal(), R))


def test_remove_control_offered_to_submitter():
    c = now_internal()
    assert h.has(c, c["submitterId"], "remove_control")


def test_remove_sends_no_longer_needed_mail():
    c = with_pending_confirmer()
    n = len(c["outbox"])
    r = h.perform(c, "remove_control", {"controlId": "c_escalate"}, c["submitterId"])
    assert any("No longer needed" in m["subject"] and "p_ravi" in m["to"] for m in r["outbox"][n:]), "no mail"
    assert "c_escalate" not in r["form"]["controls"], "still claimed"
    assert r.get("removedControls"), "not archived"


def test_remove_refused_while_applicable():
    c2 = clone(next(c for c in SEED["cases"] if c.get("form") and c["form"].get("controls")))
    throws(lambda: h.perform(c2, "remove_control", {"controlId": c2["form"]["controls"][0]}, c2["submitterId"]))
