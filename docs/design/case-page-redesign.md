# Case page redesign notes and the UAT additions

**Branch:** `ui/case-page-redesign` (fork of `RenuBandaru/aura-mvp`). **Status:** built on branch `ui/case-page-redesign` (all eleven changes). The stable pre-redesign version is branch `uat/scenarios-2026-11` (tag `uat-baseline-2026-11-11`). Everything in this repository is invented sample data. No client data, names or cases are in this repository.

## What this branch adds, and why

| Addition | Why |
|---|---|
| Seven sample experts: Contracts, Intellectual property, Product engineering and firmware, Connected products engineering, Marketing and customer communications, Sales, Customer service (`constants.ADDED_EXPERTS`) | The client named specialists for these areas. AURA had experts only for cybersecurity, legal, IT standards, data, AI safety and operations, so consults in those areas had nobody to go to. Fictional names. |
| Opt-in scenario data: `python api/dev_server.py --scenarios FILE` (`aura_engine/scenario_seed.py`) | User acceptance testing needs realistic cases at specific stages without changing the default sample. Each scenario case is built by taking the real actions, so it has a real audit trail; *Reset to sample data* restores the sample plus the scenarios. `docs/examples/uat-scenarios.example.json` is an invented example. |
| Consult areas for the added experts (in the scenario file, not the default rules) | Routes questions to the new experts without changing the default rules or the build 27 equivalence checks. |
| **Viewing as** grouped by role, with each person's title | With 31 sample people, experts were indistinguishable ("Subject matter expert"). Matches build 27's wireframe. |
| Audit log filter accepts any case id | Scenario cases use ids other than `UC-…`. |

Tests: 4,657 pass. The two build 27 equivalence checks affected by the added people compare build 27's 24 people only (reason in the commit message).

## Why we looked at the case page

The client asked to run one of its real, customer-facing cases (a vendor AI support assistant) through the new process and AURA at an onsite review. Preparing it showed that AURA's intake form does not match the client's use-case template, and that the case page leaves people to work out what is holding a decision. We walked through the case as the governance lead and recorded what made it hard to explain.

## How the case page works today

- **Header:** case id, title, tier badge, stage bar (Suggestion → Use case → Vetting → Panel review → Executive review → Pilot → Production).
- **Right column:** *Next step* (the current person's actions) and *Facts* (stage, people, due date, *Waiting for*).
- **Six tabs:**
  - **Use case:** the form as one list.
  - **Assessment:** inherent score, tier, residual "after supported controls", and why.
  - **Controls and evidence:** claimed controls, status, confirmer and credit, plus an evidence list.
  - **Reviews and decisions:** quorum, holds, reviewer decisions, and expert cards with question and answer.
  - **Activity:** the audit trail with its hash-chain check.
  - **Emails:** the simulated outbox.
- **Decision flow:**
  1. Intake and triage set the tier.
  2. Vetting: only Low can be approved there.
  3. The lead consults experts. Required or held experts block firm decisions ("You cannot hold a firm decision yet. Waiting on 1 required expert response from …").
  4. The expert responds.
  5. Each reviewer records a decision in a six-tab dialog and must accept every open item with a reason ("Complete these before you hold an approval firm: …"). Changing shared terms sends others back to leaning ("Approval terms changed … please look again").
  6. Critical cases go from the panel to three executives, then to pilot.

## What we noticed

1. Expert cards say only "Expert", with no area.
2. Two residual numbers disagree: Assessment counts all claimed controls (Low); Controls counts proven ones only (High).
3. A control says "Has evidence" (typed note) while the Evidence list says "No evidence yet" (no file).
4. *Waiting for* mixes reviewers, experts and control confirmers.
5. A calculated condition to clear (for example, "add the tool to the approved list") is not shown on the case page.
6. No fields for parts of the client's template: tools and technologies, implementation plan, risks and concerns, worst case, stakeholders and project SMEs, data volume and quality.
7. The Use case tab is one long flat list.
8. The decision dialog is learned by trial and error; *Record my decision* opens even when a firm vote is impossible.
9. After switching *Viewing as* on the same case, the hold message once stayed until reload. Re-tested with normal timing: the page updates correctly; the stale view came from switching people before the expert's answer had finished saving.
10. Only some KPIs have targets and stop limits.
11. Nothing explains what would change the tier, which sponsors and reviewers need to discuss it.

## The redesign (sketch: [case-page-redesign-sketch.html](case-page-redesign-sketch.html))

| # | Change | Fixes | Effort |
|---|---|---|---|
| 1 | Expert area on every expert card | 1 | Screen only |
| 2 | One labeled residual (proven controls only) with the optimistic figure as detail | 2 | Screen only |
| 3 | Proof states named apart: None yet / Note only / File attached | 3 | Screen only |
| 4 | "What is holding the decision" panel: Answer (experts), Decide (panel), Confirm (controls) | 4 | Screen only |
| 5 | Condition to clear shown on the Assessment tab | 5 | Screen only |
| 6 | Template sections: stakeholders (technical owner, project SMEs, end users), tools and implementation, risks, worst case, data volume and quality | 6 | New form fields |
| 7 | Use case tab grouped in collapsible sections following the template | 7 | Screen plus new fields |
| 8 | Next step explains itself (disabled buttons say why) and a "Ready to decide?" checklist | 8 | Screen only |
| 9 | Independence check visible (no case stakeholder reviews their own case) | conflict of duty | Screen only |
| 10 | All template KPIs listed, "to confirm" where targets are missing | 10 | New fields |
| 11 | "What would change the tier" sensitivity | 11 | Small engine addition |

## Where each change lives in the code

- API (`api/aura_api/views.py`, decided on the server as the repository rules require): `holding_view`, `readiness_view`, `independence_view`, `tier_sensitivity`, `proof_of` / `support_with_proof`, all returned by `case_detail`. Tests: `tests/api/test_case_page_views.py`.
- Screens: `web/src/components/CaseRedesign.tsx` (holding panel, readiness checklist, proof chip, independence check, tier note), `CaseSections.tsx` (grouped Use case tab, KPI table, proof column, expert areas, labeled residual, conditions), `CasePage.tsx` (panel placement, firm-decision reason), `FormEditor.tsx` (new *Template details* section).
- Template fields are optional and stored under `form.template` (business area, technical owner, project SMEs, end users, tools, implementation plan, risks, worst case, data volume, data quality). They do not change the score and are absent from the default sample, so the build 27 equivalence checks are unchanged.
- Scenario files can give each consulted area its own question (`"questions": {"ca_ai": "..."}`).

## Open decisions (team)

1. Template fields now in this fork, or after the onsite as a proposal to `main`?
2. Show technical owner and project SMEs as fictional personas or as role titles?
3. Build the screen-only changes (1–5, 8, 9) first?
