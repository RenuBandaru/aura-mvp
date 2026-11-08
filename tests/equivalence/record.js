// Records "golden" results from the frozen build 27 JavaScript engine, so the Python port can be checked against it.
//
// Run from the repository root:
//   TZ=America/New_York node tests/equivalence/record.js            writes tests/equivalence/golden.json
//   TZ=America/New_York node tests/equivalence/record.js --dump KEY prints the full JavaScript result for one check
//
// How it works
//   1. It loads engine/reference/engine.js and seed.js unchanged into a sandbox, the same way the old node checks did.
//   2. It builds the sample data at a fixed moment (NOW), so every run gives the same answer.
//   3. It runs three families of checks and stores, for each one, a short fingerprint (a SHA-256 of the result):
//        - "fn":   one engine function called on fixed arguments (for example runScoring on every sample case),
//        - "walk": a random but repeatable sequence of actions on a sample case, recording every input it used,
//        - "seed": the whole sample data set.
//   The Python test (tests/equivalence/test_golden.py) repeats every check and compares fingerprints.
//
// Arguments refer to shared objects with small markers so the file stays small:
//   {"$case": "UC-1001"} a sample case, {"$rules": 1} the default rules, {"$person": "p_dana"} a person,
//   {"$cases": 1} all sample cases, {"$tools": 1} all sample tools, {"$training": 1} the sample training records.
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');

if (process.env.TZ !== 'America/New_York') { console.error('Run with TZ=America/New_York so dates print the same way every time.'); process.exit(1); }

const ROOT = path.resolve(__dirname, '..', '..');
const src = ['engine.js', 'seed.js'].map(f => fs.readFileSync(path.join(ROOT, 'engine', 'reference', f), 'utf8')).join('\n');
const EXPOSE = ['defaultRules', 'normRules', 'buildSeed', 'actionsFor', 'perform', 'PEOPLE', 'SYSTEM', 'byId', 'clone', 'runTriage', 'runScoring',
  'controlNeeds', 'consultNeeds', 'looseThreads', 'supportView', 'revVotes', 'revPool', 'revNeed', 'revBlockers', 'termsNow', 'termsGaps', 'revReady',
  'revDeadlock', 'deadlockOptions', 'revQuorumWaivable', 'secondLookOptions', 'caseGaps', 'formGaps', 'verifyAudit', 'revReminderDue', 'remindCase',
  'ensureTool', 'measureBoard', 'acceptanceExpired', 'budgetFlag', 'threeYearRoi', 'dutyBlock', 'validateRules', 'diffRules', 'whatIf', 'matchCatalog',
  'rescore', 'trainingBlocks', 'trainingState', 'openUnaccepted', 'formDiff', 'formDiffNames', 'selfConfirmed', 'questionUsage', 'optionUsage',
  'describeRule', 'exceptionData', 'toolActions', 'performTool', 'newTool', 'newCase', 'assignAdviser', 'readyStatus', 'waitingOn', 'toCsv',
  'parseMeasures', 'measureState', 'estimateDays', 'controlStatus', 'unclaimedRequired', 'measureFlags'];
const sandbox = { console, TextEncoder, Date, JSON, Math, Set, Map };
vm.createContext(sandbox);
vm.runInContext(src + '\nthis.__x={' + EXPOSE.join(',') + '};', sandbox);
const X = sandbox.__x;

// A fixed moment: Sunday 8 November 2026, 10:00 in New York (15:00 UTC).
const NOW = Date.UTC(2026, 10, 8, 15, 0, 0);
const DAY = 86400000;
const R = X.defaultRules();
const seed = X.buildSeed(NOW);
const person = id => X.PEOPLE.find(p => p.id === id) || X.byId(id);
const ctxAt = (now, extra) => Object.assign({ rules: R, now, rv: 1, training: seed.meta.training }, extra || {});

// Canonical JSON: keys sorted, so the fingerprint does not depend on the order keys were added.
// Strings that are themselves JSON (such as the "x" field on emails) are kept as written, so their key order still counts.
const canon = v => JSON.stringify(sortKeys(JSON.parse(JSON.stringify(v === undefined ? null : v))));
const sortKeys = v => Array.isArray(v) ? v.map(sortKeys) : (v && typeof v === 'object') ? Object.keys(v).sort().reduce((o, k) => (o[k] = sortKeys(v[k]), o), {}) : v;
const digest = v => crypto.createHash('sha256').update(canon(v)).digest('hex').slice(0, 24);

