# AURA team update: SME experts, scenario loader and case page redesign

**Date:** November 11, 2026. **Please review by Friday prep.** Nothing has been merged into Renu's `main`; her repository is untouched.

## 1. Where the changes live

Fork (public, invented data only): https://github.com/dev4-gpt/aura-mvp

| What | Link |
|---|---|
| **Baseline:** branch `uat/scenarios-2026-11`. Renu's `main` plus the new experts, the scenario loader and the grouped Viewing as menu | https://github.com/dev4-gpt/aura-mvp/tree/uat/scenarios-2026-11 |
| **Case page redesign:** branch `ui/case-page-redesign`. The baseline plus the redesign | https://github.com/dev4-gpt/aura-mvp/tree/ui/case-page-redesign |
| What the redesign changed | https://github.com/dev4-gpt/aura-mvp/compare/uat/scenarios-2026-11...ui/case-page-redesign |
| Design note: what we found and why each change | https://github.com/dev4-gpt/aura-mvp/blob/ui/case-page-redesign/docs/design/case-page-redesign.md |
| Renu's original, for comparison (`main` at `01d3639`) | https://github.com/RenuBandaru/aura-mvp |

## 2. What changed in AURA, and why

- **Seven new sample experts:** Contracts, IP, Product engineering and firmware, Connected products, Marketing, Sales, Customer service. The client named specialists for these areas, and AURA had nobody to route those questions to.
- **Opt-in scenario data:** `python api/dev_server.py --scenarios FILE` loads test cases, each built through the real workflow so it has a real audit trail. *Reset to sample data* brings them back. Without the flag, AURA runs as before.
- **Viewing as grouped by role, with titles:** as in the original wireframe.
- **Case page redesign (new branch only).** Walking a real customer-facing case through AURA showed 11 issues. The fixes:
  - **Holding panel:** "What is holding the decision" shows experts to answer, reviewers to decide, and confirmers to confirm.
  - **Next step:** buttons say why only a leaning decision is possible, plus a "Ready to decide?" checklist.
  - **Assessment:** one labeled remaining-risk number, conditions to clear, and a "what would change the tier" note.
  - **Controls:** proof states named apart (None yet / Note only / File attached).
  - **Experts:** each card shows the expert's area and their own question, plus an independence check.
  - **Template fields:** optional fields from the client's use-case template (tools, implementation plan, risks, worst case, stakeholders and SMEs, data volume and quality) and a full KPI table.
- **Tests:** all 4,667 pass. All decisions are computed in the API; the screens only display them.

## 3. How to run it (about 5 minutes)

```bash
git clone https://github.com/dev4-gpt/aura-mvp.git && cd aura-mvp
git checkout ui/case-page-redesign        # or uat/scenarios-2026-11 for the baseline
cd web && npm install && npm run build && cd ..
python api/dev_server.py --memory --scenarios docs/examples/uat-scenarios.example.json
```

Then open http://localhost:7071.

## 4. Please review

1. **Case page:** open **EX-03** (customer troubleshooting assistant with an expert hold) as Elena Duarte. Look at every tab: holding panel, checklist, Assessment (condition to clear, what would change the tier), Controls (proof states), Reviews (expert areas, their own questions, independence check). Is the holding panel and checklist clearer for the onsite demo? Should Monday's demo use the redesign branch or the baseline?
2. **Expert hold:** try **Record my decision** as Elena with *Firm* (AURA refuses while AI safety is pending). Switch to **Mina Kowalski**, choose **Respond to consult (required)** and answer, then switch back to Elena: the hold clears and the checklist updates. Does the flow make sense?
3. **Template fields:** in EX-03, check the Use case tab sections (Stakeholders, Tools and implementation, Costs, risks and data). Then switch to **Dana Whitfield**, open **EX-02** (a returned draft she can edit), and open the form's new **Template details** tab. Is anything missing from the client's template?

## 5. Decisions needed

1. **Template fields:** keep them in the redesign as built, or simplify before Monday?
2. **Technical owner and project SMEs:** show them in AURA as role titles (current) or as made-up personas?
3. **KPI targets:** should we ask the case sponsors for targets and stop limits on the remaining KPIs?
4. **Proposing to Renu's `main`:** when should we open a PR, and which branch?
