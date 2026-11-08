// ===== SAMPLE DATA: invented, generic water heater manufacturer. Built by driving the engine. =====
function buildSeed(NOW) {
  const R = defaultRules(), cases = [], tools = [];
  let n = 1000;
  const T = d => NOW - d * DAY;
  // Answers for a sample case: yes to the listed yes/no questions, and the safe answer to every picklist unless overridden by a trailing object.
  const SAFE = { q_access: 'lim', q_listed: 'listed', q_svc: 'co', q_sens: 'int', q_code: 'none', q_target: 'na' };
  const UT = { 1001: 'use', 1002: 'build', 1003: 'vendor', 1004: 'model', 1005: 'build', 1006: 'use', 1007: 'build', 1008: 'use', 1009: 'vendor', 1011: 'model', 1012: 'model', 1013: 'use', 1014: 'use', 1015: 'model' };
  const CLAIM = { c_bounds: ['p_jack', 'Design review of the fixed limits'], c_validate: ['p_jack', 'Independent validation plan'], c_rollback: ['p_ravi', 'Backup and restore tested'], c_escalate: ['p_claire', 'Escalation path to a service agent'], c_share: ['p_claire', 'Data-sharing terms reviewed'] };
  const yes = (...args) => {
    const over = typeof args[args.length - 1] === 'object' ? args.pop() : {}, ids = args, a = {};
    R.questions.forEach(q => { a[q.id] = q.type === 'yesno' ? ids.includes(q.id) : SAFE[q.id]; });
    if (ids.includes('q_ip')) a.q_sens = 'conf'; if (ids.includes('q_pii')) a.q_sens = 'pers';
    return Object.assign(a, over);
  };
  const ready = (...ids) => { const r = {}; R.readiness.forEach(x => r[x.id] = ids.length ? ids.includes(x.id) : true); return r; };
  const mkForm = (o) => { const f = Object.assign({ solution: '', problem: '', businessCase: '', successMetric: '', measures: [], attesters: {}, evidence: {}, dataRequired: '', process: '', users: '', owner: '', ownerId: '', sponsor: '', valueUSD: 0, costUSD: 0, ongoingCostUSD: 0, ongoingBasis: 'total_year', budgetSource: 'Operations', alternatives: '', costOfNothing: '', scope: 'team', autonomy: 'advice', answers: yes(), readiness: ready(), controls: ['c_log'] }, o); if (!f.ownerId) { const p = PEOPLE.find(x => x.name === f.owner); f.ownerId = p ? p.id : ''; } if (!f.ucType) f.ucType = 'use'; requiredControls(f, R).forEach(nd => { if (!f.controls.includes(nd.id)) f.controls.push(nd.id); }); f.controls.forEach(id => { const cl = CLAIM[id], k = R.controls.find(x => x.id === id); if (cl && !f.attesters[id]) f.attesters[id] = cl[0]; if (cl && !f.evidence[id]) f.evidence[id] = cl[1]; if (k && k.attest === 'required' && !f.attesters[id]) f.attesters[id] = 'p_jack'; }); return f; };
  const M = (name, dir, target, scaleUp, stop) => ({ name, dir, target, scaleUp, stop });
  const ACC = (measures, _unused, extra) => Object.assign({ measures, limits: 'Only the data, users and scope described in the use case. Any change to those returns it to the panel.', validDays: 365, prodDays: 90 }, extra || {});

  const MS = {
    1001: [M('Minutes to produce the weekly summary', 'lower', 10, 5, 30), M('Supervisor edits per summary', 'lower', 5, null, 15)],
    1002: [M('Unplanned stoppages per quarter', 'lower', 4, 2, 8), M('False alerts per week', 'lower', 3, null, 10)],
    1003: [M('Deflection rate (%)', 'higher', 33, 45, 15), M('Customer satisfaction (1 to 5)', 'higher', 4.2, null, 3.6)],
    1004: [M('Stock-outs per quarter', 'lower', 0, null, 2), M('Forecast error (%)', 'lower', 12, 8, 25)],
    1005: [M('Escaped defects per 10,000 tanks', 'lower', 25, 15, 50), M('False alarm rate (%)', 'lower', 8, 5, 15)],
    1006: [M('Hours to produce a first draft', 'lower', 8, 4, 20)],
    1007: [M('Test minutes per unit', 'lower', 10, 8, 25), M('Rework rate (%)', 'lower', 2, 1, 5)],
    1008: [M('Average price improvement (%)', 'higher', 3, 5, 0)],
    1009: [M('Days to hire', 'lower', 30, 25, 50)],
    1011: [M('Peak energy charge ($ a month)', 'lower', 8000, 6000, 12000)],
    1012: [M('Hours to first response on a claim', 'lower', 24, 12, 72), M('Wrong technician-visit suggestions (%)', 'lower', 5, 2, 12)],
    1013: [M('Theme summaries read each month', 'higher', 6, null, 2)],
    1014: [M('Hours to design a fitting', 'lower', 20, 12, 40)],
    1015: [M('Service-part stock-outs per month', 'lower', 6, 3, 14), M('Forecast error (%)', 'lower', 15, null, 30)],
  };
  const MOE = { 1001: '+/- 2 minutes', 1002: '+/- 1 stoppage per quarter', 1003: '+/- 3 percentage points', 1004: '+/- 3%', 1005: '+/- 2 defects per 10,000 tanks', 1006: '+/- 1 hour', 1007: '+/- 1 minute', 1008: '+/- 0.5 percentage points', 1009: '+/- 3 days', 1011: '+/- $500', 1012: '+/- 4 hours', 1013: '+/- 1 summary', 1014: '+/- 2 hours', 1015: '+/- 1 stock-out per month' };
  const start = (title, idea, sub, d) => { const h = { c: newCase('UC-' + (++n), title, idea, sub, T(d), 1) }; h.c.legacy = true; assignAdviser(h.c, R); cases.push(h); return h; };
  const OVR = { declined: 'Accepted for the pilot; the confirmer will be asked again.', unsupported: 'Evidence is expected before the pilot starts.', missing: 'The owner will claim it during the pilot.', concern: 'Addressed through the pilot scope.', condition: 'Will be cleared before the next gate.' };
  const FIN = { panel_approve: 'approve', panel_waive: 'waive', panel_recommend: 'approve', panel_remediate: 'remediate', panel_reject: 'reject', panel_escalate: 'escalate' };
  const step = (h, d, pid, act, input) => { if (act === 'panel_note' || act === 'exec_note') { input = { decision: input.lean, strength: input.firm ? 'firm' : 'leaning', text: input.text, __seed: true }; act = 'rv_vote'; }
    if (FIN[act]) { const fin = Object.assign({}, input); looseThreads(h.c, R).forEach(t => { if (!fin['ov_' + t.slug]) fin['ov_' + t.slug] = OVR[t.kind]; fin['ovc_' + t.slug] = true; }); const dr = Object.assign({}, fin, { __seed: true }); delete dr.rationale; if (['approve', 'waive'].includes(FIN[act])) { h.c = perform(h.c, 'review_draft', dr, byId(pid), { rules: R, now: T(d), rv: 1 }); } h.c = perform(h.c, 'rv_vote', Object.assign({}, dr, { decision: FIN[act], strength: 'firm', text: input.rationale || 'Agreed.' }), byId(pid), { rules: R, now: T(d), rv: 1 }); }
    if (act === 'develop' && pid === 'p_jordan' && h.c.adviserId) pid = h.c.adviserId; if (['panel_approve', 'panel_waive', 'panel_recommend', 'exec_approve'].includes(act)) { input = Object.assign({}, input); looseThreads(h.c, R).forEach(t => { if (!input['ov_' + t.slug]) input['ov_' + t.slug] = OVR[t.kind]; input['ovc_' + t.slug] = true; }); } if (act === 'attest') { input = Object.assign({}, input); (h.c.attestations || []).filter(a => a.personId === pid && a.status === 'pending').forEach(a => { if (!input['d_' + a.controlId]) input['d_' + a.controlId] = 'confirm'; }); } try { h.c = perform(h.c, act, input || {}, byId(pid), { rules: R, now: T(d), rv: 1 }); const r = ensureTool(h.c, tools, T(d), 1); if (r) { h.c = r.c; tools.push(r.tool); } } catch (e) { throw new Error(h.c.id + ' ' + act + ' by ' + pid + ': ' + e.message); } };
  const consult = (h, d, smes, stk, q) => step(h, d, 'p_elena', 'consult', { smes, stakeholders: stk, question: q });
  const reply = (h, d, pid, stance, text) => step(h, d, pid, 'respond', { stance, text });

  // 1. Low risk, straight to production
  let h = start('Summarize weekly shift notes', 'Turn handwritten shift notes into a one-page weekly summary for plant managers.', 'p_dana', 80);
  step(h, 79, 'p_jordan', 'develop', { note: 'Walked through the notes format with Dana.' });
  step(h, 77, 'p_dana', 'submit', { form: mkForm({ ucType: UT[1001], measures: MS[1001], ongoingCostUSD: 1200, budgetSource: 'Plant operations', alternatives: 'Keep rewriting notes by hand.', costOfNothing: 'About 100 supervisor hours a year per line stay tied up.', solution: 'A language model reads the week\'s shift notes and drafts a one-page summary of output, downtime causes and open issues. Supervisors review and edit the draft before it goes to plant managers. It reads internal notes only and cannot write to any plant system.', problem: 'Supervisors spend two hours a week rewriting shift notes.', businessCase: 'Saves about 100 supervisor hours a year per line.', successMetric: 'Weekly summary produced in under 10 minutes.', dataRequired: 'Shift notes (internal, non-personal).', process: 'Plant operations', users: 'Line supervisors', owner: 'Dana Whitfield', sponsor: 'Hannah Cole', valueUSD: 14000, costUSD: 2000, scope: 'team', autonomy: 'advice', controls: ['c_log', 'c_access'] }) });
  step(h, 76, 'p_elena', 'vet_approve', Object.assign({ note: 'Low risk, internal data only.'  }, ACC(MS[1001], MOE[1001], { validDays: 60, prodDays: 30 })));
  step(h, 30, 'p_elena', 'monitor_ok', Object.assign({ note: 'Usage steady, no incidents.'  }, { mv_m1: 8, mv_m2: 4, bias: 'informal' }));

  // 2. Moderate, full path to production through pilot
  h = start('Predictive maintenance alerts for the tank-welding line', 'Flag welding equipment likely to fail before it stops the line.', 'p_marcus', 74);
  step(h, 72, 'p_jordan', 'develop', {});
  step(h, 70, 'p_marcus', 'submit', { form: mkForm({ ucType: UT[1002], measures: MS[1002], ongoingCostUSD: 18000, budgetSource: 'Plant operations', alternatives: 'Time-based maintenance schedule.', costOfNothing: 'Unplanned stoppages continue at roughly 40 production hours a year.', attesters: { c_test: 'p_jack' }, evidence: { c_test: 'Backtest on 18 months of welder history, report TR-2041' }, solution: 'Software trained on welder sensor history and maintenance logs scores each welder daily and sends an alert to maintenance technicians when a failure looks likely. It only sends alerts and cannot stop or change any equipment. All data stays on the plant network.', problem: 'Unplanned welder stoppages cost roughly 40 production hours a year.', businessCase: 'Cut unplanned downtime by a third.', successMetric: 'Unplanned stoppages down 30% in 12 months.', dataRequired: 'Machine sensor history, maintenance logs.', process: 'Tank welding', users: 'Maintenance technicians', owner: 'Marcus Lee', sponsor: 'Margaret Hale', valueUSD: 220000, costUSD: 60000, scope: 'site', autonomy: 'assist', answers: yes('q_hall'), controls: ['c_human', 'c_test', 'c_log'] }) });
  step(h, 68, 'p_elena', 'vet_to_panel', { note: 'Needs operations and security input.' });
  consult(h, 67, ['p_jack', 'p_ravi'], ['p_hannah'], 'Is the alert threshold safe, and can sensor data leave the plant network?');
  reply(h, 65, 'p_jack', 'support', 'Thresholds look reasonable. Start with alerts only, no automatic shutdowns.');
  reply(h, 64, 'p_ravi', 'concerns', 'Keep sensor data on the plant network. Review the vendor hosting terms.');
  reply(h, 64, 'p_hannah', 'support', 'Maintenance leads are asking for this.');
  step(h, 66, 'p_jack', 'attest', { d_c_test: 'confirm', text: 'I reviewed the backtest on 18 months of welder history. Results hold.' });
  step(h, 63, 'p_sam', 'panel_note', { firm: true, lean: 'approve', text: 'Payback is under a year on the stated numbers.' });
  step(h, 62, 'p_elena', 'panel_approve', Object.assign({ rationale: 'Value is clear and risk is contained with alerts only.', scope: 'Alerts only on welding line 2 for six weeks.', days: 30  }, ACC(MS[1002], MOE[1002], { prodDays: 90 })));
  step(h, 31, 'p_elena', 'pilot_promote', Object.assign({ note: 'Caught two real faults during the pilot.'  }, { mv_m1: 3, mv_m2: 4 }));

  // 3. High, in panel, expert response overdue
  h = start('Homeowner troubleshooting chatbot', 'A chat assistant that walks homeowners through common water heater problems.', 'p_priya', 28);
  step(h, 26, 'p_jordan', 'develop', {});
  step(h, 25, 'p_priya', 'submit', { form: mkForm({ ucType: UT[1003], measures: MS[1003], ongoingCostUSD: 48000, budgetSource: 'Customer service', alternatives: 'Longer call center hours; a better FAQ page.', costOfNothing: 'Wait times keep rising and routine calls cost about $9 each.', attesters: { c_test: 'p_jack' }, evidence: { c_test: 'Transcript test set results, report TR-2077' }, solution: 'A chat assistant on the support website answers homeowner questions about common water heater problems using product manuals and warranty terms. It suggests next steps and can hand the chat to a call agent. It cannot approve warranty claims or schedule repairs. Chat transcripts are processed and stored by an outside vendor.', problem: 'Call center handles 3,000 routine troubleshooting calls a month.', businessCase: 'Deflect a third of routine calls and shorten waits.', successMetric: 'Deflection rate and customer satisfaction score.', dataRequired: 'Product manuals, warranty terms, chat transcripts.', process: 'Customer service', users: 'Homeowners and call agents', owner: 'Priya Nair', sponsor: 'Victor Shaw', valueUSD: 310000, costUSD: 90000, scope: 'customer', autonomy: 'assist', answers: yes('q_hall', 'q_pii', 'q_us', 'q_share'), readiness: ready('r_access', 'r_steward', 'r_quality'), controls: ['c_test', 'c_log', 'c_access'] }) });
  step(h, 23, 'p_elena', 'vet_to_panel', { note: 'Customer-facing, so full panel.' });
  consult(h, 20, ['p_claire', 'p_ravi'], ['p_luis'], 'Do we need consent for chat transcripts, and is the vendor setup acceptable?');
  reply(h, 18, 'p_ravi', 'concerns', 'Transcripts must be masked before they reach the vendor.');
  step(h, 16, 'p_sam', 'panel_note', { lean: 'remediate', text: 'Wait for the legal view on consent before deciding.' });

  // 4. Moderate, in pilot
  h = start('Anode rod inventory forecasting', 'Forecast anode rod demand so the plant stops running short.', 'p_dana', 52);
  step(h, 50, 'p_jordan', 'develop', {});
  step(h, 48, 'p_dana', 'submit', { form: mkForm({ ucType: UT[1004], measures: MS[1004], attesters: { c_test: 'p_tamika' }, evidence: { c_test: 'Back-test of forecast against two years of orders, sheet FC-12' }, solution: 'A forecasting model uses purchase history and the production plan to predict anode rod demand by month and suggests order quantities. Planners compare the forecast with their own numbers and place the orders themselves.', problem: 'Anode rod shortages halted assembly twice last year.', businessCase: 'Avoid stoppages and cut rush shipping.', successMetric: 'Zero stock-outs in a quarter.', dataRequired: 'Purchase history, production plan.', process: 'Plant supply planning', users: 'Planners', owner: 'Dana Whitfield', sponsor: 'Hannah Cole', valueUSD: 85000, costUSD: 15000, scope: 'site', autonomy: 'advice', answers: yes('q_hall'), controls: ['c_human', 'c_test'] }) });
  step(h, 46, 'p_elena', 'vet_to_panel', {});
  step(h, 44, 'p_naomi', 'panel_note', { firm: true, lean: 'approve', text: 'Data is clean and the model is simple.' });
  step(h, 43, 'p_elena', 'panel_approve', Object.assign({ rationale: 'Low-regret forecast with a person checking every order.', scope: 'Planners compare forecasts against their own for 45 days.', days: 45  }, ACC(MS[1004], MOE[1004], { prodDays: 60 })));

  // 5. High, in pilot with one rework
  h = start('Weld seam vision inspection', 'Cameras check every tank weld and flag defects.', 'p_marcus', 90);
  step(h, 88, 'p_jordan', 'develop', {});
  step(h, 86, 'p_marcus', 'submit', { form: mkForm({ ucType: UT[1005], measures: MS[1005], ongoingCostUSD: 30000, budgetSource: 'Product engineering', alternatives: 'Add a second human inspector per shift.', costOfNothing: 'About 1 in 200 defects keep reaching customers.', attesters: { c_test: 'p_tamika' }, evidence: { c_test: 'Test on 5,000 labeled seam images, report QA-318' }, solution: 'Cameras at the weld station photograph every tank seam and an image model flags seams that look defective. Inspectors confirm every flag before a tank is rejected. The images show tank designs and are stored on site only.', problem: 'Manual weld inspection misses about 1 in 200 defects.', businessCase: 'Fewer leaks in the field and lower warranty cost.', successMetric: 'Escaped defects down 50%.', dataRequired: 'Weld images, inspection results, design tolerances.', process: 'Tank welding and quality', users: 'Quality inspectors', owner: 'Marcus Lee', sponsor: 'Tamika Rowe', valueUSD: 480000, costUSD: 210000, scope: 'site', autonomy: 'assist', answers: yes('q_hall', 'q_ip'), controls: ['c_human', 'c_test', 'c_access', 'c_log'] }) });
  step(h, 84, 'p_elena', 'vet_to_panel', {});
  consult(h, 83, ['p_ravi', 'p_jack'], ['p_tamika'], 'Camera images show tank designs. Is the storage plan acceptable?');
  reply(h, 80, 'p_ravi', 'support', 'On-site storage only is acceptable.');
  reply(h, 80, 'p_jack', 'support', 'Fits the line layout.');
  step(h, 81, 'p_tamika', 'attest', { d_c_test: 'confirm', text: 'Seam test set was labeled by two inspectors. Results are in report QA-318.' });
  step(h, 79, 'p_sam', 'panel_note', { firm: true, lean: 'approve', text: 'Strong value.' });
  step(h, 78, 'p_naomi', 'panel_note', { firm: true, lean: 'approve', text: 'Image storage stays on site.' });
  step(h, 77, 'p_elena', 'panel_approve', Object.assign({ rationale: 'Value is high and image data stays on site.', scope: 'One weld station, inspectors confirm every flag.', days: 45  }, ACC([MS[1005][0], M('False alarm rate (%)', 'lower', 8, 5, 12)], MOE[1005], { prodDays: 45 })));
  step(h, 30, 'p_elena', 'pilot_rework', Object.assign({ note: 'False alarm rate is too high on night shift. Retune and rerun.'  }, { mv_m1: 30, mv_m2: 13 }));

  // 6. Moderate, awaiting vetting
  h = start('Compliance document drafting assistant', 'Draft first versions of product compliance filings.', 'p_priya', 4);
  step(h, 3, 'p_jordan', 'develop', {});
  step(h, 1, 'p_priya', 'submit', { form: mkForm({ ucType: UT[1006], measures: MS[1006], attesters: { c_human: 'p_tamika' }, evidence: { c_human: 'Compliance team reviews every draft, procedure CP-9' }, solution: 'A language model drafts the first version of product compliance filings from prior filings and standards text. A compliance specialist reviews and edits every draft before it is submitted.', problem: 'Compliance filings take a specialist three days each.', businessCase: 'Halve drafting time.', successMetric: 'Draft ready in under one day.', dataRequired: 'Prior filings, standards text.', process: 'Product compliance', users: 'Compliance specialists', owner: 'Priya Nair', sponsor: 'Victor Shaw', valueUSD: 60000, costUSD: 20000, scope: 'site', autonomy: 'assist', answers: yes('q_hall'), controls: ['c_human', 'c_log'] }) });

  // 7. Critical, with executives (briefing pack ready, decision overdue)
  h = start('Burner test parameter auto-tuning', 'Let software adjust burner test settings to hit target efficiency automatically.', 'p_marcus', 40);
  step(h, 38, 'p_jordan', 'develop', {});
  step(h, 36, 'p_marcus', 'submit', { form: mkForm({ ucType: UT[1007], measures: MS[1007], attesters: { c_test: 'p_jack' }, evidence: { c_test: 'Rig trials within the fixed range, report TR-2102' }, solution: 'Software reads sensor data from the test rig during burner efficiency tests and automatically adjusts burner settings, within a fixed range, to reach the target efficiency. A test technician can override at any time and every adjustment is logged.', problem: 'Manual tuning of burner tests takes 25 minutes per unit.', businessCase: 'Cut test time by 60% and improve consistency.', successMetric: 'Test time per unit and rework rate.', dataRequired: 'Test rig sensor data, efficiency targets.', process: 'Final assembly test', users: 'Test technicians', owner: 'Marcus Lee', sponsor: 'Margaret Hale', valueUSD: 650000, costUSD: 280000, scope: 'site', autonomy: 'automate', answers: yes('q_ot', 'q_hall', 'q_ip'), controls: ['c_human', 'c_test', 'c_access', 'c_log', 'c_kill'] }) });
  step(h, 34, 'p_elena', 'vet_to_panel', { note: 'Changes equipment settings, so critical.' });
  consult(h, 33, ['p_ravi', 'p_jack'], ['p_hannah'], 'Safety limits and control access for automatic adjustments.');
  reply(h, 30, 'p_ravi', 'concerns', 'Settings changes must be limited to a fixed safe range.');
  reply(h, 29, 'p_jack', 'support', 'Technicians can override at any time.');
  step(h, 30, 'p_jack', 'attest', { d_c_test: 'confirm', text: 'Rig trials stayed inside the fixed range.' });
  step(h, 28, 'p_sam', 'panel_note', { firm: true, lean: 'approve', text: 'Good value if limits are hard-coded.' });
  step(h, 27, 'p_naomi', 'panel_note', { firm: true, lean: 'approve', text: 'Access controls are in place.' });
  step(h, 26, 'p_elena', 'panel_recommend', Object.assign({ rationale: 'Approve a limited pilot with hard safety limits.', scope: 'One test rig, settings limited to a fixed safe range.', days: 60 }, ACC(MS[1007], MOE[1007])));

  // 8. Returned from triage (safety gate)
  h = start('Supplier negotiation assistant', 'Draft counter-offers using past contract prices.', 'p_dana', 14);
  step(h, 12, 'p_jordan', 'develop', {});
  step(h, 10, 'p_dana', 'submit', { form: mkForm({ ucType: UT[1008], measures: MS[1008], solution: 'A language model drafts counter-offers for buyers using past contract prices and price lists. Contract text would be sent to an outside model provider. Buyers review every draft before it is sent to a supplier.', problem: 'Buyers prepare counter-offers by hand.', businessCase: 'Better prices and faster cycles.', successMetric: 'Average price improvement.', dataRequired: 'Past contracts and price lists.', process: 'Procurement', users: 'Buyers', owner: 'Dana Whitfield', sponsor: 'Victor Shaw', valueUSD: 120000, costUSD: 30000, scope: 'company', autonomy: 'assist', answers: yes('q_train', 'q_hall', { q_svc: 'pub', q_sens: 'conf' }), controls: ['c_human'] }) });

  // 9. Closed: rejected by panel
  h = start('Resume screening assistant', 'Rank incoming resumes for open plant roles.', 'p_priya', 70);
  step(h, 69, 'p_jordan', 'develop', {});
  step(h, 66, 'p_priya', 'submit', { form: mkForm({ ucType: UT[1009], measures: MS[1009], solution: 'A model ranks incoming resumes for open plant roles using past hiring outcomes and gives recruiters a ranked shortlist. Recruiters make the final screening decision.', problem: 'Recruiters screen hundreds of resumes per role.', businessCase: 'Shorten time to hire.', successMetric: 'Days to fill a role.', dataRequired: 'Resumes and past hiring outcomes.', process: 'Recruiting', users: 'Recruiters', owner: 'Priya Nair', sponsor: 'Victor Shaw', valueUSD: 40000, costUSD: 25000, scope: 'company', autonomy: 'assist', answers: yes('q_people', 'q_pii', 'q_hall'), controls: ['c_human'] }) });
  step(h, 64, 'p_elena', 'vet_to_panel', {});
  consult(h, 63, ['p_claire'], [], 'Fairness and employment law exposure.');
  reply(h, 60, 'p_claire', 'serious', 'Ranking candidates creates real discrimination risk that our controls do not cover.');
  step(h, 59, 'p_sam', 'panel_note', { firm: true, lean: 'reject', text: 'Value is modest next to the legal risk.' });
  step(h, 58.5, 'p_naomi', 'panel_note', { firm: true, lean: 'reject', text: 'The consent problem cannot be fixed with controls.' });
  step(h, 58, 'p_elena', 'panel_reject', { rationale: 'Legal exposure outweighs the modest value. Resubmit with a narrower scope if needed.' });

  // 10. Suggestion only
  h = start('Voice notes for service technicians', 'Let field technicians dictate job notes that become clean service records.', 'p_priya', 3);

  // 11. Use case draft in progress
  h = start('Test lab energy forecasting', 'Predict test lab energy use to schedule heavy tests off-peak.', 'p_dana', 9);
  step(h, 6, 'p_jordan', 'develop', { note: 'Dana will fill in the details this week.' });
  step(h, 5, 'p_dana', 'save_draft', { form: { solution: 'A forecasting model predicts test lab energy use from the test schedule and utility rates and suggests moving heavy tests to off-peak hours. A lab scheduler approves every schedule change.', problem: 'Peak energy charges are high during afternoon tests.', businessCase: 'Shift tests to off-peak hours.', owner: 'Dana Whitfield' } });
  step(h, 2, 'p_dana', 'save_draft', { form: { measures: MS[1011], owner: 'Hannah Cole', ownerId: 'p_hannah' } });
  step(h, 2, 'p_dana', 'submit', {});

  // 12. Back to panel from pilot
  h = start('Warranty claim triage', 'Sort incoming warranty claims and suggest which need a technician visit.', 'p_priya', 75);
  step(h, 73, 'p_jordan', 'develop', {});
  step(h, 72, 'p_priya', 'submit', { form: mkForm({ ucType: UT[1012], measures: MS[1012], ongoingCostUSD: 36000, budgetSource: 'Warranty operations', attesters: { c_test: 'p_jack' }, evidence: { c_test: 'Test on 2,000 past claims with photos, report WC-5' }, solution: 'A model reads incoming warranty claims and photos, sorts them by type and suggests whether a technician visit is needed. Warranty agents confirm every suggestion before acting. Customer addresses are masked before processing.', problem: 'Claims wait days for a first review.', businessCase: 'Faster resolution and fewer repeat visits.', successMetric: 'Days to first response.', dataRequired: 'Claim history and photos.', process: 'Warranty', users: 'Warranty agents', owner: 'Luis Garcia', ownerId: 'p_luis', sponsor: 'Victor Shaw', valueUSD: 190000, costUSD: 70000, scope: 'company', autonomy: 'assist', answers: yes('q_pii', 'q_hall'), controls: ['c_human', 'c_test', 'c_log'] }) });
  step(h, 71, 'p_luis', 'signoff_accept', {});
  step(h, 69, 'p_elena', 'vet_to_panel', {});
  step(h, 69, 'p_jack', 'attest', { d_c_test: 'confirm', text: 'Claims test set matches the live mix of photos.' });
  consult(h, 68, ['p_claire'], ['p_hannah'], 'Claim photos contain customer addresses.');
  reply(h, 66, 'p_claire', 'support', 'Fine if addresses are masked.');
  reply(h, 66, 'p_hannah', 'support', 'Service teams would use this daily.');
  step(h, 64, 'p_sam', 'panel_note', { firm: true, lean: 'approve', text: 'Clear value.' });
  step(h, 63, 'p_naomi', 'panel_note', { firm: true, lean: 'approve', text: 'Masking plan is sound.' });
  step(h, 62, 'p_elena', 'panel_approve', Object.assign({ rationale: 'Approved with address masking.', scope: 'Two regions, agents confirm every suggestion.', days: 45  }, ACC(MS[1012], MOE[1012], { prodDays: 60 })));
  step(h, 4, 'p_elena', 'pilot_escalate', { note: 'Pilot data shows the tool also reads customer emails. That is beyond what was approved.' });

  // 13. Pilot waived, in production
  h = start('Customer feedback summarizer', 'Summarize survey comments into monthly themes.', 'p_priya', 55);
  step(h, 54, 'p_jordan', 'develop', {});
  step(h, 53, 'p_priya', 'submit', { form: mkForm({ ucType: UT[1013], measures: MS[1013], solution: 'A language model groups survey comments, with names removed, into monthly themes and a short summary for product teams. A person reads each summary before it is shared.', problem: 'Survey comments pile up unread.', businessCase: 'Product teams see themes monthly.', successMetric: 'Monthly theme report delivered.', dataRequired: 'Survey comments with names removed.', process: 'Customer service', users: 'Product teams', owner: 'Victor Shaw', ownerId: 'p_victor', sponsor: 'Victor Shaw', valueUSD: 30000, costUSD: 5000, scope: 'company', autonomy: 'assist', answers: yes('q_hall'), controls: ['c_human', 'c_log', 'c_access'] }) });
  step(h, 53, 'p_victor', 'signoff_decline', { note: 'The licence cost is not in this year\'s budget yet. Add the cost and confirm the product teams will use the themes.' });
  step(h, 52, 'p_priya', 'submit', { form: { costUSD: 12000 } });
  step(h, 52, 'p_victor', 'signoff_accept', {});
  step(h, 50, 'p_elena', 'vet_to_panel', {});
  step(h, 48, 'p_sam', 'panel_note', { firm: true, lean: 'waive', text: 'Names are stripped and output is read by a person.' });
  step(h, 47, 'p_elena', 'panel_waive', Object.assign({ rationale: 'Low consequence and reversible.', waiver: 'Output is internal and a person reads every summary, so a pilot adds little.'  }, ACC(MS[1013], MOE[1013], { prodDays: 90 })));

  // 14. High, in panel, expert pending overdue
  h = start('CAD design assistant', 'Suggest design alternatives for tank fittings from existing drawings.', 'p_marcus', 20);
  step(h, 18, 'p_jordan', 'develop', {});
  step(h, 17, 'p_marcus', 'submit', { form: mkForm({ ucType: UT[1014], measures: MS[1014], ongoingCostUSD: 260, ongoingBasis: 'per_user_month', budgetSource: 'Product engineering', alternatives: 'Shared drawing library with better search.', solution: 'An assistant reviews existing CAD drawings of tank fittings and proposes design alternatives to engineers. Drawings would be processed by an outside vendor. Engineers decide which ideas to use.', problem: 'Engineers rebuild similar fitting designs from scratch.', businessCase: 'Faster design iterations.', successMetric: 'Hours per design revision.', dataRequired: 'Internal CAD drawings.', process: 'Product engineering', users: 'Design engineers', owner: 'Marcus Lee', sponsor: 'Ines Alvarez', valueUSD: 260000, costUSD: 80000, scope: 'site', autonomy: 'assist', answers: yes('q_ip', 'q_us', 'q_hall', 'q_share'), controls: ['c_human', 'c_access'] }) });
  step(h, 15, 'p_elena', 'vet_to_panel', {});
  consult(h, 13, ['p_ravi'], ['p_tamika'], 'Drawings would be processed by a vendor outside the U.S. Is that acceptable?');
  step(h, 9, 'p_naomi', 'panel_note', { lean: 'remediate', text: 'Ask the vendor for a U.S. hosting option.' });

  // 15. Returned from monitoring
  h = start('Spare parts demand forecasting', 'Forecast service parts demand by region.', 'p_dana', 120);
  step(h, 118, 'p_jordan', 'develop', {});
  step(h, 115, 'p_dana', 'submit', { form: mkForm({ ucType: UT[1015], measures: MS[1015], attesters: { c_test: 'p_tamika' }, evidence: { c_test: 'Back-test by region, sheet FC-31' }, solution: 'A forecasting model uses service history and shipment data to predict spare parts demand by region and recommends stock levels. Planners review the recommendations before ordering.', problem: 'Service parts are out of stock in some regions.', businessCase: 'Fewer repeat visits.', successMetric: 'Parts availability at first visit.', dataRequired: 'Service history, shipment data.', process: 'Field service', users: 'Planners', owner: 'Dana Whitfield', sponsor: 'Hannah Cole', valueUSD: 140000, costUSD: 40000, scope: 'company', autonomy: 'advice', answers: yes('q_hall'), controls: ['c_human', 'c_test'] }) });
  step(h, 113, 'p_elena', 'vet_to_panel', {});
  step(h, 112, 'p_tamika', 'attest', { d_c_test: 'decline', text: 'The back-test covered only one region, so I cannot confirm the control as described.' });
  step(h, 111, 'p_sam', 'panel_note', { firm: true, lean: 'approve', text: 'Good value.' });
  step(h, 110, 'p_elena', 'panel_approve', Object.assign({ rationale: 'Approved.', scope: 'Two regions for 30 days.', days: 30  }, ACC(MS[1015], MOE[1015], { prodDays: 45 })));
  step(h, 78, 'p_elena', 'pilot_promote', { mv_m1: 5, mv_m2: 18 });
  step(h, 2, 'p_dana', 'monitor_reassess', { note: 'We are adding a new data source from a distributor, so the risk picture changed.' });

  // 16 and 17 are not flagged legacy, so the required consults (AI safety, Data steward) trigger on their answers.
  const startNew = (title, idea, sub, d) => { const hh = { c: newCase('UC-' + (++n), title, idea, sub, T(d), 1) }; assignAdviser(hh.c, R); cases.push(hh); return hh; };
  // 16. Awaiting vetting: two required consults are triggered and not yet requested
  h = startNew('Support email auto-responder', 'Read customer emails and send a first reply, and open warranty tickets on its own.', 'p_priya', 4);
  step(h, 3, 'p_jordan', 'develop', {});
  step(h, 2, 'p_priya', 'submit', { form: mkForm({ ucType: 'model', measures: MS[1012], attesters: { c_human: 'p_tamika' }, evidence: { c_human: 'Agents review every reply before it is sent, procedure CS-4' }, solution: 'A language model reads incoming customer emails, drafts a reply and opens a warranty ticket through the ticket system connector. Agents review replies before they go out.', problem: 'First replies take two days.', businessCase: 'Cut first-reply time to hours.', successMetric: 'Median first reply under 4 hours.', dataRequired: 'Customer emails with names and addresses.', process: 'Customer service', users: 'Support agents', owner: 'Priya Nair', sponsor: 'Victor Shaw', valueUSD: 80000, costUSD: 25000, scope: 'site', autonomy: 'assist', answers: yes('q_outside', 'q_tools', 'q_model', 'q_pii'), controls: ['c_human', 'c_log'] }) });
  // 17. In panel: required consults requested, one answered, one still holding the decision; a recommended one does not hold it
  h = startNew('Supplier portal assistant', 'Answer supplier questions from the portal and update purchase orders.', 'p_dana', 12);
  step(h, 11, 'p_jordan', 'develop', {});
  step(h, 10, 'p_dana', 'submit', { form: mkForm({ ucType: 'model', measures: MS[1009], attesters: { c_human: 'p_tamika' }, evidence: { c_human: 'Buyers confirm every purchase order change, procedure PR-7' }, solution: 'A language model answers supplier questions typed into the portal and can update purchase order dates through the ordering system connector. Buyers confirm every change.', problem: 'Buyers spend hours on routine supplier questions.', businessCase: 'Free buyer time.', successMetric: 'Hours saved per buyer per week.', dataRequired: 'Supplier messages, purchase orders.', process: 'Purchasing', users: 'Buyers', owner: 'Dana Whitfield', sponsor: 'Victor Shaw', valueUSD: 50000, costUSD: 15000, scope: 'site', autonomy: 'assist', answers: yes('q_outside', 'q_tools', 'q_model', 'q_pii'), controls: ['c_human', 'c_log'] }) });
  step(h, 9, 'p_elena', 'vet_to_panel', { note: 'Outside input and an action path: AI safety and the data steward must weigh in.' });
  consult(h, 8, ['p_mina', 'p_omar', 'p_claire'], [], 'Outside supplier text reaches a model that can change purchase orders. Please assess.');
  reply(h, 6, 'p_omar', 'support', 'Supplier contact data stays in the ordering system. No new sharing.');

  // 18. In panel: shares data with another company, so the Legal consult is required and still pending
  h = startNew('Supplier demand sharing', 'Send our weekly parts forecast and open orders to two key suppliers so they can plan capacity.', 'p_dana', 8);
  step(h, 7, 'p_jordan', 'develop', {});
  step(h, 6, 'p_dana', 'submit', { form: mkForm({ ucType: 'use', measures: MS[1015], attesters: { c_test: 'p_tamika' }, evidence: { c_test: 'Forecast back-test by part family, sheet FC-40' }, solution: 'A weekly job packages our parts forecast and open purchase orders and sends them to two named suppliers through their portals, so they can plan capacity. Planners review each file before it goes out.', problem: 'Suppliers plan capacity blind and miss our peaks.', businessCase: 'Fewer late deliveries and less expediting.', successMetric: 'On-time delivery from these suppliers.', dataRequired: 'Forecast by part, open purchase orders, supplier IDs.', process: 'Purchasing and planning', users: 'Planners, two suppliers', owner: 'Dana Whitfield', sponsor: 'Victor Shaw', valueUSD: 70000, costUSD: 10000, scope: 'site', autonomy: 'assist', answers: yes('q_share'), controls: ['c_human', 'c_log'] }) });
  step(h, 5, 'p_elena', 'vet_to_panel', { note: 'Shares company data with suppliers, so Legal must verify consent.' });
  consult(h, 4, ['p_claire'], [], 'Company forecast and order data would go to two suppliers. Please verify that consent to share it has been given and that the supplier terms cover it.');

  // AI tool catalog: three created by use cases above, plus tools people reported.
  const tool = (by, d, f, steps) => {
    let t = newTool(nextToolId(tools), by, T(d + 1));
    t = performTool(t, 'save_tool', { form: f }, byId(by), { now: T(d + 1) });
    if (steps === 'draft') { tools.push(t); return; }
    t = performTool(t, 'report_tool', { form: {} }, byId(by), { now: T(d) });
    (steps || []).forEach(([pid, dd, status, note]) => { t = performTool(t, 'set_tool_status', { status, note }, byId(pid), { now: T(dd) }); });
    tools.push(t);
  };
  tool('p_hannah', 45, { name: 'Meeting transcription assistant', vendor: 'Example Voice Co.', purpose: 'Records and transcribes team meetings and drafts action lists.', users: 'Production supervisors', accessNote: 'Ask your manager to request a seat from IT.', link: '', ownerId: 'p_hannah' });
  tool('p_marcus', 30, { name: 'Engineering chat assistant', vendor: 'Example Models Inc.', purpose: 'General question-and-answer help for engineers, used in the browser.', users: 'Product engineering', accessNote: 'Free web account. Not provided by IT.', link: '', ownerId: 'p_marcus' }, [['p_elena', 20, 'review', 'Checking what data engineers paste into it.']]);
  tool('p_priya', 25, { name: 'Email translation plug-in', vendor: 'Example Language Ltd.', purpose: 'Translates customer emails for the support team.', users: 'Customer service', accessNote: '', link: '', ownerId: 'p_priya' }, [['p_elena', 12, 'not_approved', 'Customer emails leave the company. Use the approved translation service instead.']]);
  tool('p_dana', 60, { name: 'Spreadsheet formula helper', vendor: 'Example Office Suite', purpose: 'Suggests formulas inside the company spreadsheet program.', users: 'Plant planners', accessNote: 'Included with the company spreadsheet license.', link: '', ownerId: 'p_naomi' }, [['p_elena', 50, 'approved', 'Runs inside the company tenant.']]);
  tool('p_luis', 3, { name: 'Field note dictation app', vendor: 'Example Voice Co.', purpose: 'Draft only.', users: 'Field service', accessNote: '', link: '', ownerId: 'p_luis' }, 'draft');

  // Evidence attached to controls: links and one small sample file.
  const files = [];
  const evid = (cid, d, pid, controlId, f) => { const h = cases.find(x => x.c.id === cid); h.c = perform(h.c, 'add_evidence', Object.assign({ controlId }, f), byId(pid), { rules: R, now: T(d), rv: 1 }); };
  const note = 'QA-318 summary: 5,000 labeled weld seam images, two inspectors, 97% agreement with inspector decisions.\n';
  files.push({ id: 'F-1001', caseId: 'UC-1005', name: 'QA-318-summary.txt', type: 'text/plain', size: note.length, data: 'data:text/plain;charset=utf-8,' + encodeURIComponent(note) });
  evid('UC-1005', 82, 'p_tamika', 'c_test', { fileId: 'F-1001', fileName: 'QA-318-summary.txt', size: note.length, type: 'text/plain', note: 'Short summary of the seam test.' });
  evid('UC-1005', 81, 'p_marcus', 'c_test', { url: 'https://example.com/reports/QA-318', note: 'Full report.' });
  evid('UC-1002', 66, 'p_jack', 'c_test', { url: 'https://example.com/reports/TR-2041' });

  const training = {}; PEOPLE.forEach(pp => { if (pp.id === 'p_tomas') return; training[pp.id] = { t_intro: { at: NOW - 40 * DAY, ver: '2026.1' } }; if (pp.role === 'submitter' || pp.role === 'adviser') training[pp.id].t_safe = { at: NOW - 20 * DAY, ver: '2026.1' }; });
  return { cases: cases.map(x => x.c), tools, files, rules: R, versions: [{ n: 1, at: T(130), by: 'system', reason: 'Initial sample rules', summary: ['Initial sample rules.'], json: JSON.stringify(R) }], meta: { clockOffsetMs: 0, seededAt: NOW, training } };
}