// Resolve the argument markers described at the top of the file. Every call gets fresh copies, so no check can affect another.
const resolve = a => {
  if (Array.isArray(a)) return a.map(resolve);
  if (a && typeof a === 'object') {
    if ('$case' in a) return X.clone(seed.cases.find(c => c.id === a.$case));
    if ('$rules' in a) return X.clone(R);
    if ('$person' in a) return person(a.$person);
    if ('$cases' in a) return X.clone(seed.cases);
    if ('$tools' in a) return X.clone(seed.tools);
    if ('$training' in a) return X.clone(seed.meta.training);
    if ('$undefined' in a) return undefined;
    if ('$ctx' in a) return ctxAt(a.$ctx.now, a.$ctx.training === false ? { training: undefined } : {});
    return Object.keys(a).reduce((o, k) => (o[k] = resolve(a[k]), o), {});
  }
  return a;
};
const call = (fn, args) => { try { return { ok: X[fn](...resolve(args)) }; } catch (e) { return { error: e.message }; } };

const checks = [];
// Arguments go through JSON first, exactly as the Python side will read them, so both sides see the same values.
const fn = (key, name, args) => checks.push({ key, kind: 'fn', fn: name, args: JSON.parse(JSON.stringify(args)) });

// ---- Family 1: single functions on every sample case ----
const C = id => ({ $case: id }), RULES = { $rules: 1 };
const people = X.PEOPLE.map(p => p.id);
const caseIds = seed.cases.map(c => c.id);
const NOWS = [NOW, NOW + 3 * DAY, NOW + 12 * DAY, NOW + 40 * DAY, NOW + 400 * DAY];
caseIds.forEach(id => {
  const c = seed.cases.find(x => x.id === id);
  people.forEach(pid => fn('actionsFor:' + id + ':' + pid, 'actionsFor', [C(id), { $person: pid }, { $ctx: { now: NOW } }]));
  people.forEach(pid => fn('actionsFor+30d:' + id + ':' + pid, 'actionsFor', [C(id), { $person: pid }, { $ctx: { now: NOW + 30 * DAY, training: false } }]));
  fn('runTriage:' + id, 'runTriage', [c.form, RULES]);
  fn('runScoring:' + id, 'runScoring', [c.form, RULES, c.attestations || null]);
  ['controlNeeds', 'consultNeeds', 'formGaps', 'budgetFlag'].forEach(f => fn(f + ':' + id, f, [c.form, RULES]));
  fn('threeYearRoi:' + id, 'threeYearRoi', [c.form]);
  ['looseThreads', 'supportView', 'revBlockers', 'termsNow', 'revReady', 'revQuorumWaivable', 'secondLookOptions', 'caseGaps', 'openUnaccepted', 'selfConfirmed', 'unclaimedRequired'].forEach(f => fn(f + ':' + id, f, f === 'unclaimedRequired' ? [c.form, RULES] : [C(id), RULES]));
  ['revVotes', 'revPool', 'verifyAudit', 'measureBoard', 'measureFlags'].forEach(f => fn(f + ':' + id, f, [C(id)]));
  fn('revNeed:' + id, 'revNeed', [C(id), RULES]);
  ['approve', 'waive', 'remediate'].forEach(d => fn('termsGaps:' + id + ':' + d, 'termsGaps', [C(id), RULES, d]));
  NOWS.forEach((t, i) => {
    fn('revDeadlock:' + id + ':' + i, 'revDeadlock', [C(id), RULES, t]);
    fn('revReminderDue:' + id + ':' + i, 'revReminderDue', [C(id), RULES, t]);
    fn('remindCase:' + id + ':' + i, 'remindCase', [C(id), { $ctx: { now: t } }, { $person: 'system' }]);
    fn('acceptanceExpired:' + id + ':' + i, 'acceptanceExpired', [C(id), t]);
    fn('rescore:' + id + ':' + i, 'rescore', [C(id), { $ctx: { now: t } }]);
  });
  fn('ensureTool:' + id, 'ensureTool', [C(id), { $tools: 1 }, NOW, 1]);
  fn('formDiff:' + id, 'formDiff', [c.formAtReturn || null, c.form, RULES]);
  fn('formDiffNames:' + id, 'formDiffNames', [c.formAtReturn || null, c.form, RULES]);
  fn('readyStatus:' + id, 'readyStatus', [c.form, RULES]);
  ['confirm', 'stakeholder', 'expert', 'panel', 'exec'].forEach(k => people.forEach(pid => fn('dutyBlock:' + id + ':' + pid + ':' + k, 'dutyBlock', [C(id), pid, k])));
  (c.attestations || []).forEach(a => fn('controlStatus:' + id + ':' + a.controlId, 'controlStatus', [C(id), a.controlId]));
});
fn('waitingOn:all', 'waitingOn', [{ $cases: 1 }, { $ctx: { now: NOW } }]); // see the special case in the runner below

