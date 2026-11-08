"""Sample data: an invented, generic water heater manufacturer.

Nothing here is real Bradford White data. The sample cases are built by driving the engine
through the same actions a person would take (develop, submit, vet, consult, vote, approve...),
so every case is internally consistent and has a real audit trail. That also makes
:func:`build_seed` a broad test of the engine: build 27's seed and this one must match exactly.

``now`` is the moment the sample is built; every case's dates are set relative to it, so the
sample always looks current (UC-1003's expert response is always overdue, and so on).
"""

from __future__ import annotations

from urllib.parse import quote

from .constants import DAY, PEOPLE, by_id
from .controls import loose_threads
from .forms import new_case
from .jsx import js_json, js_or, truthy
from .matching import required_controls
from .people import assign_adviser
from .perform import perform
from .rules import default_rules
from .tools import ensure_tool, new_tool, next_tool_id, perform_tool

# Answers for a sample case: yes to the listed yes/no questions, and the safe answer to every picklist.
SAFE = {"q_access": "lim", "q_listed": "listed", "q_svc": "co", "q_sens": "int", "q_code": "none", "q_target": "na"}
# The type of each sample use case.
UT = {1001: "use", 1002: "build", 1003: "vendor", 1004: "model", 1005: "build", 1006: "use", 1007: "build", 1008: "use", 1009: "vendor",
      1011: "model", 1012: "model", 1013: "use", 1014: "use", 1015: "model"}
# Who confirms each control that needs a confirmer, and the evidence the submitter noted.
CLAIM = {"c_bounds": ["p_jack", "Design review of the fixed limits"], "c_validate": ["p_jack", "Independent validation plan"],
         "c_rollback": ["p_ravi", "Backup and restore tested"], "c_escalate": ["p_claire", "Escalation path to a service agent"],
         "c_share": ["p_claire", "Data-sharing terms reviewed"]}
# The reason given for each kind of open item a sample approver accepts.
OVR = {"declined": "Accepted for the pilot; the confirmer will be asked again.", "unsupported": "Evidence is expected before the pilot starts.",
       "missing": "The owner will claim it during the pilot.", "concern": "Addressed through the pilot scope.", "condition": "Will be cleared before the next gate."}
# Finalizing actions, and the firm decision the approver records just before each one.
FIN = {"panel_approve": "approve", "panel_waive": "waive", "panel_recommend": "approve", "panel_remediate": "remediate", "panel_reject": "reject", "panel_escalate": "escalate"}


def M(name, direction, target, scale_up, stop) -> dict:
    """One KPI: name, which direction is better, target, scale-up target (or None) and stop limit."""
    return {"name": name, "dir": direction, "target": target, "scaleUp": scale_up, "stop": stop}


MS = {
    1001: [M("Minutes to produce the weekly summary", "lower", 10, 5, 30), M("Supervisor edits per summary", "lower", 5, None, 15)],
    1002: [M("Unplanned stoppages per quarter", "lower", 4, 2, 8), M("False alerts per week", "lower", 3, None, 10)],
    1003: [M("Deflection rate (%)", "higher", 33, 45, 15), M("Customer satisfaction (1 to 5)", "higher", 4.2, None, 3.6)],
    1004: [M("Stock-outs per quarter", "lower", 0, None, 2), M("Forecast error (%)", "lower", 12, 8, 25)],
    1005: [M("Escaped defects per 10,000 tanks", "lower", 25, 15, 50), M("False alarm rate (%)", "lower", 8, 5, 15)],
    1006: [M("Hours to produce a first draft", "lower", 8, 4, 20)],
    1007: [M("Test minutes per unit", "lower", 10, 8, 25), M("Rework rate (%)", "lower", 2, 1, 5)],
    1008: [M("Average price improvement (%)", "higher", 3, 5, 0)],
    1009: [M("Days to hire", "lower", 30, 25, 50)],
    1011: [M("Peak energy charge ($ a month)", "lower", 8000, 6000, 12000)],
    1012: [M("Hours to first response on a claim", "lower", 24, 12, 72), M("Wrong technician-visit suggestions (%)", "lower", 5, 2, 12)],
    1013: [M("Theme summaries read each month", "higher", 6, None, 2)],
    1014: [M("Hours to design a fitting", "lower", 20, 12, 40)],
    1015: [M("Service-part stock-outs per month", "lower", 6, 3, 14), M("Forecast error (%)", "lower", 15, None, 30)],
}


def _ms(key: int) -> list[dict]:
    """A fresh copy of a sample case's KPIs (the engine may change the lists it is given)."""
    return [dict(m) for m in MS[key]]


