"""Conflict of duty rules and who gets which email (build 27 check file t5.js, 11 checks).

``duty_block(case, person, kind)`` says why a person may not act in a role on a case: as a control
confirmer, a stakeholder, a consulted expert, a panel reviewer or an executive. A truthy answer means
"blocked" (the value is the reason); a falsy one means allowed.
"""

import aura_engine as E
from aura_engine.constants import PEOPLE
from aura_engine.jsx import clone

from .helpers import NOW, R, SEED, Helpers, throws

h = Helpers(training=True)
ALL_KINDS = ("confirm", "stakeholder", "expert", "panel", "exec")


def mk(sub, adv):
    c = E.new_case("UC-9100", "Case", "Idea text here", sub, NOW, 1)
    c["adviserId"] = adv
    c["form"]["ownerId"] = sub
    return c


def sample(case_id):
    return clone(next(c for c in SEED["cases"] if c["id"] == case_id))


def test_submitter_and_owner_blocked_everywhere():
    c = mk("p_priya", "p_grant")
    c["form"]["ownerId"] = "p_hannah"
    for k in ALL_KINDS:
        assert E.duty_block(c, "p_priya", k) and E.duty_block(c, "p_hannah", k), k


def test_adviser_may_confirm_and_be_stakeholder():
    c = mk("p_priya", "p_grant")
    assert not E.duty_block(c, "p_grant", "confirm") and not E.duty_block(c, "p_grant", "stakeholder")


def test_adviser_blocked_as_expert_panel_exec():
    c = mk("p_priya", "p_grant")
    for k in ("expert", "panel", "exec"):
        assert E.duty_block(c, "p_grant", k), k


def test_lead_is_a_reviewer_not_a_confirmer_stakeholder_or_expert():
    other = mk("p_priya", "p_grant")
    for k in ("confirm", "stakeholder", "expert"):
        assert E.duty_block(other, "p_elena", k), "other case " + k
    own = mk("p_claire", "p_elena")  # the lead is the adviser here and may still review
    for k in ("confirm", "stakeholder", "expert"):
        assert E.duty_block(own, "p_elena", k), k
    for k in ("panel", "exec"):
        assert not E.duty_block(own, "p_elena", k), k


def test_consulted_expert_cannot_review_or_confirm():
    c = mk("p_priya", "p_grant")
    c["consults"] = [{"kind": "sme", "personId": "p_jack", "status": "pending"}]
    for k in ("panel", "exec", "confirm"):
        assert E.duty_block(c, "p_jack", k), k


def test_panel_member_cannot_be_consulted():
    pm = next(p for p in PEOPLE if p["role"] == "panel")
    assert E.duty_block(mk("p_priya", "p_grant"), pm["id"], "expert")


def test_consult_refuses_the_owner_as_stakeholder():
    c = sample("UC-1012")
    c["form"]["ownerId"] = "p_hannah"
    throws(lambda: h.perform(c, "consult", {"smes": [], "stakeholders": ["p_hannah"], "question": "Q"}, "p_elena"), "owner")


def _returned_mail(c):
    n0 = len(c["outbox"])
    c = h.perform(c, "vet_remediate", {"note": "Needs more detail on the data."}, "p_elena")
    m = next((x for x in c["outbox"][n0:] if "Returned" in x["subject"]), None)
    assert m, "no mail: " + c["stage"]
    return m


def test_adviser_gets_the_returned_mail_once():
    c = sample("UC-1006")
    adv = c["adviserId"]
    m = _returned_mail(c)
    if adv not in (c["submitterId"], "p_elena"):
        assert adv in m["to"], "adviser missing"
    assert len(set(m["to"])) == len(m["to"]), "duplicates"


def test_lead_acting_as_adviser_still_gets_the_returned_mail():
    c = sample("UC-1006")
    c["adviserId"] = "p_elena"
    assert "p_elena" in _returned_mail(c)["to"]


def test_adviser_developing_is_not_copied_on_their_own_action():
    c = E.assign_adviser(E.new_case("UC-9200", "Idea", "Idea text here", "p_priya", NOW, 1), R)
    n0 = len(c["outbox"])
    c = h.perform(c, "develop", {}, c["adviserId"])
    m = next((x for x in c["outbox"][n0:] if "being developed" in x["subject"]), None)
    assert m, "no mail"
    assert c["adviserId"] not in m["to"]


def test_sample_data_has_no_stuck_required_consult():
    """Every required expert on a non-legacy sample case must be someone who is allowed to answer."""
    for c in SEED["cases"]:
        if c.get("legacy"):
            continue
        for n in E.consult_needs(c["form"], R).values():
            if n["level"] == "required":
                assert not E.duty_block(c, n["personId"], "expert"), c["id"] + " " + n["label"]