// ---- Rules editor helpers ----
const R2 = X.clone(R); R2.questions[0].enabled = false; R2.rules.find(r => r.id === 'g_enc').when = []; R2.tiers.lowMax = 9; R2.quorum.high = 4;
R2.controls = R2.controls.filter(k => k.id !== 'c_log'); R2.questions.push({ id: 'q_new', text: 'A new question?', short: 'New', type: 'yesno', enabled: true });
R2.rules.push({ id: 'pt_new', kind: 'points', label: 'New points', points: 2, enabled: true, when: [{ src: 'q:q_new', in: ['yes'] }] });
R2.goals.value.value = 0; R2.reviewMaxDays.low = 30;
const R3 = X.clone(R); R3.questions.find(q => q.id === 'q_listed').options.pop(); R3.rules.reverse(); R3.execQuorum = 2; R3.minReady = 3;
fn('validateRules:same', 'validateRules', [RULES, RULES, { $cases: 1 }]);
fn('validateRules:R2', 'validateRules', [R2, RULES, { $cases: 1 }]);
fn('validateRules:R3', 'validateRules', [R3, RULES, { $cases: 1 }]);
fn('diffRules:R2', 'diffRules', [RULES, R2]);
fn('diffRules:R3', 'diffRules', [RULES, R3]);
fn('normRules:old', 'normRules', [{ version: 3 }]);
fn('normRules:mig', 'normRules', [Object.assign(X.clone(R), { mig3: false, mig4: false, mig5: false, mig6: false, units: undefined, budget: undefined })]);
R.rules.forEach(r => fn('describeRule:' + r.id, 'describeRule', [r, RULES]));
R.questions.forEach(q => { fn('questionUsage:' + q.id, 'questionUsage', [q.id, RULES, { $cases: 1 }]); (q.options || []).forEach(o => fn('optionUsage:' + q.id + ':' + o.id, 'optionUsage', [q.id, o.id, RULES, { $cases: 1 }])); });
const WHATIF = [{}, { answers: { q_enc: true } }, { answers: { q_ot: true, q_hall: 'unknown' }, scope: 'customer', autonomy: 'automate', ucType: 'build' },
  { answers: { q_sens: 'conf', q_svc: 'pub', q_listed: 'pending', q_code: 'firmware', q_fw: true }, ucType: 'model', controls: ['c_human', 'c_validate'] },
  { answers: { q_target: 'it', q_access: 'broad', q_people: true, q_decide: true }, autonomy: 'automate', scope: 'site' }];
WHATIF.forEach((w, i) => fn('whatIf:' + i, 'whatIf', [RULES, w]));
fn('matchCatalog:1', 'matchCatalog', ['Predict pump failures from vibration sensors and weld images', { $tools: 1 }, { $cases: 1 }, 10]);
fn('matchCatalog:2', 'matchCatalog', ['forecast demand for spare parts', { $tools: 1 }, { $cases: 1 }, 5, 'UC-1015']);
fn('matchCatalog:3', 'matchCatalog', ['that with', { $tools: 1 }, { $cases: 1 }]);
fn('exceptionData', 'exceptionData', [{ $cases: 1 }, 0, RULES]);
fn('parseMeasures:bad', 'parseMeasures', [[{ name: 'A', dir: 'lower', target: 5, stop: 3 }], true]);
fn('parseMeasures:mixed', 'parseMeasures', [[{ name: ' A ', dir: 'higher', target: '5', stop: '', scaleUp: 'x' }, { name: '' }, null, { name: 'B', target: 0, stop: 2 }], false]);
fn('newCase', 'newCase', ['UC-9001', 'A title', 'An idea', 'p_priya', NOW, 1]);
X.PEOPLE.forEach(p => fn('trainingBlocks:' + p.id, 'trainingBlocks', [{ $training: 1 }, { $person: p.id }, RULES, NOW + 400 * DAY]));
seed.tools.forEach(t => people.forEach(pid => fn('toolActions:' + t.id + ':' + pid, 'toolActions', [t, { $person: pid }])));