class _Builder:
    """Holds the sample being built and the helpers that drive the engine."""

    def __init__(self, now: int):
        self.NOW = now
        self.R = default_rules()
        self.cases: list[dict] = []  # each item is {"c": case}, so a step can replace the case
        self.tools: list[dict] = []
        self.n = 1000

    def T(self, days_ago) -> int:
        """The time ``days_ago`` days before now (days may be fractional, such as 58.5)."""
        t = self.NOW - days_ago * DAY
        return int(t) if float(t).is_integer() else t

    def ctx(self, days_ago) -> dict:
        return {"rules": self.R, "now": self.T(days_ago), "rv": 1}

    # ---- Building forms ----

    def yes(self, *ids, **over) -> dict:
        """Risk answers: yes to the listed yes/no questions, no to the others, safe picklist answers."""
        a = {q["id"]: (q["id"] in ids) if q["type"] == "yesno" else SAFE.get(q["id"]) for q in self.R["questions"]}
        if "q_ip" in ids:
            a["q_sens"] = "conf"
        if "q_pii" in ids:
            a["q_sens"] = "pers"
        a.update(over)
        return a

    def ready(self, *ids) -> dict:
        """Data readiness answers: the listed checks met (all of them when none are listed)."""
        return {x["id"]: (x["id"] in ids) if ids else True for x in self.R["readiness"]}

    def mk_form(self, **o) -> dict:
        """A complete sample form. Required controls are claimed and confirmers named automatically."""
        f = {"solution": "", "problem": "", "businessCase": "", "successMetric": "", "measures": [], "attesters": {}, "evidence": {}, "dataRequired": "",
             "process": "", "users": "", "owner": "", "ownerId": "", "sponsor": "", "valueUSD": 0, "costUSD": 0, "ongoingCostUSD": 0,
             "ongoingBasis": "total_year", "budgetSource": "Operations", "alternatives": "", "costOfNothing": "", "scope": "team", "autonomy": "advice",
             "answers": self.yes(), "readiness": self.ready(), "controls": ["c_log"]}
        f.update(o)
        if not truthy(f.get("ownerId")):
            p = next((x for x in PEOPLE if x["name"] == f["owner"]), None)
            f["ownerId"] = p["id"] if p else ""
        if not truthy(f.get("ucType")):
            f["ucType"] = "use"
        for nd in required_controls(f, self.R):
            if nd["id"] not in f["controls"]:
                f["controls"].append(nd["id"])
        for cid in f["controls"]:
            cl = CLAIM.get(cid)
            k = next((x for x in self.R["controls"] if x["id"] == cid), None)
            if cl and not truthy(f["attesters"].get(cid)):
                f["attesters"][cid] = cl[0]
            if cl and not truthy(f["evidence"].get(cid)):
                f["evidence"][cid] = cl[1]
            if k and k.get("attest") == "required" and not truthy(f["attesters"].get(cid)):
                f["attesters"][cid] = "p_jack"
        return f

    @staticmethod
    def acc(measures, extra=None) -> dict:
        """Approval terms: KPIs, the standard limits text, validity and review period."""
        return {"measures": measures, "limits": "Only the data, users and scope described in the use case. Any change to those returns it to the panel.",
                "validDays": 365, "prodDays": 90, **(extra or {})}

    # ---- Driving the engine ----

    def start(self, title, idea, sub, days_ago, legacy=True) -> dict:
        """A new suggestion. Cases 1 to 15 are "legacy": made before required consults existed, so none are triggered."""
        self.n += 1
        h = {"c": new_case("UC-" + str(self.n), title, idea, sub, self.T(days_ago), 1)}
        if legacy:
            h["c"]["legacy"] = True
        assign_adviser(h["c"], self.R)
        self.cases.append(h)
        return h

    def accept_all(self, h, inp: dict) -> dict:
        """Accept every open item with the standard reason for its kind (unless a reason is already given)."""
        out = dict(inp)
        for t in loose_threads(h["c"], self.R):
            if not truthy(out.get("ov_" + t["slug"])):
                out["ov_" + t["slug"]] = OVR[t["kind"]]
            out["ovc_" + t["slug"]] = True
        return out

    def step(self, h, days_ago, pid, act, inp=None) -> None:
        """Have person ``pid`` take action ``act`` on case ``h``, ``days_ago`` days ago."""
        inp = inp or {}
        ctx = self.ctx(days_ago)
        if act in ("panel_note", "exec_note"):
            inp = {"decision": inp.get("lean"), "strength": "firm" if inp.get("firm") else "leaning", "text": inp.get("text"), "__seed": True}
            act = "rv_vote"
        if act in FIN:
            # The approver first records a firm decision (saving the terms to the shared draft when approving).
            dr = {**self.accept_all(h, inp), "__seed": True}
            dr.pop("rationale", None)
            if FIN[act] in ("approve", "waive"):
                h["c"] = perform(h["c"], "review_draft", dr, by_id(pid), ctx)
            h["c"] = perform(h["c"], "rv_vote", {**dr, "decision": FIN[act], "strength": "firm", "text": js_or(inp.get("rationale"), "Agreed.")}, by_id(pid), ctx)
        if act == "develop" and pid == "p_jordan" and truthy(h["c"].get("adviserId")):
            pid = h["c"]["adviserId"]
        if act in ("panel_approve", "panel_waive", "panel_recommend", "exec_approve"):
            inp = self.accept_all(h, inp)
        if act == "attest":
            inp = dict(inp)
            for a in h["c"].get("attestations") or []:
                if a["personId"] == pid and a["status"] == "pending" and not truthy(inp.get("d_" + a["controlId"])):
                    inp["d_" + a["controlId"]] = "confirm"
        try:
            h["c"] = perform(h["c"], act, inp, by_id(pid), ctx)
            r = ensure_tool(h["c"], self.tools, self.T(days_ago), 1)
            if r:
                h["c"] = r["c"]
                self.tools.append(r["tool"])
        except Exception as e:  # say which sample step failed
            raise type(e)(h["c"]["id"] + " " + act + " by " + pid + ": " + str(e)) from e

    def consult(self, h, days_ago, smes, stk, q) -> None:
        self.step(h, days_ago, "p_elena", "consult", {"smes": smes, "stakeholders": stk, "question": q})

    def reply(self, h, days_ago, pid, stance, text) -> None:
        self.step(h, days_ago, pid, "respond", {"stance": stance, "text": text})

    def tool(self, by, days_ago, form, steps=None) -> None:
        """A catalog entry someone reported, then any status changes by the lead."""
        t = new_tool(next_tool_id(self.tools), by, self.T(days_ago + 1))
        t = perform_tool(t, "save_tool", {"form": form}, by_id(by), {"now": self.T(days_ago + 1)})
        if steps == "draft":
            self.tools.append(t)
            return
        t = perform_tool(t, "report_tool", {"form": {}}, by_id(by), {"now": self.T(days_ago)})
        for pid, dd, status, note in steps or []:
            t = perform_tool(t, "set_tool_status", {"status": status, "note": note}, by_id(pid), {"now": self.T(dd)})
        self.tools.append(t)

    def evid(self, case_id, days_ago, pid, control_id, f) -> None:
        h = next(x for x in self.cases if x["c"]["id"] == case_id)
        h["c"] = perform(h["c"], "add_evidence", {"controlId": control_id, **f}, by_id(pid), self.ctx(days_ago))