// ---- Family 2: random but repeatable walks through the workflow ----
// mulberry32: a tiny pseudo-random generator, so the same seed number gives the same walk every time.
const rng = s => () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const ALL_IDS = ['develop', 'submit', 'vet_approve', 'panel_approve', 'exec_approve', 'pilot_promote', 'reopen', 'consult', 'attest', 'rv_vote'];
// Fills an action's fields with plausible values. Mostly valid, sometimes blank, so error messages are checked too.
function fillFor(a, c, rnd, step, drive) {
  const pick = arr => arr[Math.floor(rnd() * arr.length)];
  const inp = {};
  (a.fields || []).forEach(f => {
    if (f.type === 'overrides') { (f.threads || []).forEach(t => { if (rnd() < 0.9) { inp['ov_' + t.slug] = 'Accepted at step ' + step; inp['ovc_' + t.slug] = true; } }); return; }
    if (f.type === 'measures') { inp[f.name] = rnd() < 0.9 ? f.value : [{ name: 'Bad KPI', dir: 'lower', target: 5, stop: 1 }]; return; }
    if (f.type === 'checks') { inp[f.name] = (f.options || []).filter(() => rnd() < 0.5).map(o => o.v); return; }
    if (f.type === 'smetable') { const opts = (f.options || []).filter(o => !o.disabled); inp.smes = opts.filter(() => rnd() < 0.5).map(o => o.v); inp.reqSmes = inp.smes.filter(() => rnd() < 0.5); if (rnd() < 0.7) inp.question = 'Please review step ' + step + '.'; return; }
    if (f.type === 'stkblock') { inp.stakeholders = (f.options || []).filter(o => !o.disabled && rnd() < 0.3).map(o => o.v); return; }
    if (f.type === 'select') { const opts = (f.options || []).filter(o => o.v !== undefined); inp[f.name] = rnd() < 0.3 && f.value ? f.value : (opts.length ? pick(opts).v : ''); return; }
    if (f.type === 'number') { inp[f.name] = rnd() < 0.8 && f.value != null && f.value !== '' ? f.value : Math.floor(rnd() * 90) + 1; return; }
    if (f.type === 'hidden') { inp[f.name] = f.value; return; }
    if (['support', 'panelnotes', 'note'].includes(f.type) || !f.name) return;
    inp[f.name] = rnd() < 0.85 ? (f.value || 'Text for ' + f.name + ' at step ' + step + '.') : '';
  });
  if (a.id === 'rv_vote' && drive) { const o = a.fields.find(f => f.name === 'decision').options.map(x => x.v), v = c.stage === 'exec' ? c.xvotes : c.votes, seen = Object.values(v || {}).map(x => x.dec).filter(d => o.includes(d)); inp.decision = seen.length && rnd() < 0.8 ? seen[0] : pick(o.slice(0, 4)); inp.strength = rnd() < 0.9 ? 'firm' : 'leaning'; inp.text = 'Driven note ' + step + '.'; }
  else if (a.id === 'rv_vote') { inp.strength = rnd() < 0.7 ? 'firm' : 'leaning'; if (!inp.decision) { const o = a.fields.find(f => f.name === 'decision'); inp.decision = pick(o.options).v; } }
  if (a.id === 'add_evidence') { inp.controlId = pick(c.form.controls); if (rnd() < 0.8) inp.url = 'https://example.com/evidence/' + step; else { inp.fileId = 'F-9' + step; inp.fileName = rnd() < 0.8 ? 'report.pdf' : 'report.exe'; inp.size = rnd() < 0.9 ? 2048 : 900000; inp.type = 'application/pdf'; } inp.note = rnd() < 0.5 ? 'Evidence note.' : ''; }
  if (a.id === 'remove_control') inp.controlId = pick(c.form.controls);
  if (a.id === 'remove_evidence') inp.evidenceId = a.evidenceId;
  if (a.form) { inp.form = {}; if (rnd() < 0.4) inp.form.costUSD = Math.floor(rnd() * 50000); if (rnd() < 0.2) inp.form.answers = Object.assign({}, c.form.answers, { q_enc: rnd() < 0.5 }); if (rnd() < 0.2) inp.form.unitId = pick(['u_ops', 'u_eng', 'u_cs']); if (rnd() < 0.15) inp.ipAck = true; }
  return inp;
}
const WALKS = 5, STEPS = 24;
caseIds.forEach((id, ci) => {
  for (let w = 0; w < WALKS; w++) {
    const rnd = rng(1000 * ci + w + 7);
    let c = X.clone(seed.cases.find(x => x.id === id)), now = NOW;
    const steps = [];
    for (let s = 0; s < STEPS; s++) {
      now += Math.floor(rnd() * 4) * DAY + Math.floor(rnd() * 8) * 3600000;
      const ctx = ctxAt(now);
      if (rnd() < 0.12) { // the automated reminder sweep
        const r = X.remindCase(c, ctx, X.SYSTEM);
        steps.push({ sweep: true, now, digest: digest(r) });
        if (r) c = r;
        continue;
      }
      const cands = people.map(pid => ({ pid, acts: X.actionsFor(c, person(pid), ctx) })).filter(x => x.acts.length);
      let pid, aid, inp;
      if (!cands.length || rnd() < 0.08) { pid = people[Math.floor(rnd() * people.length)]; aid = ALL_IDS[Math.floor(rnd() * ALL_IDS.length)]; inp = {}; }
      else {
        // Pick an action kind first, then a person who has it, so common actions such as "Add evidence" do not crowd out the rest.
        // The last walk of each case is "driven": it prefers decisions that move the case on, so panel and executive endings get exercised.
        const kinds = [...new Set(cands.flatMap(x => x.acts.map(a => a.id)))], drive = kinds.filter(x => /^(panel_|exec_|vet_|pilot_|rv_vote|consult|respond|attest|develop|submit|signoff_accept)/.test(x));
        const k = w === WALKS - 1 && drive.length && rnd() < 0.8 ? drive[Math.floor(rnd() * drive.length)] : kinds[Math.floor(rnd() * kinds.length)];
        const who = cands.filter(x => x.acts.some(a => a.id === k)), p = who[Math.floor(rnd() * who.length)], mine = p.acts.filter(a => a.id === k), a = mine[Math.floor(rnd() * mine.length)];
        pid = p.pid; aid = a.id; inp = JSON.parse(JSON.stringify(fillFor(a, c, rnd, s, w === WALKS - 1)));
      }
      let out;
      try { const r = X.perform(c, aid, inp, person(pid), ctx); out = { digest: digest(r) }; c = r; } catch (e) { out = { error: e.message }; }
      steps.push(Object.assign({ pid, aid, input: inp, now }, out));
    }
    checks.push({ key: 'walk:' + id + ':' + w, kind: 'walk', caseId: id, steps });
  }
});