def build_seed(now: int) -> dict:
    """Build the full sample data set at time ``now``. JavaScript ``buildSeed``.

    Returns ``{cases, tools, files, rules, versions, meta}``.
    """
    b = _Builder(now)
    step, consult, reply, mk, acc, yes, ready = b.step, b.consult, b.reply, b.mk_form, b.acc, b.yes, b.ready

    # 1. Low risk, straight to production
    h = b.start("Summarize weekly shift notes", "Turn handwritten shift notes into a one-page weekly summary for plant managers.", "p_dana", 80)
    step(h, 79, "p_jordan", "develop", {"note": "Walked through the notes format with Dana."})
    step(h, 77, "p_dana", "submit", {"form": mk(ucType=UT[1001], measures=_ms(1001), ongoingCostUSD=1200, budgetSource="Plant operations", alternatives="Keep rewriting notes by hand.",
                                                costOfNothing="About 100 supervisor hours a year per line stay tied up.",
                                                solution="A language model reads the week's shift notes and drafts a one-page summary of output, downtime causes and open issues. Supervisors review and edit the draft before it goes to plant managers. It reads internal notes only and cannot write to any plant system.",
                                                problem="Supervisors spend two hours a week rewriting shift notes.", businessCase="Saves about 100 supervisor hours a year per line.",
                                                successMetric="Weekly summary produced in under 10 minutes.", dataRequired="Shift notes (internal, non-personal).", process="Plant operations",
                                                users="Line supervisors", owner="Dana Whitfield", sponsor="Hannah Cole", valueUSD=14000, costUSD=2000, scope="team", autonomy="advice",
                                                controls=["c_log", "c_access"])})
    step(h, 76, "p_elena", "vet_approve", {"note": "Low risk, internal data only.", **acc(_ms(1001), {"validDays": 60, "prodDays": 30})})
    step(h, 30, "p_elena", "monitor_ok", {"note": "Usage steady, no incidents.", "mv_m1": 8, "mv_m2": 4, "bias": "informal"})

    # 2. Moderate, full path to production through pilot
    h = b.start("Predictive maintenance alerts for the tank-welding line", "Flag welding equipment likely to fail before it stops the line.", "p_marcus", 74)
    step(h, 72, "p_jordan", "develop", {})
    step(h, 70, "p_marcus", "submit", {"form": mk(ucType=UT[1002], measures=_ms(1002), ongoingCostUSD=18000, budgetSource="Plant operations", alternatives="Time-based maintenance schedule.",
                                                  costOfNothing="Unplanned stoppages continue at roughly 40 production hours a year.", attesters={"c_test": "p_jack"},
                                                  evidence={"c_test": "Backtest on 18 months of welder history, report TR-2041"},
                                                  solution="Software trained on welder sensor history and maintenance logs scores each welder daily and sends an alert to maintenance technicians when a failure looks likely. It only sends alerts and cannot stop or change any equipment. All data stays on the plant network.",
                                                  problem="Unplanned welder stoppages cost roughly 40 production hours a year.", businessCase="Cut unplanned downtime by a third.",
                                                  successMetric="Unplanned stoppages down 30% in 12 months.", dataRequired="Machine sensor history, maintenance logs.", process="Tank welding",
                                                  users="Maintenance technicians", owner="Marcus Lee", sponsor="Margaret Hale", valueUSD=220000, costUSD=60000, scope="site", autonomy="assist",
                                                  answers=yes("q_hall"), controls=["c_human", "c_test", "c_log"])})
    step(h, 68, "p_elena", "vet_to_panel", {"note": "Needs operations and security input."})
    consult(h, 67, ["p_jack", "p_ravi"], ["p_hannah"], "Is the alert threshold safe, and can sensor data leave the plant network?")
    reply(h, 65, "p_jack", "support", "Thresholds look reasonable. Start with alerts only, no automatic shutdowns.")
    reply(h, 64, "p_ravi", "concerns", "Keep sensor data on the plant network. Review the vendor hosting terms.")
    reply(h, 64, "p_hannah", "support", "Maintenance leads are asking for this.")
    step(h, 66, "p_jack", "attest", {"d_c_test": "confirm", "text": "I reviewed the backtest on 18 months of welder history. Results hold."})
    step(h, 63, "p_sam", "panel_note", {"firm": True, "lean": "approve", "text": "Payback is under a year on the stated numbers."})
    step(h, 62, "p_elena", "panel_approve", {"rationale": "Value is clear and risk is contained with alerts only.", "scope": "Alerts only on welding line 2 for six weeks.", "days": 30,
                                             **acc(_ms(1002), {"prodDays": 90})})
    step(h, 31, "p_elena", "pilot_promote", {"note": "Caught two real faults during the pilot.", "mv_m1": 3, "mv_m2": 4})

    # 3. High, in panel, expert response overdue
    h = b.start("Homeowner troubleshooting chatbot", "A chat assistant that walks homeowners through common water heater problems.", "p_priya", 28)
    step(h, 26, "p_jordan", "develop", {})
    step(h, 25, "p_priya", "submit", {"form": mk(ucType=UT[1003], measures=_ms(1003), ongoingCostUSD=48000, budgetSource="Customer service", alternatives="Longer call center hours; a better FAQ page.",
                                                 costOfNothing="Wait times keep rising and routine calls cost about $9 each.", attesters={"c_test": "p_jack"},
                                                 evidence={"c_test": "Transcript test set results, report TR-2077"},
                                                 solution="A chat assistant on the support website answers homeowner questions about common water heater problems using product manuals and warranty terms. It suggests next steps and can hand the chat to a call agent. It cannot approve warranty claims or schedule repairs. Chat transcripts are processed and stored by an outside vendor.",
                                                 problem="Call center handles 3,000 routine troubleshooting calls a month.", businessCase="Deflect a third of routine calls and shorten waits.",
                                                 successMetric="Deflection rate and customer satisfaction score.", dataRequired="Product manuals, warranty terms, chat transcripts.",
                                                 process="Customer service", users="Homeowners and call agents", owner="Priya Nair", sponsor="Victor Shaw", valueUSD=310000, costUSD=90000,
                                                 scope="customer", autonomy="assist", answers=yes("q_hall", "q_pii", "q_us", "q_share"), readiness=ready("r_access", "r_steward", "r_quality"),
                                                 controls=["c_test", "c_log", "c_access"])})
    step(h, 23, "p_elena", "vet_to_panel", {"note": "Customer-facing, so full panel."})
    consult(h, 20, ["p_claire", "p_ravi"], ["p_luis"], "Do we need consent for chat transcripts, and is the vendor setup acceptable?")
    reply(h, 18, "p_ravi", "concerns", "Transcripts must be masked before they reach the vendor.")
    step(h, 16, "p_sam", "panel_note", {"lean": "remediate", "text": "Wait for the legal view on consent before deciding."})

    # 4. Moderate, in pilot
    h = b.start("Anode rod inventory forecasting", "Forecast anode rod demand so the plant stops running short.", "p_dana", 52)
    step(h, 50, "p_jordan", "develop", {})
    step(h, 48, "p_dana", "submit", {"form": mk(ucType=UT[1004], measures=_ms(1004), attesters={"c_test": "p_tamika"},
                                                evidence={"c_test": "Back-test of forecast against two years of orders, sheet FC-12"},
                                                solution="A forecasting model uses purchase history and the production plan to predict anode rod demand by month and suggests order quantities. Planners compare the forecast with their own numbers and place the orders themselves.",
                                                problem="Anode rod shortages halted assembly twice last year.", businessCase="Avoid stoppages and cut rush shipping.",
                                                successMetric="Zero stock-outs in a quarter.", dataRequired="Purchase history, production plan.", process="Plant supply planning", users="Planners",
                                                owner="Dana Whitfield", sponsor="Hannah Cole", valueUSD=85000, costUSD=15000, scope="site", autonomy="advice", answers=yes("q_hall"),
                                                controls=["c_human", "c_test"])})
    step(h, 46, "p_elena", "vet_to_panel", {})
    step(h, 44, "p_naomi", "panel_note", {"firm": True, "lean": "approve", "text": "Data is clean and the model is simple."})
    step(h, 43, "p_elena", "panel_approve", {"rationale": "Low-regret forecast with a person checking every order.", "scope": "Planners compare forecasts against their own for 45 days.",
                                             "days": 45, **acc(_ms(1004), {"prodDays": 60})})

    # 5. High, in pilot with one rework
    h = b.start("Weld seam vision inspection", "Cameras check every tank weld and flag defects.", "p_marcus", 90)
    step(h, 88, "p_jordan", "develop", {})
    step(h, 86, "p_marcus", "submit", {"form": mk(ucType=UT[1005], measures=_ms(1005), ongoingCostUSD=30000, budgetSource="Product engineering", alternatives="Add a second human inspector per shift.",
                                                  costOfNothing="About 1 in 200 defects keep reaching customers.", attesters={"c_test": "p_tamika"},
                                                  evidence={"c_test": "Test on 5,000 labeled seam images, report QA-318"},
                                                  solution="Cameras at the weld station photograph every tank seam and an image model flags seams that look defective. Inspectors confirm every flag before a tank is rejected. The images show tank designs and are stored on site only.",
                                                  problem="Manual weld inspection misses about 1 in 200 defects.", businessCase="Fewer leaks in the field and lower warranty cost.",
                                                  successMetric="Escaped defects down 50%.", dataRequired="Weld images, inspection results, design tolerances.", process="Tank welding and quality",
                                                  users="Quality inspectors", owner="Marcus Lee", sponsor="Tamika Rowe", valueUSD=480000, costUSD=210000, scope="site", autonomy="assist",
                                                  answers=yes("q_hall", "q_ip"), controls=["c_human", "c_test", "c_access", "c_log"])})
    step(h, 84, "p_elena", "vet_to_panel", {})
    consult(h, 83, ["p_ravi", "p_jack"], ["p_tamika"], "Camera images show tank designs. Is the storage plan acceptable?")
    reply(h, 80, "p_ravi", "support", "On-site storage only is acceptable.")
    reply(h, 80, "p_jack", "support", "Fits the line layout.")
    step(h, 81, "p_tamika", "attest", {"d_c_test": "confirm", "text": "Seam test set was labeled by two inspectors. Results are in report QA-318."})
    step(h, 79, "p_sam", "panel_note", {"firm": True, "lean": "approve", "text": "Strong value."})
    step(h, 78, "p_naomi", "panel_note", {"firm": True, "lean": "approve", "text": "Image storage stays on site."})
    step(h, 77, "p_elena", "panel_approve", {"rationale": "Value is high and image data stays on site.", "scope": "One weld station, inspectors confirm every flag.", "days": 45,
                                             **acc([_ms(1005)[0], M("False alarm rate (%)", "lower", 8, 5, 12)], {"prodDays": 45})})
    step(h, 30, "p_elena", "pilot_rework", {"note": "False alarm rate is too high on night shift. Retune and rerun.", "mv_m1": 30, "mv_m2": 13})

    # 6. Moderate, awaiting vetting
    h = b.start("Compliance document drafting assistant", "Draft first versions of product compliance filings.", "p_priya", 4)
    step(h, 3, "p_jordan", "develop", {})
    step(h, 1, "p_priya", "submit", {"form": mk(ucType=UT[1006], measures=_ms(1006), attesters={"c_human": "p_tamika"},
                                                evidence={"c_human": "Compliance team reviews every draft, procedure CP-9"},
                                                solution="A language model drafts the first version of product compliance filings from prior filings and standards text. A compliance specialist reviews and edits every draft before it is submitted.",
                                                problem="Compliance filings take a specialist three days each.", businessCase="Halve drafting time.", successMetric="Draft ready in under one day.",
                                                dataRequired="Prior filings, standards text.", process="Product compliance", users="Compliance specialists", owner="Priya Nair",
                                                sponsor="Victor Shaw", valueUSD=60000, costUSD=20000, scope="site", autonomy="assist", answers=yes("q_hall"), controls=["c_human", "c_log"])})

    # 7. Critical, with executives (briefing pack ready, decision overdue)
    h = b.start("Burner test parameter auto-tuning", "Let software adjust burner test settings to hit target efficiency automatically.", "p_marcus", 40)
    step(h, 38, "p_jordan", "develop", {})
    step(h, 36, "p_marcus", "submit", {"form": mk(ucType=UT[1007], measures=_ms(1007), attesters={"c_test": "p_jack"}, evidence={"c_test": "Rig trials within the fixed range, report TR-2102"},
                                                  solution="Software reads sensor data from the test rig during burner efficiency tests and automatically adjusts burner settings, within a fixed range, to reach the target efficiency. A test technician can override at any time and every adjustment is logged.",
                                                  problem="Manual tuning of burner tests takes 25 minutes per unit.", businessCase="Cut test time by 60% and improve consistency.",
                                                  successMetric="Test time per unit and rework rate.", dataRequired="Test rig sensor data, efficiency targets.", process="Final assembly test",
                                                  users="Test technicians", owner="Marcus Lee", sponsor="Margaret Hale", valueUSD=650000, costUSD=280000, scope="site", autonomy="automate",
                                                  answers=yes("q_ot", "q_hall", "q_ip"), controls=["c_human", "c_test", "c_access", "c_log", "c_kill"])})
    step(h, 34, "p_elena", "vet_to_panel", {"note": "Changes equipment settings, so critical."})
    consult(h, 33, ["p_ravi", "p_jack"], ["p_hannah"], "Safety limits and control access for automatic adjustments.")
    reply(h, 30, "p_ravi", "concerns", "Settings changes must be limited to a fixed safe range.")
    reply(h, 29, "p_jack", "support", "Technicians can override at any time.")
    step(h, 30, "p_jack", "attest", {"d_c_test": "confirm", "text": "Rig trials stayed inside the fixed range."})
    step(h, 28, "p_sam", "panel_note", {"firm": True, "lean": "approve", "text": "Good value if limits are hard-coded."})
    step(h, 27, "p_naomi", "panel_note", {"firm": True, "lean": "approve", "text": "Access controls are in place."})
    step(h, 26, "p_elena", "panel_recommend", {"rationale": "Approve a limited pilot with hard safety limits.", "scope": "One test rig, settings limited to a fixed safe range.", "days": 60,
                                               **acc(_ms(1007))})

    # 8. Returned from triage (safety gate)
    h = b.start("Supplier negotiation assistant", "Draft counter-offers using past contract prices.", "p_dana", 14)
    step(h, 12, "p_jordan", "develop", {})
    step(h, 10, "p_dana", "submit", {"form": mk(ucType=UT[1008], measures=_ms(1008),
                                                solution="A language model drafts counter-offers for buyers using past contract prices and price lists. Contract text would be sent to an outside model provider. Buyers review every draft before it is sent to a supplier.",
                                                problem="Buyers prepare counter-offers by hand.", businessCase="Better prices and faster cycles.", successMetric="Average price improvement.",
                                                dataRequired="Past contracts and price lists.", process="Procurement", users="Buyers", owner="Dana Whitfield", sponsor="Victor Shaw",
                                                valueUSD=120000, costUSD=30000, scope="company", autonomy="assist", answers=yes("q_train", "q_hall", q_svc="pub", q_sens="conf"),
                                                controls=["c_human"])})

    # 9. Closed: rejected by panel
    h = b.start("Resume screening assistant", "Rank incoming resumes for open plant roles.", "p_priya", 70)
    step(h, 69, "p_jordan", "develop", {})
    step(h, 66, "p_priya", "submit", {"form": mk(ucType=UT[1009], measures=_ms(1009),
                                                 solution="A model ranks incoming resumes for open plant roles using past hiring outcomes and gives recruiters a ranked shortlist. Recruiters make the final screening decision.",
                                                 problem="Recruiters screen hundreds of resumes per role.", businessCase="Shorten time to hire.", successMetric="Days to fill a role.",
                                                 dataRequired="Resumes and past hiring outcomes.", process="Recruiting", users="Recruiters", owner="Priya Nair", sponsor="Victor Shaw",
                                                 valueUSD=40000, costUSD=25000, scope="company", autonomy="assist", answers=yes("q_people", "q_pii", "q_hall"), controls=["c_human"])})
    step(h, 64, "p_elena", "vet_to_panel", {})
    consult(h, 63, ["p_claire"], [], "Fairness and employment law exposure.")
    reply(h, 60, "p_claire", "serious", "Ranking candidates creates real discrimination risk that our controls do not cover.")
    step(h, 59, "p_sam", "panel_note", {"firm": True, "lean": "reject", "text": "Value is modest next to the legal risk."})
    step(h, 58.5, "p_naomi", "panel_note", {"firm": True, "lean": "reject", "text": "The consent problem cannot be fixed with controls."})
    step(h, 58, "p_elena", "panel_reject", {"rationale": "Legal exposure outweighs the modest value. Resubmit with a narrower scope if needed."})

    # 10. Suggestion only
    b.start("Voice notes for service technicians", "Let field technicians dictate job notes that become clean service records.", "p_priya", 3)

    # 11. Use case draft in progress
    h = b.start("Test lab energy forecasting", "Predict test lab energy use to schedule heavy tests off-peak.", "p_dana", 9)
    step(h, 6, "p_jordan", "develop", {"note": "Dana will fill in the details this week."})
    step(h, 5, "p_dana", "save_draft", {"form": {"solution": "A forecasting model predicts test lab energy use from the test schedule and utility rates and suggests moving heavy tests to off-peak hours. A lab scheduler approves every schedule change.",
                                                 "problem": "Peak energy charges are high during afternoon tests.", "businessCase": "Shift tests to off-peak hours.", "owner": "Dana Whitfield"}})
    step(h, 2, "p_dana", "save_draft", {"form": {"measures": _ms(1011), "owner": "Hannah Cole", "ownerId": "p_hannah"}})
    step(h, 2, "p_dana", "submit", {})

    # 12. Back to panel from pilot
    h = b.start("Warranty claim triage", "Sort incoming warranty claims and suggest which need a technician visit.", "p_priya", 75)
    step(h, 73, "p_jordan", "develop", {})
    step(h, 72, "p_priya", "submit", {"form": mk(ucType=UT[1012], measures=_ms(1012), ongoingCostUSD=36000, budgetSource="Warranty operations", attesters={"c_test": "p_jack"},
                                                 evidence={"c_test": "Test on 2,000 past claims with photos, report WC-5"},
                                                 solution="A model reads incoming warranty claims and photos, sorts them by type and suggests whether a technician visit is needed. Warranty agents confirm every suggestion before acting. Customer addresses are masked before processing.",
                                                 problem="Claims wait days for a first review.", businessCase="Faster resolution and fewer repeat visits.", successMetric="Days to first response.",
                                                 dataRequired="Claim history and photos.", process="Warranty", users="Warranty agents", owner="Luis Garcia", ownerId="p_luis", sponsor="Victor Shaw",
                                                 valueUSD=190000, costUSD=70000, scope="company", autonomy="assist", answers=yes("q_pii", "q_hall"), controls=["c_human", "c_test", "c_log"])})
    step(h, 71, "p_luis", "signoff_accept", {})
    step(h, 69, "p_elena", "vet_to_panel", {})
    step(h, 69, "p_jack", "attest", {"d_c_test": "confirm", "text": "Claims test set matches the live mix of photos."})
    consult(h, 68, ["p_claire"], ["p_hannah"], "Claim photos contain customer addresses.")
    reply(h, 66, "p_claire", "support", "Fine if addresses are masked.")
    reply(h, 66, "p_hannah", "support", "Service teams would use this daily.")
    step(h, 64, "p_sam", "panel_note", {"firm": True, "lean": "approve", "text": "Clear value."})
    step(h, 63, "p_naomi", "panel_note", {"firm": True, "lean": "approve", "text": "Masking plan is sound."})
    step(h, 62, "p_elena", "panel_approve", {"rationale": "Approved with address masking.", "scope": "Two regions, agents confirm every suggestion.", "days": 45, **acc(_ms(1012), {"prodDays": 60})})
    step(h, 4, "p_elena", "pilot_escalate", {"note": "Pilot data shows the tool also reads customer emails. That is beyond what was approved."})

    # 13. Pilot waived, in production
    h = b.start("Customer feedback summarizer", "Summarize survey comments into monthly themes.", "p_priya", 55)
    step(h, 54, "p_jordan", "develop", {})
    step(h, 53, "p_priya", "submit", {"form": mk(ucType=UT[1013], measures=_ms(1013),
                                                 solution="A language model groups survey comments, with names removed, into monthly themes and a short summary for product teams. A person reads each summary before it is shared.",
                                                 problem="Survey comments pile up unread.", businessCase="Product teams see themes monthly.", successMetric="Monthly theme report delivered.",
                                                 dataRequired="Survey comments with names removed.", process="Customer service", users="Product teams", owner="Victor Shaw", ownerId="p_victor",
                                                 sponsor="Victor Shaw", valueUSD=30000, costUSD=5000, scope="company", autonomy="assist", answers=yes("q_hall"), controls=["c_human", "c_log", "c_access"])})
    step(h, 53, "p_victor", "signoff_decline", {"note": "The licence cost is not in this year's budget yet. Add the cost and confirm the product teams will use the themes."})
    step(h, 52, "p_priya", "submit", {"form": {"costUSD": 12000}})
    step(h, 52, "p_victor", "signoff_accept", {})
    step(h, 50, "p_elena", "vet_to_panel", {})
    step(h, 48, "p_sam", "panel_note", {"firm": True, "lean": "waive", "text": "Names are stripped and output is read by a person."})
    step(h, 47, "p_elena", "panel_waive", {"rationale": "Low consequence and reversible.", "waiver": "Output is internal and a person reads every summary, so a pilot adds little.",
                                           **acc(_ms(1013), {"prodDays": 90})})

    # 14. High, in panel, expert pending overdue
    h = b.start("CAD design assistant", "Suggest design alternatives for tank fittings from existing drawings.", "p_marcus", 20)
    step(h, 18, "p_jordan", "develop", {})
    step(h, 17, "p_marcus", "submit", {"form": mk(ucType=UT[1014], measures=_ms(1014), ongoingCostUSD=260, ongoingBasis="per_user_month", budgetSource="Product engineering",
                                                  alternatives="Shared drawing library with better search.",
                                                  solution="An assistant reviews existing CAD drawings of tank fittings and proposes design alternatives to engineers. Drawings would be processed by an outside vendor. Engineers decide which ideas to use.",
                                                  problem="Engineers rebuild similar fitting designs from scratch.", businessCase="Faster design iterations.", successMetric="Hours per design revision.",
                                                  dataRequired="Internal CAD drawings.", process="Product engineering", users="Design engineers", owner="Marcus Lee", sponsor="Ines Alvarez",
                                                  valueUSD=260000, costUSD=80000, scope="site", autonomy="assist", answers=yes("q_ip", "q_us", "q_hall", "q_share"), controls=["c_human", "c_access"])})
    step(h, 15, "p_elena", "vet_to_panel", {})
    consult(h, 13, ["p_ravi"], ["p_tamika"], "Drawings would be processed by a vendor outside the U.S. Is that acceptable?")
    step(h, 9, "p_naomi", "panel_note", {"lean": "remediate", "text": "Ask the vendor for a U.S. hosting option."})

    # 15. Returned from monitoring
    h = b.start("Spare parts demand forecasting", "Forecast service parts demand by region.", "p_dana", 120)
    step(h, 118, "p_jordan", "develop", {})
    step(h, 115, "p_dana", "submit", {"form": mk(ucType=UT[1015], measures=_ms(1015), attesters={"c_test": "p_tamika"}, evidence={"c_test": "Back-test by region, sheet FC-31"},
                                                 solution="A forecasting model uses service history and shipment data to predict spare parts demand by region and recommends stock levels. Planners review the recommendations before ordering.",
                                                 problem="Service parts are out of stock in some regions.", businessCase="Fewer repeat visits.", successMetric="Parts availability at first visit.",
                                                 dataRequired="Service history, shipment data.", process="Field service", users="Planners", owner="Dana Whitfield", sponsor="Hannah Cole",
                                                 valueUSD=140000, costUSD=40000, scope="company", autonomy="advice", answers=yes("q_hall"), controls=["c_human", "c_test"])})
    step(h, 113, "p_elena", "vet_to_panel", {})
    step(h, 112, "p_tamika", "attest", {"d_c_test": "decline", "text": "The back-test covered only one region, so I cannot confirm the control as described."})
    step(h, 111, "p_sam", "panel_note", {"firm": True, "lean": "approve", "text": "Good value."})
    step(h, 110, "p_elena", "panel_approve", {"rationale": "Approved.", "scope": "Two regions for 30 days.", "days": 30, **acc(_ms(1015), {"prodDays": 45})})
    step(h, 78, "p_elena", "pilot_promote", {"mv_m1": 5, "mv_m2": 18})
    step(h, 2, "p_dana", "monitor_reassess", {"note": "We are adding a new data source from a distributor, so the risk picture changed."})

    # 16 and 17 are not flagged legacy, so the required consults (AI safety, Data steward) trigger on their answers.
    # 16. Awaiting vetting: two required consults are triggered and not yet requested
    h = b.start("Support email auto-responder", "Read customer emails and send a first reply, and open warranty tickets on its own.", "p_priya", 4, legacy=False)
    step(h, 3, "p_jordan", "develop", {})
    step(h, 2, "p_priya", "submit", {"form": mk(ucType="model", measures=_ms(1012), attesters={"c_human": "p_tamika"}, evidence={"c_human": "Agents review every reply before it is sent, procedure CS-4"},
                                                solution="A language model reads incoming customer emails, drafts a reply and opens a warranty ticket through the ticket system connector. Agents review replies before they go out.",
                                                problem="First replies take two days.", businessCase="Cut first-reply time to hours.", successMetric="Median first reply under 4 hours.",
                                                dataRequired="Customer emails with names and addresses.", process="Customer service", users="Support agents", owner="Priya Nair", sponsor="Victor Shaw",
                                                valueUSD=80000, costUSD=25000, scope="site", autonomy="assist", answers=yes("q_outside", "q_tools", "q_model", "q_pii"), controls=["c_human", "c_log"])})
    # 17. In panel: required consults requested, one answered, one still holding the decision; a recommended one does not hold it
    h = b.start("Supplier portal assistant", "Answer supplier questions from the portal and update purchase orders.", "p_dana", 12, legacy=False)
    step(h, 11, "p_jordan", "develop", {})
    step(h, 10, "p_dana", "submit", {"form": mk(ucType="model", measures=_ms(1009), attesters={"c_human": "p_tamika"}, evidence={"c_human": "Buyers confirm every purchase order change, procedure PR-7"},
                                                solution="A language model answers supplier questions typed into the portal and can update purchase order dates through the ordering system connector. Buyers confirm every change.",
                                                problem="Buyers spend hours on routine supplier questions.", businessCase="Free buyer time.", successMetric="Hours saved per buyer per week.",
                                                dataRequired="Supplier messages, purchase orders.", process="Purchasing", users="Buyers", owner="Dana Whitfield", sponsor="Victor Shaw",
                                                valueUSD=50000, costUSD=15000, scope="site", autonomy="assist", answers=yes("q_outside", "q_tools", "q_model", "q_pii"), controls=["c_human", "c_log"])})
    step(h, 9, "p_elena", "vet_to_panel", {"note": "Outside input and an action path: AI safety and the data steward must weigh in."})
    consult(h, 8, ["p_mina", "p_omar", "p_claire"], [], "Outside supplier text reaches a model that can change purchase orders. Please assess.")
    reply(h, 6, "p_omar", "support", "Supplier contact data stays in the ordering system. No new sharing.")

    # 18. In panel: shares data with another company, so the Legal consult is required and still pending
    h = b.start("Supplier demand sharing", "Send our weekly parts forecast and open orders to two key suppliers so they can plan capacity.", "p_dana", 8, legacy=False)
    step(h, 7, "p_jordan", "develop", {})
    step(h, 6, "p_dana", "submit", {"form": mk(ucType="use", measures=_ms(1015), attesters={"c_test": "p_tamika"}, evidence={"c_test": "Forecast back-test by part family, sheet FC-40"},
                                               solution="A weekly job packages our parts forecast and open purchase orders and sends them to two named suppliers through their portals, so they can plan capacity. Planners review each file before it goes out.",
                                               problem="Suppliers plan capacity blind and miss our peaks.", businessCase="Fewer late deliveries and less expediting.",
                                               successMetric="On-time delivery from these suppliers.", dataRequired="Forecast by part, open purchase orders, supplier IDs.",
                                               process="Purchasing and planning", users="Planners, two suppliers", owner="Dana Whitfield", sponsor="Victor Shaw", valueUSD=70000, costUSD=10000,
                                               scope="site", autonomy="assist", answers=yes("q_share"), controls=["c_human", "c_log"])})
    step(h, 5, "p_elena", "vet_to_panel", {"note": "Shares company data with suppliers, so Legal must verify consent."})
    consult(h, 4, ["p_claire"], [], "Company forecast and order data would go to two suppliers. Please verify that consent to share it has been given and that the supplier terms cover it.")

    # AI tool catalog: three created by use cases above, plus tools people reported.
    b.tool("p_hannah", 45, {"name": "Meeting transcription assistant", "vendor": "Example Voice Co.", "purpose": "Records and transcribes team meetings and drafts action lists.",
                            "users": "Production supervisors", "accessNote": "Ask your manager to request a seat from IT.", "link": "", "ownerId": "p_hannah"})
    b.tool("p_marcus", 30, {"name": "Engineering chat assistant", "vendor": "Example Models Inc.", "purpose": "General question-and-answer help for engineers, used in the browser.",
                            "users": "Product engineering", "accessNote": "Free web account. Not provided by IT.", "link": "", "ownerId": "p_marcus"},
           [["p_elena", 20, "review", "Checking what data engineers paste into it."]])
    b.tool("p_priya", 25, {"name": "Email translation plug-in", "vendor": "Example Language Ltd.", "purpose": "Translates customer emails for the support team.",
                           "users": "Customer service", "accessNote": "", "link": "", "ownerId": "p_priya"},
           [["p_elena", 12, "not_approved", "Customer emails leave the company. Use the approved translation service instead."]])
    b.tool("p_dana", 60, {"name": "Spreadsheet formula helper", "vendor": "Example Office Suite", "purpose": "Suggests formulas inside the company spreadsheet program.",
                          "users": "Plant planners", "accessNote": "Included with the company spreadsheet license.", "link": "", "ownerId": "p_naomi"},
           [["p_elena", 50, "approved", "Runs inside the company tenant."]])
    b.tool("p_luis", 3, {"name": "Field note dictation app", "vendor": "Example Voice Co.", "purpose": "Draft only.", "users": "Field service", "accessNote": "", "link": "", "ownerId": "p_luis"}, "draft")

    # Evidence attached to controls: links and one small sample file.
    note = "QA-318 summary: 5,000 labeled weld seam images, two inspectors, 97% agreement with inspector decisions.\n"
    files = [{"id": "F-1001", "caseId": "UC-1005", "name": "QA-318-summary.txt", "type": "text/plain", "size": len(note),
              "data": "data:text/plain;charset=utf-8," + quote(note, safe="-_.!~*'()")}]  # quote() with these safe characters is encodeURIComponent
    b.evid("UC-1005", 82, "p_tamika", "c_test", {"fileId": "F-1001", "fileName": "QA-318-summary.txt", "size": len(note), "type": "text/plain", "note": "Short summary of the seam test."})
    b.evid("UC-1005", 81, "p_marcus", "c_test", {"url": "https://example.com/reports/QA-318", "note": "Full report."})
    b.evid("UC-1002", 66, "p_jack", "c_test", {"url": "https://example.com/reports/TR-2041"})

    # Training records: everyone has done the introduction except the new hire, Tomas.
    training = {}
    for p in PEOPLE:
        if p["id"] == "p_tomas":
            continue
        training[p["id"]] = {"t_intro": {"at": now - 40 * DAY, "ver": "2026.1"}}
        if p["role"] in ("submitter", "adviser"):
            training[p["id"]]["t_safe"] = {"at": now - 20 * DAY, "ver": "2026.1"}
    return {"cases": [h["c"] for h in b.cases], "tools": b.tools, "files": files, "rules": b.R,
            "versions": [{"n": 1, "at": b.T(130), "by": "system", "reason": "Initial sample rules", "summary": ["Initial sample rules."], "json": js_json(b.R)}],
            "meta": {"clockOffsetMs": 0, "seededAt": now, "training": training}}