// ---- Run the "fn" checks and the seed check ----
const results = {};
checks.forEach(ch => {
  if (ch.kind !== 'fn') return;
  let r;
  if (ch.fn === 'waitingOn') r = { ok: resolve(ch.args[0]).map(c => X.waitingOn(c, resolve(ch.args[1])).map(p => p.id)) };
  else r = call(ch.fn, ch.args);
  results[ch.key] = r;
  if ('error' in r) ch.error = r.error; else ch.digest = digest(r.ok);
});
checks.unshift({ key: 'seed', kind: 'seed', now: NOW, digest: digest(seed) });

const dumpAt = process.argv.indexOf('--dump');
if (dumpAt > 0) {
  const key = process.argv[dumpAt + 1];
  if (key === 'seed') console.log(JSON.stringify(seed, null, 1));
  else if (key.startsWith('walk:')) { // walk:UC-1001:0:5 prints the case after step 5
    const [, cid, w, upto] = key.split(':'), ch = checks.find(x => x.key === 'walk:' + cid + ':' + w);
    let c = X.clone(seed.cases.find(x => x.id === cid));
    ch.steps.slice(0, +upto + 1).forEach(st => { const ctx = ctxAt(st.now); if (st.sweep) { const r = X.remindCase(c, ctx, X.SYSTEM); if (r) c = r; return; } try { c = X.perform(c, st.aid, st.input, person(st.pid), ctx); } catch (e) { } });
    console.log(JSON.stringify(c, null, 1));
  } else console.log(JSON.stringify(results[key], null, 1));
  process.exit(0);
}
const out = path.join(__dirname, 'golden.json');
fs.writeFileSync(out, JSON.stringify({ about: 'Golden results from the build 27 JavaScript engine. Regenerate with: TZ=America/New_York node tests/equivalence/record.js', now: NOW, checks }));
console.log('wrote', path.relative(ROOT, out), checks.length, 'checks,', checks.filter(c => c.kind === 'walk').reduce((s, c) => s + c.steps.length, 0), 'walk steps,', (fs.statSync(out).size / 1024).toFixed(0), 'KB');
