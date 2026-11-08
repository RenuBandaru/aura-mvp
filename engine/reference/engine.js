const APP_VERSION = '0.3', APP_BUILD = 27;
// ===== ENGINE: workflow rules and transitions. No DOM access. =====
const DAY = 86400000;
const TIERS = ['low', 'moderate', 'high', 'critical'];
const TIER_LABEL = { low: 'Low', moderate: 'Moderate', high: 'High', critical: 'Critical' };
const STAGES = ['suggestion', 'use_case', 'vetting', 'panel', 'exec', 'pilot', 'production', 'closed'];
const STAGE_LABEL = { suggestion: 'Suggestion', use_case: 'Use case', vetting: 'Vetting', panel: 'Panel review', exec: 'Executive review', pilot: 'Pilot', production: 'Production', closed: 'Closed' };
const ROLE_LABEL = { submitter: 'Submitter', adviser: 'Adoption adviser', lead: 'Governance lead', panel: 'Panel reviewer', sme: 'Subject matter expert', stakeholder: 'Process stakeholder', exec: 'Executive', auditor: 'Auditor (read-only)', admin: 'Demo admin' };

const PEOPLE = [
  { id: 'p_dana', unit: 'u_ops', name: 'Dana Whitfield', role: 'submitter', title: 'Plant operations' },
  { id: 'p_marcus', unit: 'u_eng', name: 'Marcus Lee', role: 'submitter', title: 'Product engineering' },
  { id: 'p_priya', unit: 'u_cs', name: 'Priya Nair', role: 'submitter', title: 'Customer service' },
  { id: 'p_jordan', unit: 'u_corp', name: 'Jordan Ellis', role: 'adviser', title: 'AI adoption team' },
  { id: 'p_elena', unit: 'u_legal', name: 'Elena Duarte', role: 'lead', title: 'Governance lead, panel chair' },
  { id: 'p_sam', unit: 'u_corp', name: 'Sam Okafor', role: 'panel', title: 'Panel reviewer, finance' },
  { id: 'p_naomi', unit: 'u_corp', name: 'Naomi Park', role: 'panel', title: 'Panel reviewer, IT' },
  { id: 'p_ravi', unit: 'u_corp', name: 'Ravi Menon', role: 'sme', title: 'Cybersecurity' },
  { id: 'p_claire', unit: 'u_legal', name: 'Claire Dubois', role: 'sme', title: 'Legal' },
  { id: 'p_jack', unit: 'u_ops', name: 'Jack Tran', role: 'sme', title: 'Operations' },
  { id: 'p_hannah', unit: 'u_ops', name: 'Hannah Cole', role: 'stakeholder', title: 'Production manager' },
  { id: 'p_luis', unit: 'u_cs', name: 'Luis Garcia', role: 'stakeholder', title: 'Field service lead' },
  { id: 'p_tamika', unit: 'u_ops', name: 'Tamika Rowe', role: 'stakeholder', title: 'Quality manager' },
  { id: 'p_margaret', unit: 'u_ops', name: 'Margaret Hale', role: 'exec', title: 'Chief operating officer' },
  { id: 'p_victor', unit: 'u_corp', name: 'Victor Shaw', role: 'exec', title: 'Chief financial officer' },
  { id: 'p_ines', unit: 'u_eng', name: 'Ines Alvarez', role: 'exec', title: 'Chief technology officer' },
  { id: 'p_auditor', unit: 'u_legal', name: 'Rhea Callahan', role: 'auditor', title: 'Internal audit, read-only' },
  { id: 'p_admin', unit: 'u_corp', name: 'Demo admin', role: 'admin', title: 'Manages rules and sample data' },
  { id: 'p_noor', unit: 'u_eng', name: 'Noor Haddad', role: 'adviser', title: 'AI adoption team' },
  { id: 'p_grant', unit: 'u_cs', name: 'Grant Mercer', role: 'adviser', title: 'AI adoption team' },
  { id: 'p_mei', unit: 'u_corp', name: 'Mei Lin', role: 'sme', title: 'IT standards' },
  { id: 'p_omar', unit: 'u_corp', name: 'Omar Reyes', role: 'sme', title: 'Data steward' },
  { id: 'p_mina', unit: 'u_eng', name: 'Mina Kowalski', role: 'sme', title: 'AI safety' },
  { id: 'p_tomas', unit: 'u_ops', name: 'Tomas Brandt', role: 'submitter', title: 'New hire, plant operations' },
];
const SYSTEM = { id: 'system', name: 'System (automated)', role: 'system', title: '' };
const byId = id => PEOPLE.find(p => p.id === id) || (id === 'system' ? SYSTEM : { id, name: id || 'Unknown', role: 'unknown', title: '' });
const withRole = r => PEOPLE.filter(p => p.role === r);
const BIAS_OPTS = [['none', 'Not reviewed this period'], ['informal', 'Informal check'], ['structured', 'Structured test'], ['audit', 'Independent audit'], ['na', 'Not applicable: does not affect individuals']];
const tIdx = t => Math.max(0, TIERS.indexOf(t));
const maxTier = (a, b) => (tIdx(a) >= tIdx(b) ? a : b);
const clone = o => JSON.parse(JSON.stringify(o));

// ---- Tamper-evident audit trail ----
// Every audit entry carries the hash of the entry before it, so changing or removing any earlier entry breaks the chain from that point on.
// In this demo the shared database lets any editor write any record, so tampering is detected, not prevented. In production the store is insert-only.
function sha256(msg) {
  const K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
  const bytes = Array.from(new TextEncoder().encode(msg)), bl = bytes.length * 8;
  bytes.push(0x80); while (bytes.length % 64 !== 56) bytes.push(0);
  const hi = Math.floor(bl / 4294967296), lo = bl >>> 0;
  [hi, lo].forEach(w => { bytes.push((w >>> 24) & 255, (w >>> 16) & 255, (w >>> 8) & 255, w & 255); });
  let H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const rr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let i = 0; i < bytes.length; i += 64) {
    const w = new Array(64);
    for (let j = 0; j < 16; j++) w[j] = (bytes[i + j * 4] << 24) | (bytes[i + j * 4 + 1] << 16) | (bytes[i + j * 4 + 2] << 8) | bytes[i + j * 4 + 3];
    for (let j = 16; j < 64; j++) { const s0 = rr(w[j - 15], 7) ^ rr(w[j - 15], 18) ^ (w[j - 15] >>> 3), s1 = rr(w[j - 2], 17) ^ rr(w[j - 2], 19) ^ (w[j - 2] >>> 10); w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0; }
    let [a, b, c, d, e, f, g, h] = H;
    for (let j = 0; j < 64; j++) {
      const S1 = rr(e, 6) ^ rr(e, 11) ^ rr(e, 25), ch = (e & f) ^ (~e & g), t1 = (h + S1 + ch + K[j] + w[j]) | 0;
      const S0 = rr(a, 2) ^ rr(a, 13) ^ rr(a, 22), mj = (a & b) ^ (a & c) ^ (b & c), t2 = (S0 + mj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    H = [(H[0] + a) | 0, (H[1] + b) | 0, (H[2] + c) | 0, (H[3] + d) | 0, (H[4] + e) | 0, (H[5] + f) | 0, (H[6] + g) | 0, (H[7] + h) | 0];
  }
  return H.map(x => (x >>> 0).toString(16).padStart(8, '0')).join('');
}
const auditHash = e => sha256(JSON.stringify([e.prev, e.ts, e.actor, e.action, e.note, e.from, e.to, !!e.auto, e.tag || '', e.rv == null ? null : e.rv]));
// Chains any entries that are not yet sealed and stamps the decisions made at this moment with the chain head.
function sealAudit(c, rv, now) {
  let prev = 'genesis:' + c.id;
  c.audit.forEach(e => { if (e.hash) { prev = e.hash; return; } if (e.rv == null) e.rv = rv; e.prev = prev; e.hash = auditHash(e); prev = e.hash; });
  [c.vetting, c.panelDecision, c.execDecision].forEach(d => { if (d && d.at === now) { if (d.rv == null) d.rv = rv; if (!d.head) d.head = prev; } });
  return c;
}
// Returns { ok, entries, brokenAt, reason }. brokenAt is the 1-based position of the first entry that does not check out.
function verifyAudit(c) {
  let prev = 'genesis:' + c.id;
  for (let i = 0; i < c.audit.length; i++) {
    const e = c.audit[i];
    if (!e.hash) return { ok: false, entries: c.audit.length, brokenAt: i + 1, reason: 'This entry was never sealed.' };
    if (e.prev !== prev) return { ok: false, entries: c.audit.length, brokenAt: i + 1, reason: 'An earlier entry was removed, added or reordered.' };
    if (auditHash(e) !== e.hash) return { ok: false, entries: c.audit.length, brokenAt: i + 1, reason: 'This entry was changed after it was written.' };
    prev = e.hash;
  }
  const hashes = new Set(c.audit.map(e => e.hash));
  for (const d of [c.vetting, c.panelDecision, c.execDecision]) if (d && d.head && !hashes.has(d.head)) return { ok: false, entries: c.audit.length, brokenAt: c.audit.length, reason: 'A decision points at an audit entry that no longer exists.' };
  return { ok: true, entries: c.audit.length };
}

// ---- Describing what changed between two sets of rules (shown with each saved version) ----
function diffRules(a0, b0) {
  const A = normRules(a0), B = normRules(b0), out = [];
  const nm = { questions: q => q.short || q.text, rules: r => r.label, controls: c => c.text, readiness: r => r.text };
  const names = { questions: 'Question', rules: 'Rule', controls: 'Control', readiness: 'Readiness check' };
  ['questions', 'rules', 'controls', 'readiness'].forEach(k => {
    const ia = new Map(A[k].map(x => [x.id, x])), ib = new Map(B[k].map(x => [x.id, x]));
    B[k].forEach(x => { if (!ia.has(x.id)) out.push(names[k] + ' added: ' + nm[k](x) + '.'); });
    A[k].forEach(x => { if (!ib.has(x.id)) out.push(names[k] + ' deleted: ' + nm[k](x) + '.'); });
    B[k].forEach(x => {
      const o = ia.get(x.id); if (!o) return;
      if (JSON.stringify(o) === JSON.stringify(x)) return;
      if ((o.enabled !== false) !== (x.enabled !== false)) out.push(names[k] + (x.enabled !== false ? ' enabled: ' : ' disabled: ') + nm[k](x) + '.');
      const rest = (y) => { const z = Object.assign({}, y); delete z.enabled; return JSON.stringify(z); };
      if (rest(o) !== rest(x)) out.push(names[k] + ' changed: ' + nm[k](x) + '.');
    });
    const oa = A[k].map(x => x.id).filter(id => ib.has(id)).join(), ob = B[k].map(x => x.id).filter(id => ia.has(id)).join();
    if (oa !== ob) out.push(names[k] + 's reordered.');
  });
  const flat = (o, p, acc) => { Object.keys(o).forEach(key => { const v = o[key]; if (v && typeof v === 'object') flat(v, p + key + '.', acc); else acc[p + key] = v; }); return acc; };
  const nums = ['scopePoints', 'autonomyPoints', 'tiers', 'budget', 'deadlines', 'pilotDays', 'reviewCadenceDays', 'reviewMaxDays', 'goals', 'quorum'];
  nums.forEach(k => { const fa = flat(A[k] || {}, k + '.', {}), fb = flat(B[k] || {}, k + '.', {}); Object.keys(fb).forEach(p => { if (fa[p] !== fb[p]) out.push(p.replace(/\./g, ' ') + ': ' + (fa[p] == null ? 'none' : fa[p]) + ' to ' + fb[p] + '.'); }); });
  ['minReady', 'execQuorum'].forEach(k => { if (A[k] !== B[k]) out.push(k + ': ' + A[k] + ' to ' + B[k] + '.'); });
  return out;
}

// ---- Rules model, version 2 ----
// Questions hold facts only (wording, type, options). Rules hold meaning: points, tier overrides, guardrails, conditions to clear.
const RULE_KINDS = { guardrail: 'Guardrail', condition: 'Condition to clear', require: 'Required control', override: 'Minimum tier rule', points: 'Points' };
const RULE_PLURAL = { guardrail: 'Guardrails', condition: 'Conditions to clear', require: 'Required controls', override: 'Minimum tier rules', points: 'Points' };
const KIND_ORDER = ['guardrail', 'condition', 'require', 'override', 'points'];
const YN_OPTS = [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }];
const UNKNOWN_OPT = { id: 'unknown', label: 'Not known' };
const SCOPE_OPTS = [{ id: 'team', label: 'One team' }, { id: 'site', label: 'One site' }, { id: 'company', label: 'Whole company' }, { id: 'customer', label: 'Customers or the public' }];
const AUTONOMY_OPTS = [{ id: 'advice', label: 'Gives advice only' }, { id: 'assist', label: 'Assists a person who decides' }, { id: 'automate', label: 'Acts on its own' }];

// ---- Placeholder rules. Every number here is illustrative and meant to be edited. ----
// Wording of the stop questions is deliberately neutral. A stop fires on the answer the rules treat as unacceptable, which is often not "Yes".
function defaultRules() {
  const Q = (id, text, short) => ({ id, text, short, type: 'yesno', allowUnknown: true, enabled: true });
  const YU = (id, text, short) => ({ id, text, short, type: 'yesno', allowUnknown: true, enabled: true });
  const SC = (id, text, short, options) => ({ id, text, short, type: 'single', options: options.map(([i, l]) => ({ id: i, label: l })), allowUnknown: true, enabled: true });
  const P = (qid, label, points) => ({ id: 'pt_' + qid.replace(/^q_/, ''), kind: 'points', label, points, enabled: true, when: [{ src: 'q:' + qid, in: ['yes', 'unknown'] }] });
  const T = (qid, ...vals) => ({ src: 'q:' + qid, in: vals });
  const GUARD = (id, ref, label, message, when) => ({ id, kind: 'guardrail', ref, label, message, enabled: true, when });
  const ANY = (...ts) => ({ any: ts });
  const REQ = (id, ref, label, control, level, when) => ({ id, kind: 'require', ref, label, control, level, enabled: true, when });
  return {
    version: 4, mig3: true, mig6: true,
    ucTypes: [
      { id: 'vendor', label: 'Using a vendor product or feature' },
      { id: 'build', label: 'Building something internally (including agents and automations)' },
      { id: 'model', label: 'Building or training a model' },
      { id: 'use', label: 'Using an AI tool to analyze, write or research' },
    ],
    questions: [
      Q('q_us', 'Does it send company data outside the U.S.?', 'Data leaves the U.S.'),
      Q('q_enc', 'Is any of the data stored or sent unencrypted?', 'Unencrypted data'),
      Q('q_hall', 'Could the AI produce wrong, invented or biased values that people rely on?', 'Wrong or biased outputs possible'),
      Q('q_train', 'Is company data used to train models outside the company?', 'Data used to train outside models'),
      YU('q_ot', 'Can it change how plant equipment or products behave in ways that affect safety?', 'Changes safety-affecting behavior'),
      Q('q_pii', 'Does it use personal data (PII) such as for customers or employees?', 'Uses personally-identifiable data'),
      Q('q_ip', 'Does it expose product designs or other proprietary information?', 'Exposes proprietary information'),
      Q('q_people', 'Does it influence decisions about people?', 'Influences decisions about people'),
      SC('q_listed', 'Is the AI tool on the company\'s approved AI tool list?', 'On approved tool list', [['listed', 'Yes, it is listed'], ['pending', 'Not yet listed, a request is in progress'], ['no', 'No']]),
      SC('q_svc', 'Which kind of AI service would be used?', 'Kind of AI service', [['co', 'A company-approved AI service'], ['pub', 'A public AI service'], ['pers', 'A personal AI account'], ['na', 'No outside AI service (it runs inside company systems)']]),
      SC('q_sens', 'What is the most sensitive information the AI will see or that people will enter?', 'Most sensitive information', [['pub', 'Public or non-sensitive information only'], ['int', 'Internal business information'], ['conf', 'Confidential or proprietary information'], ['pers', 'Personal or regulated data']]),
      YU('q_share', 'Will it share company, customer, employee or partner data with another company?', 'Data shared with another company'),
      YU('q_repo', 'Will any personal (non-company) AI account be connected to company code repositories?', 'Personal AI accounts on code repositories'),
      Object.assign(SC('q_code', 'Where will any AI-written or AI-assisted code, scripts or tests be used? For tests, choose what is being tested.', 'Where AI-written code or tests are used', [['none', 'No AI-written code or tests'], ['personal', 'Personal or team scripts'], ['internal', 'Internal business systems'], ['customer', 'Customer-facing software'], ['firmware', 'Product or plant firmware']]), { showWhen: [{ src: 'type', in: ['build', 'model', 'use'] }] }),
      Object.assign(YU('q_fw', 'Will the AI write, change or test firmware or embedded code that affects safety?', 'AI writes or tests safety-affecting firmware'), { showWhen: [{ src: 'q:q_code', in: ['firmware', 'unknown'] }] }),
      Object.assign(SC('q_target', 'What does it act on?', 'What it acts on', [['plant', 'Plant equipment or products'], ['it', 'IT systems'], ['records', 'Customer or financial records'], ['na', 'None of these']]), { showWhen: [{ src: 'autonomy', in: ['automate'] }] }),
      Object.assign(YU('q_model', 'Is an AI model central to how this works?', 'AI model is central'), { showWhen: [{ src: 'type', in: ['vendor', 'build', 'use'] }] }),
      Object.assign(YU('q_outside', 'Does it read content from outside sources (such as web pages, outside emails or documents), or can people outside the company type to it?', 'Reads outside content or takes outside input'), { showWhen: [ANY({ src: 'type', in: ['model'] }, T('q_model', 'yes', 'unknown'))] }),
      Object.assign(YU('q_tools', 'Can it use tools, connectors or credentials to take actions (for example send messages, change records or run code)?', 'Uses tools, connectors or credentials'), { showWhen: [ANY({ src: 'type', in: ['model'] }, T('q_model', 'yes', 'unknown'))] }),
      SC('q_access', 'How much company data can it reach?', 'Data access scope', [['lim', 'Only the specific rows or datasets it needs'], ['sys', 'Whole datasets or systems'], ['broad', 'Broad access across several internal data stores']]),
      YU('q_pub', 'Will it produce content that is published or used outside the company, including translations?', 'Produces content used outside the company'),
      YU('q_rec', 'Does it record, transcribe or keep conversations, meetings or personnel data?', 'Records or keeps conversations or personnel data'),
      Object.assign(YU('q_patent', 'Does it touch inventions or patent material?', 'Touches inventions or patents'), { showWhen: [T('q_ip', 'yes', 'unknown')] }),
      Object.assign(YU('q_trainpii', 'Is personal data used to train or tune the model?', 'Personal data used to train or tune'), { showWhen: [{ src: 'type', in: ['model'] }] }),
      YU('q_decide', 'Will its outputs be used for decisions with significant financial or operational consequences (for example contract, regulatory or technical specification review)?', 'Outputs drive consequential decisions'),
    ],
    rules: [
      GUARD('g_enc', 'BR-67', 'Unencrypted data', 'Data must be encrypted in storage and in transit before this can proceed.', [T('q_enc', 'yes', 'unknown')]),
      GUARD('g_train', 'BR-02', 'Data used to train outside models', 'Company data cannot be used to train models outside the company. Use a service that does not train on your data, or remove the data.', [T('q_train', 'yes', 'unknown')]),
      GUARD('g_br01', 'BR-01', 'Sensitive information with a public or personal AI service', 'Confidential, personal or unknown-sensitivity information cannot go to a public or personal AI service. Use a company-approved service or remove the information.', [T('q_sens', 'conf', 'pers', 'unknown'), T('q_svc', 'pub', 'pers', 'unknown')]),
      GUARD('g_br03', 'BR-03', 'AI tool not on the approved list', 'Use only an AI tool on the company\'s approved list, or ask for the tool to be added. (This question stands in until the AI tool catalog exists.)', [T('q_listed', 'no', 'unknown')]),
      GUARD('g_br04', 'BR-04', 'Personal AI accounts on code repositories', 'Disconnect personal AI accounts from company code repositories, or use a company account.', [T('q_repo', 'yes', 'unknown')]),
      { id: 'k_br03', kind: 'condition', ref: 'BR-03', label: 'Add the tool to the approved list', message: 'The tool must be added to the approved AI tool list before pilot.', clearBy: 'pilot', enabled: true, when: [T('q_listed', 'pending')] },
      REQ('rq_ot', 'BR-06', 'Can change safety-affecting behavior of equipment or products', 'c_bounds', 'required', [T('q_ot', 'yes', 'unknown')]),
      REQ('rq_fw', 'BR-07', 'AI writes, changes or tests firmware that affects safety', 'c_validate', 'required', [T('q_fw', 'yes', 'unknown')]),
      REQ('rq_target', 'BR-08', 'Acts on its own on systems, equipment or records', 'c_rollback', 'required', [T('q_target', 'plant', 'it', 'records', 'unknown')]),
      REQ('rq_auto_kill', 'BR-08', 'Acts on its own', 'c_kill', 'recommended', [{ src: 'autonomy', in: ['automate'] }]),
      REQ('rq_auto_log', 'BR-08', 'Acts on its own', 'c_log', 'recommended', [{ src: 'autonomy', in: ['automate'] }]),
      REQ('rq_auto_access', 'BR-08', 'Acts on its own', 'c_access', 'recommended', [{ src: 'autonomy', in: ['automate'] }]),
      REQ('rq_cust', 'BR-09', 'Customer-facing', 'c_escalate', 'required', [{ src: 'scope', in: ['customer'] }]),
      REQ('rq_share', 'BR-02', 'Shares data with another company', 'c_share', 'required', [T('q_share', 'yes', 'unknown')]),
      REQ('rq_human_code', 'BR-19', 'AI-written code or tests for customers or firmware', 'c_human', 'required', [T('q_code', 'customer', 'firmware', 'unknown')]),
      REQ('rq_human_int', 'BR-19', 'AI-written code or tests for internal business systems', 'c_human', 'recommended', [T('q_code', 'internal')]),
      REQ('rq_human_cust', 'BR-19', 'Customer-facing output', 'c_human', 'required', [{ src: 'scope', in: ['customer'] }]),
      REQ('rq_doc_model', 'BR-24', 'Builds or trains a model', 'c_docs', 'required', [{ src: 'type', in: ['model'] }]),
      REQ('rq_doc_central', 'BR-24', 'An AI model is central to how it works', 'c_docs', 'required', [{ src: 'type', in: ['vendor', 'build', 'use'] }, T('q_model', 'yes', 'unknown')]),
      REQ('rq_human_decide', 'BR-10', 'Outputs drive consequential decisions', 'c_human', 'required', [T('q_decide', 'yes', 'unknown')]),
      { id: 'o_ot', kind: 'override', ref: 'BR-06', label: 'Changes safety-affecting behavior', minTier: 'high', enabled: true, when: [T('q_ot', 'yes')] },
      { id: 'o_people', kind: 'override', label: 'Influences decisions about people', minTier: 'high', enabled: true, when: [T('q_people', 'yes')] },
      { id: 'o_customer', kind: 'override', label: 'Customer-facing', minTier: 'moderate', enabled: true, when: [{ src: 'scope', in: ['customer'] }] },
      { id: 'o_auto', kind: 'override', label: 'Acts without a person in the loop', minTier: 'moderate', enabled: true, when: [{ src: 'autonomy', in: ['automate'] }] },
      P('q_us', 'Data leaves the U.S.', 2), P('q_enc', 'Unencrypted data', 3), P('q_hall', 'Wrong or biased outputs possible', 3), P('q_train', 'Data used to train outside models', 3),
      P('q_ot', 'Changes safety-affecting behavior', 4), P('q_pii', 'Uses personally-identifiable data', 3), P('q_ip', 'Exposes proprietary information', 3), P('q_people', 'Influences decisions about people', 3),
      P('q_decide', 'Outputs drive consequential decisions', 2),
      { id: 'pt_access_broad', kind: 'points', ref: 'BR-14', label: 'Broad access across internal data stores', points: 2, enabled: true, when: [T('q_access', 'broad', 'unknown')] },
      { id: 'pt_access_sys', kind: 'points', ref: 'BR-14', label: 'Access to whole datasets or systems', points: 1, enabled: true, when: [T('q_access', 'sys')] },
      { id: 'pt_pub', kind: 'points', ref: 'BR-26', label: 'Produces content used outside the company', points: 1, enabled: true, when: [T('q_pub', 'yes', 'unknown')] },
      { id: 'pt_rec', kind: 'points', ref: 'BR-29', label: 'Records or keeps conversations or personnel data', points: 1, enabled: true, when: [T('q_rec', 'yes', 'unknown')] },
      { id: 'pt_patent', kind: 'points', ref: 'BR-33', label: 'Touches inventions or patents', points: 2, enabled: true, when: [T('q_patent', 'yes', 'unknown')] },
      REQ('rq_scope_broad', 'BR-14', 'Broad access across internal data stores', 'c_scope', 'required', [T('q_access', 'broad', 'unknown')]),
      REQ('rq_scope_sys', 'BR-14', 'Access to whole datasets or systems', 'c_scope', 'recommended', [T('q_access', 'sys')]),
      REQ('rq_minimize', 'BR-15', 'Personal data used to train or tune', 'c_minimize', 'required', [T('q_trainpii', 'yes', 'unknown')]),
      REQ('rq_repr', 'BR-16', 'Builds or trains a model', 'c_repr', 'recommended', [{ src: 'type', in: ['model'] }]),
      { id: 'pt_code_int', kind: 'points', ref: 'BR-31', label: 'AI-written code or tests in internal business systems', points: 1, enabled: true, when: [T('q_code', 'internal')] },
      { id: 'pt_code_cust', kind: 'points', ref: 'BR-31', label: 'AI-written code or tests in customer-facing software', points: 2, enabled: true, when: [T('q_code', 'customer')] },
      { id: 'pt_code_fw', kind: 'points', ref: 'BR-31', label: 'AI-written code or tests for product or plant firmware', points: 3, enabled: true, when: [T('q_code', 'firmware')] },
      { id: 'pt_target_it', kind: 'points', ref: 'BR-37', label: 'Acts on its own on IT systems', points: 2, enabled: true, when: [T('q_target', 'it')] },
      { id: 'pt_target_rec', kind: 'points', ref: 'BR-37', label: 'Acts on its own on customer or financial records', points: 2, enabled: true, when: [T('q_target', 'records')] },
    ],
    scopePoints: { team: 0, site: 1, company: 2, customer: 3 },
    autonomyPoints: { advice: 0, assist: 1, automate: 3 },
    tiers: { lowMax: 3, moderateMax: 7, highMax: 12 },
    budget: { perUserMonthly: 200 },
    controls: [
      { id: 'c_human', short: 'Human review of outputs', text: 'A qualified person reviews outputs before they are relied on (all, or a sample, depending on risk)', credit: 3, enabled: true, attest: 'required' },
      { id: 'c_test', short: 'Tested before launch', text: 'Accuracy tested on real examples before launch', credit: 2, enabled: true, attest: 'required' },
      { id: 'c_access', short: 'Role-based access', text: 'Role-based access to the tool and its data', credit: 2, enabled: true, attest: 'optional' },
      { id: 'c_log', short: 'Inputs and outputs logged', text: 'Inputs and outputs are logged', credit: 1, enabled: true, attest: 'optional' },
      { id: 'c_kill', applies: [{ src: 'autonomy', in: ['automate'] }], short: 'Switch-off within an hour', text: 'Can be switched off within an hour', credit: 1, enabled: true, attest: 'optional' },
      { id: 'c_bounds', applies: [T('q_ot', 'yes', 'unknown')], short: 'Fixed limits outside the AI', text: 'Its limits are fixed and enforced outside the AI, and safety-critical decisions stay with a person', credit: 3, enabled: true, attest: 'required' },
      { id: 'c_validate', applies: [T('q_fw', 'yes', 'unknown')], short: 'Independent validation', text: 'Independent validation before release, such as the external UL certification gate', credit: 3, enabled: true, attest: 'required' },
      { id: 'c_rollback', applies: [T('q_target', 'plant', 'it', 'records', 'unknown')], short: 'Backup or rollback', text: 'Backup and restore, or rollback, is in place for what it acts on', credit: 2, enabled: true, attest: 'required' },
      { id: 'c_escalate', applies: [{ src: 'scope', in: ['customer'] }], short: 'Approved topics, human escalation', text: 'Answers are limited to approved topics, and customers can reach a person', credit: 3, enabled: true, attest: 'required' },
      { id: 'c_docs', short: 'Model documented', text: 'The model is documented: its data sources, training process, behavior, limitations and decision logic, available to authorized personnel for audit', credit: 1, enabled: true, attest: 'optional' },
      { id: 'c_scope', applies: [T('q_access', 'sys', 'broad', 'unknown')], short: 'Data access scoped', text: 'Data access is scoped to the datasets or rows it needs, and totals, margins and employee data are blocked unless approved', credit: 2, enabled: true, attest: 'optional' },
      { id: 'c_minimize', applies: [T('q_trainpii', 'yes', 'unknown')], short: 'Training data minimized', text: 'Personal data used to train or tune is justified, minimized and anonymized where possible', credit: 1, enabled: true, attest: 'optional' },
      { id: 'c_repr', applies: [{ src: 'type', in: ['model'] }], short: 'Training data representative', text: 'The training data is representative and balanced for how the model will be used', credit: 1, enabled: true, attest: 'optional' },
      { id: 'c_share', applies: [T('q_share', 'yes', 'unknown')], short: 'Data sharing approved', text: 'An authorized person approved the data sharing (a contract, or the approver\'s written reason, as evidence)', credit: 2, enabled: true, attest: 'required' },
    ],
    readiness: [
      { id: 'r_access', text: 'The data is accessible to the team', enabled: true },
      { id: 'r_steward', text: 'A named data steward exists', enabled: true },
      { id: 'r_meta', text: 'Definitions and metadata are complete', enabled: true },
      { id: 'r_quality', text: 'Data quality has been checked', enabled: true },
    ],
    minReady: 2,
    deadlines: {
      vetting: { low: 2, moderate: 3, high: 3, critical: 3 },
      panel: { low: 5, moderate: 7, high: 10, critical: 14 },
      consult: { low: 3, moderate: 4, high: 5, critical: 5 },
      exec: { low: 7, moderate: 7, high: 7, critical: 7 },
    },
    pilotDays: { low: 14, moderate: 30, high: 45, critical: 60 },
    reviewCadenceDays: { low: 365, moderate: 180, high: 90, critical: 60 },
    reviewMaxDays: { low: 1095, moderate: 1095, high: 1095, critical: 1095 },
    goals: defaultGoals(),
    quorum: { moderate: 2, high: 3, critical: 3 },
    execQuorum: 3,
    // Business units: every unit has an adviser, which is the governance lead unless someone else is named.
    units: [
      { id: 'u_ops', label: 'Plant operations and manufacturing', adviserId: 'p_jordan' },
      { id: 'u_eng', label: 'Engineering and product development', adviserId: 'p_noor' },
      { id: 'u_cs', label: 'Customer service and sales', adviserId: 'p_grant' },
      { id: 'u_corp', label: 'Finance, HR and IT', adviserId: 'p_jordan' },
      { id: 'u_legal', label: 'Legal and compliance', adviserId: 'p_elena' },
    ],
    // Consult areas: who is asked, what is asked by default, and the answers that suggest or require the consult. A trigger row needs all its terms; the area takes the strongest row that matches.
    consultAreas: [
      { id: 'ca_cyber', label: 'Cybersecurity', personId: 'p_ravi', enabled: true, question: 'Please assess the security of this use case: what it connects to, what data it handles and how that is protected.', triggers: [
        { label: 'Acts on its own on IT systems', level: 'required', when: [T('q_target', 'it')] },
        { label: 'Internal build, data sharing, tools or connectors, or broad data access', level: 'recommended', when: [ANY({ src: 'type', in: ['build'] }, T('q_share', 'yes', 'unknown'), T('q_tools', 'yes', 'unknown'), T('q_access', 'broad', 'unknown'))] }] },
      { id: 'ca_legal', label: 'Legal', personId: 'p_claire', enabled: true, question: 'Please advise on legal and regulatory points: contracts, regulation, intellectual property and external content. Where data would be shared outside the company, please verify that consent to share it has been given.', triggers: [
        { label: 'Data would be shared outside the company', level: 'required', when: [T('q_share', 'yes', 'unknown')] },
        { label: 'Customer-facing, vendor product, outside content or patents', level: 'recommended', when: [ANY({ src: 'scope', in: ['customer'] }, { src: 'type', in: ['vendor'] }, T('q_pub', 'yes', 'unknown'), T('q_patent', 'yes', 'unknown'))] }] },
      { id: 'ca_it', label: 'IT standards', personId: 'p_mei', enabled: true, question: 'Please say whether this purchased or built application fits IT standards and the approved tool list.', triggers: [
        { label: 'A purchased or built application not yet on the approved AI tool list', level: 'recommended', when: [{ src: 'type', in: ['vendor', 'build'] }, T('q_listed', 'pending')] }] },
      { id: 'ca_data', label: 'Data steward', personId: 'p_omar', enabled: true, baseline: true, question: 'Please check where the data originates, where it is processed, whether it leaves company-controlled environments, who else has access, and what sensitive data is involved.', triggers: [
        { label: 'Personal data, proprietary information, confidential or personal data level, or data leaving the U.S.', level: 'required', when: [ANY(T('q_pii', 'yes', 'unknown'), T('q_ip', 'yes', 'unknown'), T('q_sens', 'conf', 'pers', 'unknown'), T('q_us', 'yes', 'unknown'))] }] },
      { id: 'ca_ai', label: 'AI safety', personId: 'p_mina', enabled: true, question: 'Please assess AI-specific risks such as prompt injection, misuse, wrong or invented outputs, and bias.', triggers: [
        { label: 'Outside content together with a way to act', level: 'required', when: [T('q_outside', 'yes', 'unknown'), ANY(T('q_tools', 'yes', 'unknown'), T('q_target', 'plant', 'it', 'records', 'unknown'), { src: 'autonomy', in: ['automate'] })] },
        { label: 'Unreliable output with consequences', level: 'recommended', when: [T('q_hall', 'yes', 'unknown'), ANY({ src: 'autonomy', in: ['automate'] }, T('q_target', 'plant', 'it', 'records', 'unknown'), T('q_decide', 'yes', 'unknown'), T('q_people', 'yes', 'unknown'))] },
        { label: 'Customer-facing and either automatic or possibly wrong', level: 'recommended', when: [{ src: 'scope', in: ['customer'] }, ANY({ src: 'autonomy', in: ['automate'] }, T('q_hall', 'yes', 'unknown'))] },
        { label: 'Tools or connectors that run automatically', level: 'recommended', when: [T('q_tools', 'yes', 'unknown'), { src: 'autonomy', in: ['automate'] }] },
        { label: 'An internal build with a central AI model and reach', level: 'recommended', when: [{ src: 'type', in: ['build'] }, T('q_model', 'yes', 'unknown'), ANY(T('q_tools', 'yes', 'unknown'), { src: 'autonomy', in: ['automate'] }, { src: 'scope', in: ['customer'] })] },
        { label: 'A model-building case with reach', level: 'recommended', when: [{ src: 'type', in: ['model'] }, ANY(T('q_tools', 'yes', 'unknown'), { src: 'autonomy', in: ['automate'] }, { src: 'scope', in: ['customer'] })] }] },
      { id: 'ca_ops', label: 'Operations', personId: 'p_jack', enabled: true, question: 'Please assess the effect on plant and field operations, and whether the process owners can run it safely.', triggers: [
        { label: 'Can affect plant equipment or products', level: 'recommended', when: [ANY(T('q_ot', 'yes', 'unknown'), T('q_target', 'plant'))] }] },
    ],
    // Training: optional gate on submitting; contact is shown to anyone blocked.
    trainings: [
      { id: 't_intro', title: 'AI at BWC: introduction and policy', link: 'https://example.com/training/ai-intro', summary: 'What AI can and cannot do, the AI policy, approved tools and how to get a new use approved.', refreshMonths: 12, version: '2026.1', requiredToSubmit: true, contact: 'ai-training@example.com', appliesTo: 'all' },
      { id: 't_safe', title: 'Using AI safely with company data', link: 'https://example.com/training/ai-safe', summary: 'Handling sensitive and personal data, prompts, and outputs you rely on.', refreshMonths: 12, version: '2026.1', requiredToSubmit: false, contact: 'ai-training@example.com', appliesTo: 'all' },
    ],
  };
}

// Bring rules saved by an earlier version (weights and safety gates on the questions) up to version 2. Safe to call on any rules.
// Dashboard goals. "better" says which direction meets the goal (equal or better is green).
const GOAL_DEFS = [
  { id: 'avgDays', label: 'Average time to a final outcome', unit: 'days', min: 1, max: 999, better: 'lower' },
  { id: 'reachProd', label: 'Percent of cases reaching production', unit: '%', min: 1, max: 100, better: 'higher' },
  { id: 'sentBack', label: 'Percent sent back at least once', unit: '%', min: 0, max: 100, better: 'lower' },
  { id: 'overdue', label: 'Percent of cases overdue', unit: '%', min: 0, max: 100, better: 'lower' },
  { id: 'value', label: 'Value in pilot and production ($000)', unit: '$000', min: 1, max: 999999999, better: 'higher' }
];
function defaultGoals() { return { avgDays: { on: true, value: 30 }, reachProd: { on: true, value: 60 }, sentBack: { on: true, value: 30 }, overdue: { on: true, value: 25 }, value: { on: true, value: 500 } }; }
const goalMet = (d, actual, goal) => d.better === 'lower' ? actual <= goal : actual >= goal;
function normRules(R0) {
  // Version 3 is the current shape. Anything older is replaced by the defaults (the v27 build starts with its own data).
  if (!R0 || R0.version !== 4) return defaultRules();
  if (!R0.mig3) {
    const d = defaultRules();
    ['questions', 'rules', 'controls'].forEach(k => { R0[k] = R0[k] || []; const have = new Set(R0[k].map(x => x.id)); d[k].forEach(x => { if (!have.has(x.id)) R0[k].push(x); }); });
    ['units', 'consultAreas', 'trainings'].forEach(k => { if (!R0[k]) R0[k] = d[k]; });
    R0.mig3 = true;
  }
  if (!R0.mig4) {
    const d = defaultRules().consultAreas;
    ['ca_legal', 'ca_data'].forEach(id => { const i = (R0.consultAreas || []).findIndex(a => a.id === id), n = d.find(a => a.id === id); if (i >= 0 && n) R0.consultAreas[i] = Object.assign({}, R0.consultAreas[i], { label: n.label, question: n.question, triggers: n.triggers }); });
    R0.mig4 = true;
  }
  if (!R0.mig6) { if (R0.quorum) ['moderate', 'high', 'critical'].forEach(t => { if (R0.quorum[t] != null) R0.quorum[t] += 1; }); R0.mig6 = true; }
  if (!R0.mig5) { const a = (R0.consultAreas || []).find(x => x.id === 'ca_legal'); if (a && a.label === 'Legal and Government Affairs') a.label = 'Legal'; R0.mig5 = true; }
  if (!R0.units) R0.units = defaultRules().units; if (!R0.consultAreas) R0.consultAreas = defaultRules().consultAreas; if (!R0.trainings) R0.trainings = defaultRules().trainings;
  if (!R0.budget) R0.budget = { perUserMonthly: 200 };
  if (!R0.ucTypes) R0.ucTypes = defaultRules().ucTypes;
  if (!R0.reviewMaxDays) R0.reviewMaxDays = defaultRules().reviewMaxDays;
  if (!R0.goals) R0.goals = defaultGoals();
  const dc = defaultRules().controls; (R0.controls || []).forEach(k => { if (!k.short) { const d = dc.find(x => x.id === k.id); if (d) k.short = d.short; } });
  return R0;
}

const FORM_FIELDS = [
  { k: 'ucType', label: 'Type of AI use case' },
  { k: 'problem', label: 'Problem to solve' },
  { k: 'solution', label: 'Proposed solution' },
  { k: 'businessCase', label: 'Business case' },
  { k: 'successMetric', label: 'Success metric' },
  { k: 'dataRequired', label: 'Data required' },
  { k: 'process', label: 'Affected process or department' },
  { k: 'owner', label: 'Owner' },
  { k: 'sponsor', label: 'Sponsor' },
  { k: 'costUSD', label: 'One-time cost (zero is fine)' },
  { k: 'ongoingCostUSD', label: 'Ongoing cost (zero is fine)' },
  { k: 'budgetSource', label: 'Whose budget pays for it' },
];
// A number, including zero, counts as an answer. Only an empty value is missing.
const isBlank = v => v == null || (typeof v === 'string' && !v.trim());
const ONGOING_BASIS = { total_year: 'total, per year', per_user_month: 'per user, per month' };
// BR-43: a high per-user running cost is a reason for extra budget scrutiny. It never stops or scores a case.
function budgetFlag(form, R0) {
  const R = normRules(R0), limit = +(R.budget || {}).perUserMonthly;
  return form && form.ongoingBasis === 'per_user_month' && !isBlank(form.ongoingCostUSD) && +form.ongoingCostUSD > limit ? { amount: +form.ongoingCostUSD, limit } : null;
}
const blankForm = (owner, ownerId) => ({ ucType: '', problem: '', solution: '', businessCase: '', successMetric: '', measures: [], attesters: {}, evidence: {}, dataRequired: '', process: '', users: '', owner: owner || '', ownerId: ownerId || '', sponsor: '', valueUSD: '', costUSD: '', ongoingCostUSD: '', ongoingBasis: 'total_year', budgetSource: '', alternatives: '', costOfNothing: '', scope: 'team', autonomy: 'advice', answers: {}, readiness: {}, controls: [] });

// ---- Business units, advisers, consult areas, training and catalog matching ----
const unitOf = pid => (byId(pid) || {}).unit || '';
const leadId = () => (PEOPLE.find(p => p.role === 'lead') || {}).id;
function adviserForUnit(uid, R0) { const u = ((normRules(R0).units) || []).find(x => x.id === uid); return u && u.adviserId && byId(u.adviserId) ? u.adviserId : leadId(); }
function assignAdviser(c, R0, unitId) { c.unitId = unitId || c.unitId || unitOf(c.submitterId); c.adviserId = adviserForUnit(c.unitId, R0); return c; }
function consultNeeds(form, R0) {
  const R = normRules(R0), out = {};
  (R.consultAreas || []).filter(a => a.enabled !== false).forEach(a => {
    const o = { id: a.id, label: a.label, personId: a.personId, question: a.question || '', level: null, reasons: [] };
    if (a.baseline) { o.level = 'recommended'; o.reasons.push({ level: 'recommended', label: 'Recommended for every use case for now' }); }
    (a.triggers || []).forEach(tr => {
      if ((tr.when || []).length && tr.when.every(t => termHit(t, form || {}, R))) {
        const lvl = tr.level === 'required' ? 'required' : 'recommended';
        if (lvl === 'required') o.level = 'required'; else if (!o.level) o.level = 'recommended';
        o.reasons.push({ level: lvl, label: tr.label });
      }
    });
    if (o.level) out[a.id] = o;
  });
  return out;
}
const TRAIN_DAY = 86400000;
const trainingApplies = (t, person) => !t.appliesTo || t.appliesTo === 'all' || (Array.isArray(t.appliesTo) && t.appliesTo.includes(person.role));
const trainingRec = (training, pid, tid) => ((training || {})[pid] || {})[tid] || null;
function trainingState(training, pid, t, now) {
  const r = trainingRec(training, pid, t.id); if (!r) return 'due';
  const exp = r.at + (t.refreshMonths || 12) * 30.4375 * TRAIN_DAY;
  return now > exp ? 'overdue' : exp - now < 30 * TRAIN_DAY ? 'soon' : 'current';
}
// The gate is off when no completion data is passed in (tests and the sample builder).
function trainingBlocks(training, person, R0, now) {
  if (!training) return [];
  return (normRules(R0).trainings || []).filter(t => t.requiredToSubmit && trainingApplies(t, person) && ['due', 'overdue'].includes(trainingState(training, person.id, t, now)));
}
const trainingMsg = bl => 'Training is required before you can submit: ' + bl.map(t => t.title).join('; ') + '. Open Training in the menu to complete it.' + (bl[0] && bl[0].contact ? ' Questions or stuck? Contact ' + bl[0].contact + '.' : '');
const MATCH_STOP = new Set('that this with from they them their have has had will would could should about into over under than then when where which while what your you are was were been being also only each other more most some such very can may might must not and for the our out use used using make made way any all new'.split(' '));
const matchTerms = text => [...new Set(String(text || '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 4 && !MATCH_STOP.has(w)))];
function matchCatalog(text, tools, cases, limit, excludeId) {
  const words = matchTerms(text); if (!words.length) return [];
  const hits = txt => { const lc = String(txt || '').toLowerCase(); return words.filter(w => lc.includes(w)); }, items = [];
  (tools || []).filter(t => t.status !== 'draft').forEach(t => { const h = hits(t.name + ' ' + (t.purpose || '')); if (h.length) items.push({ kind: 'tool', ref: t, words: h, score: h.length }); });
  (cases || []).filter(c => c.id !== excludeId).forEach(c => { const h = hits(c.title + ' ' + (c.idea || '') + ' ' + ((c.form || {}).problem || '') + ' ' + ((c.form || {}).solution || '')); if (h.length) items.push({ kind: 'case', ref: c, words: h, score: h.length }); });
  return items.sort((a, b) => b.score - a.score).slice(0, limit || 10);
}
function newCase(id, title, idea, submitterId, now, rv) {
  return sealAudit({ id, title, idea, submitterId, createdAt: now, stage: 'suggestion', stageSince: now, dueAt: null, returned: null, form: blankForm(byId(submitterId).name, submitterId), evidenceItems: [], signoff: null, ownerAccepted: null, acceptance: null, measurements: [], attestations: [], triage: null, scoring: null, tier: null, vetting: null, consults: [], panelNotes: [], panelDecision: null, briefing: null, execDecision: null, pilot: null, production: null, closed: null, audit: [{ ts: now, actor: submitterId, action: 'Suggestion logged', note: idea, from: null, to: 'suggestion', auto: false, tag: '' }], outbox: [] }, rv || 1, now);
}

// ---- Owner, measures and attestation helpers ----
const OWNER_ROLES = ['submitter', 'stakeholder', 'exec'];
const ownerOf = c => (c.form && c.form.ownerId) || (PEOPLE.find(p => p.name === (c.form && c.form.owner)) || {}).id || c.submitterId;
const syncOwner = c => { if (c.form.ownerId) c.form.owner = byId(c.form.ownerId).name; };
const EVIDENCE_MAX = 500 * 1024, EVIDENCE_TYPES = 'pdf, png, jpg, gif, webp, txt, md, json, csv, docx, xlsx, pptx, zip';
const EVIDENCE_EXT = /\.(pdf|png|jpe?g|gif|webp|txt|md|json|csv|docx|xlsx|pptx|zip)$/i;
const DIFF_LABEL = { ucType: 'Type of AI use case', problem: 'Problem', solution: 'Proposed solution', businessCase: 'Business case', successMetric: 'Success metric', dataRequired: 'Data required', process: 'Process', users: 'Users', sponsor: 'Sponsor', valueUSD: 'Annual value', costUSD: 'Cost', scope: 'Reach', autonomy: 'Autonomy', costUSD: 'One-time cost', ongoingCostUSD: 'Ongoing cost', ongoingBasis: 'Ongoing cost basis', budgetSource: 'Budget source', alternatives: 'Alternatives considered', costOfNothing: 'Cost of doing nothing', measures: 'KPIs', answers: 'Risk answers', readiness: 'Data readiness answers', controls: 'Controls', attesters: 'Attesters', evidence: 'Evidence' };
const changedFields = (a, b) => Object.keys(DIFF_LABEL).filter(k => JSON.stringify(a[k] == null ? '' : a[k]) !== JSON.stringify(b[k] == null ? '' : b[k])).map(k => DIFF_LABEL[k]);
const MEASURE_SLOTS = 4;
const MEAS_DIR = { lower: 'Lower is better', higher: 'Higher is better' };
// Validates and normalizes the measure rows typed by a submitter or an approver. Blank rows are ignored.
function parseMeasures(rows, strict) {
  const out = [];
  (rows || []).forEach((r, i) => {
    const name = String((r && r.name) || '').trim(); if (!name) return;
    const num = v => (v === '' || v == null || isNaN(+v) ? null : +v);
    const m = { id: r.id || 'm' + (i + 1), name, dir: r.dir === 'higher' ? 'higher' : 'lower', target: num(r.target), scaleUp: num(r.scaleUp), stop: num(r.stop) };
    if (strict) {
      if (m.target === null || m.stop === null) throw new Error('KPI "' + name + '" needs a number for its target and for its stop limit.');
      if (m.dir === 'lower' && !(m.stop > m.target)) throw new Error('KPI "' + name + '": where lower is better, the stop limit must be above the target.');
      if (m.dir === 'higher' && !(m.stop < m.target)) throw new Error('KPI "' + name + '": where higher is better, the stop limit must be below the target.');
      if (m.scaleUp !== null && ((m.dir === 'lower' && m.scaleUp > m.target) || (m.dir === 'higher' && m.scaleUp < m.target))) throw new Error('KPI "' + name + '": the scale-up target must be at least as good as the target.');
    }
    out.push(m);
  });
  return out;
}
// 'stop' = past the stop limit, 'scale' = reached the scale-up target, 'met', or 'short' = between the stop limit and the target.
function measureState(m, v) {
  if (v == null || isNaN(+v)) return null; v = +v;
  const lo = m.dir === 'lower';
  if (m.stop != null && (lo ? v >= m.stop : v <= m.stop)) return 'stop';
  if (m.scaleUp != null && (lo ? v <= m.scaleUp : v >= m.scaleUp)) return 'scale';
  if (m.target != null && (lo ? v <= m.target : v >= m.target)) return 'met';
  return 'short';
}
const MEAS_STATE = { stop: 'Stop limit passed', scale: 'Scale-up target reached', met: 'Target met', short: 'Below target' };
// The approved measures with the latest value recorded for each.
function measureBoard(c) {
  const ms = (c.acceptance && c.acceptance.measures) || [];
  return ms.map(m => { let last = null; (c.measurements || []).forEach(x => { if (x.values && x.values[m.id] != null) last = { v: x.values[m.id], at: x.at, by: x.by }; }); return { m, value: last ? last.v : null, at: last ? last.at : null, state: last ? measureState(m, last.v) : null }; });
}
const measureFlags = c => (['pilot', 'production'].includes(c.stage) ? measureBoard(c).filter(r => r.state === 'stop') : []);
const acceptanceExpired = (c, now) => !!(c.acceptance && ['pilot', 'production'].includes(c.stage) && c.acceptance.validUntil && now > c.acceptance.validUntil);
const attOf = (atts, cid) => (atts || []).find(a => a.controlId === cid);
// Credit for a control claimed on a case (wave 2): a claimed control earns its credit when claimed. Only a declined confirmation removes it.
function controlCredit(form, R, atts) {
  let credit = 0; const withheld = [], inapplicable = [];
  (form.controls || []).forEach(id => {
    const k = R.controls.find(x => x.id === id); if (!k) return;
    if (!ctlApplies(k, form, R)) { inapplicable.push(id); return; }
    const a = attOf(atts, id);
    if (a && a.status === 'declined') withheld.push({ id, why: 'declined' }); else credit += k.credit;
  });
  return { credit, withheld, inapplicable };
}
// How well a claimed control is backed: confirmed by a person, has evidence (text or an attachment), neither, or declined by the confirmer.
const hasEvidence = (c, id) => !!(String(((c.form || {}).evidence || {})[id] || '').trim() || String((attOf(c.attestations, id) || {}).evidence || '').trim() || (c.evidenceItems || []).some(e => e.controlId === id && !e.removed));
function controlStatus(c, id) { const a = attOf(c.attestations, id); if (a && a.status === 'declined') return 'declined'; if (a && a.status === 'confirmed') return 'confirmed'; return hasEvidence(c, id) ? 'evidence' : 'neither'; }
const CTL_STATUS = { confirmed: 'Confirmed', evidence: 'Has evidence', neither: 'No confirmation or evidence', declined: 'Confirmation declined' };
function supportView(c, R0) {
  const R = normRules(R0), needs = controlNeeds(c.form || {}, R);
  const rows = ((c.form || {}).controls || []).map(id => R.controls.find(k => k.id === id)).filter(Boolean).map(k => { const a = attOf(c.attestations, k.id); return { na: !ctlApplies(k, c.form || {}, R), id: k.id, text: k.text, short: k.short || k.text, credit: k.credit, status: controlStatus(c, k.id), pending: !!(a && a.status === 'pending'), asked: a ? a.personId : null, required: (needs[k.id] || {}).level === 'required' }; });
  const counted = rows.filter(r => !r.na && r.status !== 'declined').reduce((s, r) => s + r.credit, 0), supported = rows.filter(r => !r.na && (r.status === 'confirmed' || r.status === 'evidence')).reduce((s, r) => s + r.credit, 0);
  const inh = c.scoring ? c.scoring.inherent : null, net = inh == null ? null : Math.max(0, inh - supported);
  return { rows, counted, supported, net, netTier: net == null ? null : tierFromScore(net, R) };
}
// The open items an approver must knowingly override: unsupported or declined controls, required controls not claimed, concerns from consults, and conditions still to clear.
const ovSlug = id => String(id).replace(/[^a-zA-Z0-9]+/g, '_');
function looseThreads(c, R0) {
  const R = normRules(R0), out = [], sv = supportView(c, R);
  sv.rows.filter(r => !r.na).forEach(r => { if (r.status === 'declined') { const a = attOf(c.attestations, r.id) || {}; out.push({ id: 'ctl:' + r.id, kind: 'declined', label: r.text, head: r.short || r.text, who: byId(a.personId).name, detail: a.text || '' }); } else if (r.status === 'neither') out.push({ id: 'ctl:' + r.id, kind: 'unsupported', label: r.text, head: r.short || r.text, detail: r.pending ? 'no confirmation yet and no evidence' : 'no confirmation and no evidence' }); });
  unclaimedRequired(c.form || {}, R).forEach(n => out.push({ id: 'req:' + n.id, kind: 'missing', label: n.text, head: n.text, detail: 'required for this use case but not claimed' }));
  (c.consults || []).filter(k => k.status === 'responded' && k.response && (k.response.stance === 'concerns' || k.response.stance === 'serious')).forEach(k => out.push({ id: 'k:' + k.id, kind: 'concern', stance: k.response.stance, label: byId(k.personId).name, head: k.kind === 'sme' ? 'Expert - ' + (byId(k.personId).title || 'Expert') : 'Stakeholder', who: byId(k.personId).name, detail: k.response.text }));
  ((c.scoring || {}).conditions || []).forEach(x => out.push({ id: 'cond:' + x.id, kind: 'condition', label: x.label, head: x.label, detail: 'to clear before ' + (x.clearBy === 'pilot' ? 'pilot' : 'production') }));
  return out.map(t => Object.assign(t, { slug: ovSlug(t.id) }));
}

// ---- Questions, answers and rule matching ----
// Answers: yes/no questions hold true, false or 'unknown'; single choice holds an option id; multiple choice holds a list of option ids.
// An absent answer (undefined) means unanswered. That is different from an explicit No.
const optionsOf = q => (q.type === 'yesno' ? YN_OPTS : (q.options || [])).concat(q.allowUnknown ? [UNKNOWN_OPT] : []);
function answerTokens(form, q) {
  const a = (form.answers || {})[q.id];
  if (a === undefined || a === null || a === '' || (Array.isArray(a) && !a.length)) return null;
  if (Array.isArray(a)) return a.map(String);
  if (typeof a === 'boolean') return [a ? 'yes' : 'no'];
  return [String(a)];
}
function answerLabel(q, form) {
  const t = answerTokens(form, q); if (!t) return null;
  const opts = optionsOf(q); return t.map(x => (opts.find(o => o.id === x) || { label: x }).label).join(', ');
}
const qApplies = (q, form, R) => !(q.showWhen || []).length || q.showWhen.every(t => termHit(t, form, R));
// A condition term is either one source with accepted answers, or a group { any: [terms] } that holds when any member holds.
const flatTerms = ts => (ts || []).reduce((a, t) => a.concat(t && t.any ? flatTerms(t.any) : [t]), []);
function termHit(t, form, R) {
  if (t && t.any) return t.any.some(x => termHit(x, form, R));
  if (t.src === 'type') return (t.in || []).includes(form.ucType);
  if (t.src === 'scope') return (t.in || []).includes(form.scope);
  if (t.src === 'autonomy') return (t.in || []).includes(form.autonomy);
  if (/^q:/.test(t.src || '')) {
    const q = R.questions.find(x => x.id === t.src.slice(2));
    if (!q || q.enabled === false || !qApplies(q, form, R)) return false;
    const tok = answerTokens(form, q);
    return !!tok && tok.some(x => (t.in || []).includes(x));
  }
  return false;
}
// A rule with no conditions never fires. A rule that points at a missing or disabled question cannot fire either.
const ruleHit = (r, form, R) => r.enabled !== false && (r.when || []).length > 0 && r.when.every(t => termHit(t, form, R));
const rulesOf = (R, kind) => (R.rules || []).filter(r => r.kind === kind);
// Anything enabled that has no stored answer. Derived from the data, never from the history of rule changes.
function formGaps(form, R0) {
  const R = normRules(R0);
  return {
    questions: R.questions.filter(q => q.enabled !== false && qApplies(q, form, R) && answerTokens(form, q) === null),
    readiness: R.readiness.filter(r => r.enabled !== false && (form.readiness || {})[r.id] === undefined),
  };
}
const gateQuestionIds = R => { const s = new Set(); rulesOf(R, 'guardrail').filter(r => r.enabled !== false).forEach(r => flatTerms(r.when).forEach(t => { if (/^q:/.test(t.src || '')) s.add(t.src.slice(2)); })); return s; };
const hasGaps = g => g.questions.length + g.readiness.length > 0;

// ---- Controls the case needs ----
// A control can declare when it applies at all (applies terms). Rules of kind 'require' make an applicable control required or recommended, with a reason.
const ctlApplies = (k, form, R) => !(k.applies || []).length || k.applies.every(t => termHit(t, form, R));
function controlNeeds(form, R0) {
  const R = normRules(R0), out = {};
  R.controls.filter(k => k.enabled !== false && ctlApplies(k, form, R)).forEach(k => { out[k.id] = { id: k.id, text: k.text, level: null, reasons: [] }; });
  rulesOf(R, 'require').filter(r => ruleHit(r, form, R)).forEach(r => {
    const o = out[r.control]; if (!o) return;
    const lvl = r.level === 'required' ? 'required' : 'recommended';
    if (lvl === 'required') o.level = 'required'; else if (!o.level) o.level = 'recommended';
    o.reasons.push({ level: lvl, label: r.label, ref: r.ref || '' });
  });
  return out;
}
const requiredControls = (form, R) => Object.values(controlNeeds(form, R)).filter(n => n.level === 'required');
const unclaimedRequired = (form, R) => requiredControls(form, R).filter(n => !(form.controls || []).includes(n.id));

// ---- Triage and scoring ----
function runTriage(form, R0) {
  const R = normRules(R0);
  const missing = FORM_FIELDS.filter(f => isBlank(form[f.k])).map(f => f.label);
  const g = formGaps(form, R);
  unclaimedRequired(form, R).forEach(n => missing.push('claim the required control: ' + n.text));
  const needAtt = (form.controls || []).filter(id => { const k = R.controls.find(x => x.id === id); return k && k.attest === 'required' && !(form.attesters || {})[id]; }).map(id => R.controls.find(x => x.id === id).text);
  if (needAtt.length) missing.push('someone to confirm: ' + needAtt.join(', '));
  if (!(form.measures || []).length) missing.push('at least one KPI with a target and a stop limit');
  if (g.questions.length) missing.push(g.questions.length + ' risk question' + (g.questions.length > 1 ? 's' : '') + ' unanswered');
  if (g.readiness.length) missing.push(g.readiness.length + ' data readiness check' + (g.readiness.length > 1 ? 's' : '') + ' unanswered');
  const blockers = rulesOf(R, 'guardrail').filter(r => ruleHit(r, form, R)).map(r => ({ id: r.id, text: r.message || r.label, blocker: true }));
  const flags = rulesOf(R, 'points').filter(r => ruleHit(r, form, R)).map(r => ({ id: r.id, text: r.label, weight: r.points, blocker: false })).concat(blockers.map(b => ({ id: b.id, text: b.text, weight: 0, blocker: true })));
  const checks = R.readiness.filter(r => r.enabled !== false);
  const readyCount = checks.filter(r => (form.readiness || {})[r.id] === true).length;
  const ready = { count: readyCount, of: checks.length, need: R.minReady, ok: readyCount >= R.minReady };
  const reasons = [];
  if (missing.length) reasons.push('Missing information: ' + missing.join('; ') + '.');
  blockers.forEach((b, i) => reasons.push('Guardrail: ' + String(b.text).replace(/\.$/, '') + '.' + (i === blockers.length - 1 ? ' Resubmit when these are addressed.' : '')));
  if (!ready.ok && !g.readiness.length) reasons.push('Data readiness: ' + readyCount + ' of ' + ready.of + ' checks met, ' + ready.need + ' needed. The use case may not be feasible yet.');
  else if (!ready.ok) reasons.push('Data readiness: ' + readyCount + ' of ' + ready.of + ' checks met so far, ' + ready.need + ' needed.');
  return { flags, blockers, ready, reasons, result: reasons.length ? 'remediate' : 'pass' };
}
function tierFromScore(s, R) { const t = R.tiers; return s <= t.lowMax ? 'low' : s <= t.moderateMax ? 'moderate' : s <= t.highMax ? 'high' : 'critical'; }
function runScoring(form, R0, atts) {
  const R = normRules(R0);
  const explain = []; let s = 0;
  rulesOf(R, 'points').forEach(r => { if (ruleHit(r, form, R)) { s += r.points; explain.push({ label: r.label, points: r.points }); } });
  const sp = R.scopePoints[form.scope] || 0; if (sp) { s += sp; explain.push({ label: 'Scope: ' + form.scope, points: sp }); }
  const ap = R.autonomyPoints[form.autonomy] || 0; if (ap) { s += ap; explain.push({ label: 'Autonomy: ' + ({ assist: 'assists a person', automate: 'acts on its own', advice: 'advice only' })[form.autonomy], points: ap }); }
  const base = tierFromScore(s, R); let tier = base; const overrides = [];
  rulesOf(R, 'override').forEach(o => {
    if (ruleHit(o, form, R)) { const raised = tIdx(o.minTier) > tIdx(tier); if (raised) tier = o.minTier; overrides.push({ id: o.id, label: o.label, minTier: o.minTier, raised }); }
  });
  const conditions = rulesOf(R, 'condition').filter(r => ruleHit(r, form, R)).map(r => ({ id: r.id, label: r.label, text: r.message || r.label, clearBy: r.clearBy || 'production' }));
  const cc = controlCredit(form, R, atts), credit = cc.credit;
  const residual = Math.max(0, s - credit);
  const g = formGaps(form, R);
  return { inherent: s, baseTier: base, tier, overrides, conditions, explain, controlCredit: credit, withheld: cc.withheld, inapplicable: cc.inapplicable, residual, residualTier: tierFromScore(residual, R), missing: { questions: g.questions.map(q => q.id), readiness: g.readiness.map(r => r.id) } };
}
const estimateDays = (tier, R) => (R.deadlines.vetting[tier] || 0) + (R.deadlines.panel[tier] || 0) + (tier === 'critical' ? (R.deadlines.exec[tier] || 0) : 0);
function dueFor(stage, tier, now, R) { const d = R.deadlines[stage] && R.deadlines[stage][tier]; return d ? now + d * DAY : null; }
function rescore(c0, ctx) {
  if (!c0.scoring || !['vetting', 'panel', 'exec'].includes(c0.stage)) return null;
  const R = normRules(ctx.rules), c = clone(c0), sc = runScoring(c.form, R, c.attestations), old = c.tier, oldInh = c.scoring.inherent, oldRv = c.scoring.rv, rv = ctx.rv || 1;
  const eff = maxTier(sc.tier, (c.vetting && c.vetting.raisedTo) || 'low');
  c.scoring = Object.assign({ at: ctx.now, rv }, sc); c.tier = eff;
  const names = sc.missing.questions.map(id => (R.questions.find(q => q.id === id) || { short: id }).short || id).concat(sc.missing.readiness.map(id => (R.readiness.find(r => r.id === id) || { text: id }).text));
  const gates = gateQuestionIds(R), gateMiss = sc.missing.questions.filter(id => gates.has(id)).length;
  c.audit.push({ ts: ctx.now, actor: 'system', action: 'Re-scored with updated rules', note: TIER_LABEL[old] + ' (' + oldInh + ')' + (oldRv ? ' under v' + oldRv : '') + ' to ' + TIER_LABEL[eff] + ' (' + sc.inherent + ') under v' + rv + '. Residual ' + sc.residual + '.' + (names.length ? ' Not answered: ' + names.join('; ') + '.' + (gateMiss ? ' Includes ' + gateMiss + ' safety gate' + (gateMiss > 1 ? 's' : '') + ' that were never checked.' : '') + ' Scoring ignores unanswered items, so the tier may be understated.' : ''), from: c.stage, to: c.stage, auto: true, tag: '' });
  return sealAudit(c, rv, ctx.now);
}
// Gaps and gate alerts for a case that has already been scored. Used for display only; nothing is sent back automatically.
const SCORED_STAGES = ['vetting', 'panel', 'exec', 'pilot', 'production'];
function caseGaps(c, R0) {
  const R = normRules(R0);
  if (!c.scoring || !SCORED_STAGES.includes(c.stage)) return { questions: [], readiness: [], gates: [], newStops: [] };
  const g = formGaps(c.form, R), gates = gateQuestionIds(R);
  const newStops = rulesOf(R, 'guardrail').filter(r => ruleHit(r, c.form, R));
  return { questions: g.questions, readiness: g.readiness, gates: g.questions.filter(q => gates.has(q.id)), newStops };
}

// ---- Usage and validation, used by the rules editor ----
const assessed = cases => cases.filter(c => c.triage || c.scoring);
const termQ = t => (/^q:/.test(t.src || '') ? t.src.slice(2) : null);
function questionUsage(qid, R, cases) {
  const rules = (R.rules || []).filter(r => flatTerms(r.when).some(t => termQ(t) === qid));
  const answered = cases.filter(c => c.form && c.form.answers && c.form.answers[qid] !== undefined).length;
  return { rules, answered };
}
function optionUsage(qid, oid, R, cases) {
  const rules = (R.rules || []).filter(r => flatTerms(r.when).some(t => termQ(t) === qid && (t.in || []).includes(oid)));
  const answered = cases.filter(c => { const a = c.form && c.form.answers && c.form.answers[qid]; return a === oid || (Array.isArray(a) && a.includes(oid)) || (typeof a === 'boolean' && (a ? 'yes' : 'no') === oid); }).length;
  return { rules, answered };
}
const ruleUsage = (rule, R, cases) => assessed(cases).filter(c => c.scoring && ruleHit(Object.assign({}, rule, { enabled: true }), c.form, R)).length;
const controlUsage = (id, cases) => cases.filter(c => ((c.form && c.form.controls) || []).includes(id)).length;
const readinessUsage = (id, cases) => cases.filter(c => c.form && c.form.readiness && c.form.readiness[id] !== undefined).length;
function describeTerm(t, R) {
  if (t.any) return '(' + t.any.map(x => describeTerm(x, R)).join(' or ') + ')';
  const vals = (t.in || []);
  if (t.src === 'type') return 'Type of AI use case is ' + (vals.map(v => ((R.ucTypes || []).find(o => o.id === v) || { label: v }).label).join(' or ') || '(nothing chosen)');
  if (t.src === 'scope') return 'Reach is ' + (vals.map(v => (SCOPE_OPTS.find(o => o.id === v) || { label: v }).label).join(' or ') || '(nothing chosen)');
  if (t.src === 'autonomy') return 'Autonomy is ' + (vals.map(v => (AUTONOMY_OPTS.find(o => o.id === v) || { label: v }).label).join(' or ') || '(nothing chosen)');
  const q = R.questions.find(x => x.id === termQ(t));
  if (!q) return '(question removed)';
  const opts = optionsOf(q);
  return '"' + (q.short || q.text) + '" is ' + (vals.map(v => (opts.find(o => o.id === v) || { label: v + ' (removed option)' }).label).join(' or ') || '(nothing chosen)');
}
const describeRule = (r, R) => (r.when || []).length ? (r.when || []).map(t => describeTerm(t, R)).join(' and ') : 'No conditions set, so this rule never applies';
// Checks a draft of the rules against the saved rules and the cases. Errors block saving; warnings need acknowledging.
function validateRules(D0, saved0, cases) {
  const D = normRules(D0), S0 = normRules(saved0), errors = [], warnings = [];
  const dup = (arr, what) => { const seen = new Set(); arr.forEach(x => { if (seen.has(x.id)) errors.push('Two ' + what + ' share the id "' + x.id + '".'); seen.add(x.id); }); };
  dup(D.questions, 'questions'); dup(D.rules, 'rules'); dup(D.controls, 'controls'); dup(D.readiness, 'readiness checks');
  const t = D.tiers; if (!(t.lowMax <= t.moderateMax && t.moderateMax <= t.highMax)) errors.push('Tier thresholds must rise: low, then moderate, then high.');
  if (!(+D.budget.perUserMonthly >= 0)) errors.push('The budget scrutiny limit must be zero or more.');
  TIERS.forEach(tr => { const mx = +D.reviewMaxDays[tr], df = +D.reviewCadenceDays[tr]; if (!(mx >= 1) || mx !== Math.round(mx)) errors.push('Max production review cycle for ' + TIER_LABEL[tr] + ' must be a whole number of days, 1 or more.'); else if (df > mx) errors.push('Default production review cycle for ' + TIER_LABEL[tr] + ' (' + df + ' days) is longer than the max production review cycle (' + mx + ' days).'); });
  GOAL_DEFS.forEach(d => { const g = (D.goals || {})[d.id] || {}; if (g.on && !(+g.value >= d.min && +g.value <= d.max)) errors.push('Goal "' + d.label + '" is on, so it needs a value from ' + d.min.toLocaleString('en-US') + ' to ' + d.max.toLocaleString('en-US') + '.'); });
  D.questions.forEach(q => { if (!String(q.text || '').trim()) errors.push('A question has no wording.'); if (q.type !== 'yesno' && (q.options || []).length < 2) errors.push('"' + (q.short || q.text) + '" needs at least two options.'); });
  D.rules.forEach(r => {
    if (!String(r.label || '').trim()) errors.push('A rule has no name.');
    flatTerms(r.when).forEach(tm => {
      const qid = termQ(tm);
      if (qid) {
        const q = D.questions.find(x => x.id === qid);
        if (!q) { errors.push('Rule "' + r.label + '" points at a question that does not exist.'); return; }
        const ids = optionsOf(q).map(o => o.id); (tm.in || []).forEach(v => { if (!ids.includes(v)) errors.push('Rule "' + r.label + '" uses an answer that "' + (q.short || q.text) + '" no longer offers.'); });
        if (q.enabled === false && r.enabled !== false) warnings.push('Rule "' + r.label + '" depends on the disabled question "' + (q.short || q.text) + '", so it cannot apply until that question is enabled again.');
      }
      if (!(tm.in || []).length) warnings.push('Rule "' + r.label + '" has a condition with no answers chosen, so it never applies.');
    });
    if (r.enabled !== false && !(r.when || []).length) warnings.push('Rule "' + r.label + '" has no conditions, so it never applies.');
    if (r.kind === 'require') { if (!D.controls.some(k => k.id === r.control)) errors.push('Rule "' + r.label + '" points at a control that does not exist.'); if (r.level !== 'required' && r.level !== 'recommended') errors.push('Rule "' + r.label + '" must say whether the control is required or recommended.'); }
  });
  const termCheck = (who, tm) => { const qid = termQ(tm); if (qid && !D.questions.some(x => x.id === qid)) errors.push(who + ' points at a question that does not exist.'); };
  D.questions.forEach(q => flatTerms(q.showWhen).forEach(tm => termCheck('The question "' + (q.short || q.text) + '"', tm)));
  D.controls.forEach(k => flatTerms(k.applies).forEach(tm => termCheck('The control "' + k.text + '"', tm)));
  // Things that were used must not disappear
  S0.questions.forEach(q => { const n = cases.filter(c => c.form && c.form.answers && c.form.answers[q.id] !== undefined).length; const d = D.questions.find(x => x.id === q.id); if (!d && n) errors.push('Question "' + (q.short || q.text) + '" was answered on ' + n + ' case' + (n > 1 ? 's' : '') + ' and cannot be deleted. Disable it instead.'); if (d && n && d.type !== q.type) errors.push('The answer type of "' + (q.short || q.text) + '" cannot change because it has been answered.'); if (d && d.type !== 'yesno') (q.options || []).forEach(o => { if (!(d.options || []).some(x => x.id === o.id) && optionUsage(q.id, o.id, S0, cases).answered) errors.push('Answer "' + o.label + '" of "' + (q.short || q.text) + '" was chosen on existing cases and cannot be removed.'); }); });
  S0.rules.forEach(r => { if (!D.rules.some(x => x.id === r.id) && ruleUsage(r, S0, cases)) errors.push('Rule "' + r.label + '" has applied to existing cases and cannot be deleted. Disable it instead.'); });
  S0.controls.forEach(c => { if (!D.controls.some(x => x.id === c.id) && controlUsage(c.id, cases)) errors.push('Control "' + c.text + '" is used on existing cases and cannot be deleted. Disable it instead.'); });
  S0.readiness.forEach(r => { if (!D.readiness.some(x => x.id === r.id) && readinessUsage(r.id, cases)) errors.push('Readiness check "' + r.text + '" has answers on existing cases and cannot be deleted. Disable it instead.'); });
  D.questions.forEach(q => { if (q.enabled !== false && !D.rules.some(r => r.enabled !== false && flatTerms(r.when).some(tm => termQ(tm) === q.id)) && !D.questions.some(o => o.enabled !== false && flatTerms(o.showWhen).some(tm => termQ(tm) === q.id)) && !(D.consultAreas || []).some(a => (a.triggers || []).some(tr => flatTerms(tr.when).some(tm => termQ(tm) === q.id)))) warnings.push('Question "' + (q.short || q.text) + '" is asked but no enabled rule uses its answer, so it has no effect on scoring.'); });
  return { errors, warnings };
}
// Try a set of answers against rules without saving anything.
function whatIf(R0, input) {
  const R = normRules(R0);
  const form = { answers: input.answers || {}, readiness: {}, controls: input.controls || [], scope: input.scope || 'team', autonomy: input.autonomy || 'advice', ucType: input.ucType || '' };
  R.readiness.forEach(r => { form.readiness[r.id] = true; });
  const stops = rulesOf(R, 'guardrail').filter(r => ruleHit(r, form, R)).map(r => ({ id: r.id, text: r.message || r.label }));
  const sc = runScoring(form, R);
  return { stops, scoring: sc, gaps: formGaps(form, R).questions, needs: Object.values(controlNeeds(form, R)).filter(n => n.level) };
}

// ---- Consultation reminders (used by the chair and by the automated sweep) ----
// A confirmer cannot be the submitter or the owner of the use case (B-36).
const agoTxt = (ts, now) => { const d = Math.max(0, Math.floor((now - ts) / DAY)); return d === 0 ? 'today' : d === 1 ? '1 day ago' : d + ' days ago'; };
const askedAgo = (ts, now, last) => 'asked ' + agoTxt(ts, now) + (last ? ', last reminded ' + agoTxt(last, now) : '');
const fdateE = ts => new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const roleName = p => ({ lead: 'governance lead', adviser: 'adoption adviser', sme: 'expert', exec: 'executive', auditor: 'auditor', submitter: 'submitter', stakeholder: 'stakeholder' })[p.role] || p.role;
// B-36 separation of duties. Reviewing a case (vet, panel, executive) is kept apart from backing up its claims (confirmer, process stakeholder); experts are a third group that does neither.
// kind is one of: confirm, stakeholder, expert, panel, exec. Returns a plain sentence when the person is blocked, or '' when allowed.
function dutyBlock(c, pid, kind) {
  const p = byId(pid) || {}, nm = p.name || pid, VERB = { confirm: 'confirm a control', stakeholder: 'be a process stakeholder', expert: 'be consulted as an expert', panel: 'review as a panel member', exec: 'review as an executive' };
  if (pid === c.submitterId || pid === ownerOf(c)) return nm + ' is the submitter or owner of this use case and cannot ' + VERB[kind] + ' on it.';
  if (p.role === 'lead' && ['confirm', 'stakeholder', 'expert'].includes(kind)) return nm + ' is the governance lead, who reviews cases, and cannot ' + VERB[kind] + ' on any case.';
  if (pid === c.adviserId) {
    if (p.role !== 'lead' && ['expert', 'panel', 'exec'].includes(kind)) return nm + ' is the adoption adviser on this use case and cannot ' + VERB[kind] + ' on it.';
  }
  if ((c.consults || []).some(k => k.kind === 'sme' && k.personId === pid) && ['panel', 'exec', 'confirm'].includes(kind)) return nm + ' was consulted as an expert on this use case and cannot ' + VERB[kind] + ' on it.';
  if ((p.role === 'panel' || p.role === 'exec' || (c.panelNotes || []).some(n => n.by === pid)) && ['expert', 'confirm'].includes(kind)) return nm + ' reviews this use case and cannot ' + VERB[kind] + ' on it. The consult needs someone independent of the review.';
  return '';
}
function selfConfirmed(c, R) { const bad = [c.submitterId, ownerOf(c)].filter(Boolean); return (c.form.controls || []).filter(id => bad.includes((c.form.attesters || {})[id])).map(id => (R.controls.find(k => k.id === id) || {}).short || id); }
// ---- Reviewer decisions (B-56, B-61, B-69) ----
// Each reviewer records a decision, firm or leaning, with a note. Abstain and awaiting input are decisions that never count toward agreement.
// The case finalizes when enough reviewers hold the same firm decision and nobody holds a different one. Votes live in c.votes (panel) and c.xvotes (executives).
const DEC_LABEL = { approve: 'Approve for pilot', waive: 'Approve and waive pilot', remediate: 'Remediate', reject: 'Reject', escalate: 'Send to executives', abstain: 'Abstain', await: 'Awaiting input' };
const FIRMABLE = ['approve', 'waive', 'remediate', 'reject', 'escalate'];
const decLabel = (d, tier, stage) => (tier === 'critical' && d === 'approve' && stage !== 'exec') ? 'Recommend approval' : (DEC_LABEL[d] || d);
const voteKey = c => c.stage === 'exec' ? 'xvotes' : 'votes';
// Votes for the current stage. Older cases only have notes with a leaning, which read as leaning decisions.
function revVotes(c) {
  const key = voteKey(c);
  if (c[key]) return c[key];
  const out = {};
  (c.panelNotes || []).forEach(n => { const p = byId(n.by) || {}; if ((c.stage === 'exec') !== (p.role === 'exec')) return; if (['approve', 'remediate', 'reject'].includes(n.lean)) out[n.by] = { dec: n.lean, firm: false, at: n.at }; });
  return out;
}
function revPool(c, stage) {
  stage = stage || c.stage;
  if (stage === 'exec') return withRole('exec').filter(p => !dutyBlock(c, p.id, 'exec')).map(p => p.id);
  return withRole('lead').concat(withRole('panel')).filter(p => !dutyBlock(c, p.id, 'panel')).map(p => p.id);
}
function revNeed(c, R, stage) {
  stage = stage || c.stage;
  if (stage === 'exec') return R.execQuorum;
  const t = c.tier, n = R.quorum[t] != null ? R.quorum[t] : (t === 'low' ? R.quorum.moderate : 0);
  return n;
}
// What can stop reviewers from firming up. Missing stakeholder replies and silent confirmers never do.
function revBlockers(c, R) {
  const none = { texts: [], hard: [], pend: [], missing: [], poolShort: false };
  if (c.stage !== 'panel') return none;
  const pend = (c.consults || []).filter(k => k.kind === 'sme' && k.status === 'pending' && k.required !== false);
  const names = pend.map(k => byId(k.personId).name + ' (' + (byId(k.personId).title || 'expert') + ')').join(', ');
  const missing = c.legacy ? [] : Object.values(consultNeeds(c.form, R)).filter(n => n.level === 'required' && !(c.consults || []).some(k => k.personId === n.personId)).map(n => n.label + (dutyBlock(c, n.personId, 'expert') ? ' (no independent expert: ' + dutyBlock(c, n.personId, 'expert').replace(/ on it\.$/, '') + '; assign the area to someone else)' : ''));
  const v = revVotes(c), pool = revPool(c), abst = pool.filter(id => v[id] && v[id].dec === 'abstain').length, N = revNeed(c, R);
  const poolShort = pool.length - abst < N, texts = [];
  if (pend.length) texts.push('Waiting on ' + pend.length + ' required expert response' + (pend.length > 1 ? 's' : '') + ' from ' + names + '.');
  if (missing.length) texts.push('A required consult has not been requested yet: ' + missing.join(', ') + '. The lead uses Consult experts first.');
  const hard = texts.slice();
  if (poolShort) texts.push('Only ' + (pool.length - abst) + ' reviewer' + (pool.length - abst === 1 ? ' is' : 's are') + ' available' + (abst ? ' (' + abst + ' abstained)' : '') + ' and this tier needs ' + N + '.');
  return { texts, hard, pend, missing, poolShort };
}
// The approval terms reviewers shape together, in the order they appear.
const TERM_LABEL = { scope: 'Pilot scope and conditions', days: 'Pilot review days', waiver: 'Reason for waiving the pilot', limits: 'Production controls and conditions', validDays: 'Approval validity', prodDays: 'Production review period', measures: 'KPIs and stop limits', overrides: 'Accepted risks' };
function termDefaults(c, R) {
  const rp = c.recommendedPilot || {}, ac = c.acceptance || c.priorAcceptance || {};
  return { scope: rp.scope || (c.stage === 'exec' ? '' : 'Limited to one site and a small group of users.'), days: rp.days || R.pilotDays[c.tier], waiver: '', limits: ac.limits || '', validDays: 365, prodDays: R.reviewCadenceDays[c.tier], measures: ac.measures || c.form.measures || [] };
}
function termsNow(c, R) {
  const d = termDefaults(c, R), v = (c.reviewDraft && c.reviewDraft.vals) || {}, t = {};
  Object.keys(d).forEach(k => { t[k] = v[k] != null ? v[k] : d[k]; });
  ['scope', 'waiver', 'limits'].forEach(k => { t[k] = String(t[k] == null ? '' : t[k]).trim(); });
  ['days', 'validDays', 'prodDays'].forEach(k => { t[k] = String(t[k] == null ? '' : t[k]).trim(); });
  t.measures = (t.measures || []).filter(m => m && String(m.name || '').trim()).map(m => [String(m.name).trim(), m.dir === 'higher' ? 'higher' : 'lower', String(m.target == null ? '' : m.target).trim(), String(m.stop == null ? '' : m.stop).trim()].join(' | '));
  const ov = (c.reviewDraft && c.reviewDraft.overrides) || {};
  t.overrides = Object.keys(ov).filter(k => ov[k].on || ov[k].reason).sort().map(k => k + ' | ' + (ov[k].on ? 'accepted' : 'not accepted') + ' | ' + ov[k].reason);
  return t;
}
function termsDiff(a, b) { const out = []; if (!a || !b) return out; Object.keys(TERM_LABEL).forEach(k => { if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out.push({ k, label: TERM_LABEL[k], from: a[k], to: b[k] }); }); return out; }
function openUnaccepted(c, R) {
  if (!c.scoring) return [];
  const dr = c.reviewDraft;
  return looseThreads(c, R).filter(t => {
    const o = dr && dr.overrides && dr.overrides[t.slug];
    if (o && o.on && o.reason && o.sig === t.kind + '|' + t.detail + '|' + t.label) return false;
    if (c.stage === 'exec' && c.panelDecision && c.panelDecision.decision === 'recommend' && (c.panelDecision.overrides || []).some(x => x.id === t.id && x.kind === t.kind && (x.detail || '') === (t.detail || ''))) return false;
    return true;
  });
}
// What an approve or approve-and-waive still needs before anyone can hold it firm.
function termsGaps(c, R, dec) {
  const g = [];
  if (dec !== 'approve' && dec !== 'waive') return g;
  const t = termsNow(c, R);
  if (dec === 'approve') { if (!t.scope) g.push(TERM_LABEL.scope); if (!(+t.days > 0)) g.push(TERM_LABEL.days); } else if (!t.waiver) g.push(TERM_LABEL.waiver);
  let ms = []; try { ms = parseMeasures(((c.reviewDraft && c.reviewDraft.vals && c.reviewDraft.vals.measures) || termDefaults(c, R).measures), true); } catch (e) { g.push('KPIs and stop limits (' + e.message + ')'); ms = null; }
  if (ms && !ms.length) g.push('At least one KPI with a target and a stop limit');
  if (!t.limits) g.push(TERM_LABEL.limits);
  if (!(+t.validDays > 0)) g.push(TERM_LABEL.validDays);
  if (!(+t.prodDays > 0) || +t.prodDays > R.reviewMaxDays[c.tier]) g.push(TERM_LABEL.prodDays + ' (whole days, up to ' + R.reviewMaxDays[c.tier] + ')');
  openUnaccepted(c, R).forEach(x => g.push('Accept or resolve: ' + x.label));
  return g;
}
// Is there a decision enough reviewers hold firm, with nobody holding another?
function revReady(c, R) {
  if (c.stage !== 'panel' && c.stage !== 'exec') return null;
  if (revBlockers(c, R).texts.length) return null;
  const v = revVotes(c), pool = revPool(c), N = revNeed(c, R);
  const act = pool.filter(id => v[id] && v[id].dec !== 'abstain').map(id => ({ id, v: v[id] }));
  if (!act.length) return null;
  const dec = act[0].v.dec;
  if (!FIRMABLE.includes(dec) || act.some(a => a.v.dec !== dec)) return null;
  const firm = act.filter(a => a.v.firm).length;
  if (firm < N) return null;
  const gaps = termsGaps(c, R, dec);
  return { dec, firm, N, gaps, ok: !gaps.length };
}
// A disagreement among reviewers who have weighed in. Leaning counts toward the quorum here. Not having voted is not a disagreement.
function revDeadlock(c, R, now) {
  if (c.stage !== 'panel' && c.stage !== 'exec') return null;
  if (revBlockers(c, R).texts.length) return null;
  const v = revVotes(c), pool = revPool(c), N = revNeed(c, R);
  const act = pool.filter(id => v[id] && v[id].dec !== 'abstain').map(id => ({ id, v: v[id] }));
  if (act.filter(a => a.v.dec !== 'await').length < N) return null;
  const decs = [...new Set(act.map(a => a.v.dec))];
  if (decs.length < 2) {
    // Everyone agrees on a form of approval but too few hold it firm. While the terms are still moving that is normal. Once the deadline has passed and nothing blocks, leaning counts as firm and the lead may push it.
    const d = decs[0], firm = act.filter(a => a.v.firm).length;
    if (FIRMABLE.includes(d) && firm < N && c.dueAt && now != null && now >= c.dueAt) return { decs, act, N, lean: true };
    return null;
  }
  return { decs, act, N };
}
// What the person who breaks a deadlock may do. Nothing is ever approved over a dissent or a request for more input.
function deadlockOptions(c, dl) {
  const crit = c.tier === 'critical';
  if (dl.lean) { const d = dl.decs[0]; return [{ v: d, l: d === 'remediate' ? 'Send back for remediation' : decLabel(d, c.tier, c.stage) }]; }
  if (c.stage === 'exec') {
    if (dl.decs.every(d => d === 'approve' || d === 'waive')) return [{ v: 'approve', l: 'Push to pilot (approve for pilot)' }];
    return [{ v: 'remediate', l: 'Send back to the submitter for remediation' }];
  }
  if (dl.decs.some(d => ['remediate', 'reject', 'await'].includes(d))) return [{ v: 'remediate', l: 'Send back to the submitter for remediation' }];
  const cnt = {}; dl.act.filter(a => a.v.dec !== 'await').forEach(a => { cnt[a.v.dec] = (cnt[a.v.dec] || 0) + 1; });
  const top = Math.max.apply(null, Object.values(cnt));
  return Object.keys(cnt).filter(d => cnt[d] === top && !(crit && d !== 'approve')).map(d => ({ v: d, l: decLabel(d, c.tier) }));
}
// Lead only: the pool is short only because reviewers abstained, and everyone left holds the same firm decision.
function revQuorumWaivable(c, R) {
  if (c.stage !== 'panel') return null;
  const b = revBlockers(c, R); if (b.pend.length || b.missing.length || !b.poolShort) return null;
  const v = revVotes(c), pool = revPool(c), abst = pool.filter(id => v[id] && v[id].dec === 'abstain');
  const lead0 = (withRole('lead')[0] || {}).id;
  if (!abst.length || pool.some(id => !v[id] && id !== lead0)) return null;
  const act = pool.filter(id => v[id] && v[id].dec !== 'abstain'); if (!act.length) return null;
  const dec = v[act[0]].dec;
  if (!FIRMABLE.includes(dec) || act.some(id => v[id].dec !== dec || !v[id].firm)) return null;
  return { dec, n: act.length, of: pool.length, abstained: abst.length, gaps: termsGaps(c, R, dec) };
}
// What the submitter changed since the case was returned. Shown to the lead when deciding who should take a second look.
function formDiff(a, b, R) {
  if (!a || !b) return [];
  const out = [], sh = v => { const t = typeof v === 'string' ? v : JSON.stringify(v); return !t ? '(blank)' : t.length > 90 ? t.slice(0, 87) + '...' : t; };
  Object.keys(DIFF_LABEL).forEach(k => { if (JSON.stringify(a[k] || '') !== JSON.stringify(b[k] || '')) out.push(DIFF_LABEL[k] + ': was ' + sh(a[k] || '') + ', now ' + sh(b[k] || '')); });
  const ids = new Set(Object.keys(a.answers || {}).concat(Object.keys(b.answers || {})));
  ids.forEach(id => { if (JSON.stringify((a.answers || {})[id]) !== JSON.stringify((b.answers || {})[id])) { const q = ((R || {}).questions || []).find(x => x.id === id); out.push('Risk question: ' + (q ? q.text : id) + ' (changed)'); } });
  return out;
}
function formDiffNames(a, b, R) {
  if (!a || !b) return [];
  const out = Object.keys(DIFF_LABEL).filter(k => JSON.stringify(a[k] || '') !== JSON.stringify(b[k] || '')).map(k => DIFF_LABEL[k]);
  new Set(Object.keys(a.answers || {}).concat(Object.keys(b.answers || {}))).forEach(id => { if (JSON.stringify((a.answers || {})[id]) !== JSON.stringify((b.answers || {})[id])) { const q = ((R || {}).questions || []).find(x => x.id === id); out.push(q ? (q.short || q.text) : id); } });
  return out.filter((x, i) => out.indexOf(x) === i);
}
// Earlier responses that can be asked for a second look: the latest answered request for each person.
function secondLookOptions(c, R) {
  const need = c.legacy ? {} : consultNeeds(c.form, R);
  return (c.consults || []).filter(k => k.status !== 'pending' && !k.supersededBy && k.response && !(c.consults || []).some(x => x.personId === k.personId && x.status === 'pending')).map(k => {
    const a = (R.consultAreas || []).find(x => x.id === k.areaId), n = k.areaId ? need[k.areaId] : null;
    return { v: k.id, l: byId(k.personId).name + ' (' + (k.kind === 'sme' ? (a ? a.label : 'expert') : 'process stakeholder') + '), answered ' + new Date(k.response.at || k.requestedAt).toDateString() + (k.kind === 'sme' && !n ? ', area no longer triggered' : '') + ((k.formSnap || c.formAtReturn) ? (() => { const nm = formDiffNames(k.formSnap || c.formAtReturn, c.form, R); return nm.length ? '. Changed since: ' + nm.slice(0, 5).join(', ') + (nm.length > 5 ? ' and ' + (nm.length - 5) + ' more' : '') : '. Nothing changed since'; })() : '') };
  });
}
const dayKey = ts => new Date(ts).toDateString();
// Reviewer reminders: reviewers without a firm decision, once nothing blocks. One a day before the deadline, then daily from the deadline date, never more than one a day.
function revReminderDue(c, R, now) {
  if (c.stage !== 'panel' && c.stage !== 'exec') return [];
  if (revBlockers(c, R).texts.length || !c.dueAt) return [];
  if (now < c.dueAt - DAY) return [];
  const v = revVotes(c);
  return revPool(c).filter(id => !(v[id] && (v[id].firm || v[id].dec === 'abstain'))).filter(id => {
    const last = (v[id] && v[id].lastMailAt) || 0;
    if (last && dayKey(last) === dayKey(now)) return false;
    return now >= c.dueAt || last < c.dueAt - DAY;
  });
}
function remindCase(c0, ctx, actor, only) {
  const pend = (c0.consults || []).filter(k => k.status === 'pending' && (!only || only.includes(k.id)));
  const now = ctx.now, auto = !actor || actor.id === 'system';
  const due = pend.filter(k => auto ? (k.dueAt && now >= k.dueAt - DAY && (!k.lastReminderAt || now - k.lastReminderAt >= DAY)) : true);
  const pendAtt = only ? (c0.attestations || []).filter(a => a.status !== 'confirmed' && a.status !== 'declined' && only.includes('a:' + a.controlId)) : [];
  const R0 = ctx.rules, rvDue = auto && !only ? revReminderDue(c0, R0, now) : [];
  const rdy0 = auto && !only && c0.stage === 'panel' ? revReady(c0, R0) : null, leadRem = !!(rdy0 && rdy0.ok && c0.readyBy && c0.readyBy.declined && withRole('lead')[0] && !(c0.readyBy.lastLeadMail && dayKey(c0.readyBy.lastLeadMail) === dayKey(now)));
  if (!due.length && !pendAtt.length && !rvDue.length && !leadRem) return null;
  const c = clone(c0);
  if (rvDue.length) {
    const key = voteKey(c); c[key] = c[key] || revVotes(c);
    const dl = c.dueAt ? new Date(c.dueAt).toDateString() : '';
    rvDue.forEach(pid => { const v = c[key][pid] = c[key][pid] || { dec: '', firm: false, at: 0 }; v.lastMailAt = now; v.reminders = (v.reminders || 0) + 1; c.outbox.push({ ts: now, n: c.outbox.length, to: [pid], second: v.reminders > 1, x: JSON.stringify({ due: ['Your decision on this use case is still open.', now > c.dueAt ? 'The decision was due ' + dl + '.' : 'The decision is due ' + dl + '.'], notes: [['What to do', 'Record a firm decision, or abstain if you cannot review it.', 'ask']], button: 'Open the case and decide', only: 1 }), subject: 'Reminder: your decision is needed on ' + c.id, body: 'Your decision is still open on "' + c.title + '". Record a firm decision, or abstain. Due ' + dl + '.', kind: 'reminder', auto: true }); });
  }
  if (leadRem) { const ld = withRole('lead')[0]; c.readyBy.lastLeadMail = now; c.outbox.push({ ts: now, n: c.outbox.length, to: [ld.id], second: true, x: JSON.stringify({ due: ['The reviewers agree. The decision is waiting to be finalized.'], notes: [['The decision', decLabel(rdy0.dec, c.tier), 'ask']], button: 'Open the case and finalize', only: 1 }), subject: 'Reminder: ready to finalize ' + c.id, body: 'The reviewers agree on "' + decLabel(rdy0.dec, c.tier) + '" for "' + c.title + '". It is waiting to be finalized.', kind: 'reminder', auto: true }); }
  pendAtt.forEach(a0 => { const a = c.attestations.find(x => x.controlId === a0.controlId); a.reminders = (a.reminders || 0) + 1; a.lastReminderAt = now; const ct = (ctx.rules || {}).controls ? ((ctx.rules.controls.find(k => k.id === a.controlId) || {}).short || a.controlId) : a.controlId; c.outbox.push({ ts: now, n: c.outbox.length, to: [a.personId], second: a.reminders > 1, x: JSON.stringify({ due: ['Your confirmation is still needed.', 'It does not block the decision.'], notes: [['The control', ct, 'ask']], button: 'Open the case and respond', only: 1 }), subject: 'Reminder: please confirm a control on ' + c.id, body: 'Your confirmation is still needed on "' + c.title + '" for: ' + ct + '. It does not block the decision.', kind: 'reminder', auto: true }); });
  due.forEach(d => {
    const k = c.consults.find(x => x.id === d.id); k.reminders = (k.reminders || 0) + 1; k.lastReminderAt = now;
    c.outbox.push({ ts: now, n: c.outbox.length, to: [k.personId], second: k.reminders > 1, x: JSON.stringify({ due: [k.kind === 'sme' ? 'A response is ' + (k.required === false ? 'requested' : 'required') + '. It is still open.' : 'Your feedback is still welcome.', k.kind === 'sme' && k.required !== false ? 'The decision waits on it.' : 'It does not hold up the decision.'], notes: [['The question', k.question || '', 'ask']], button: 'Open the case and respond', only: 1 }), subject: 'Reminder: ' + (k.kind === 'sme' ? 'response needed' : 'feedback welcome') + ' on ' + c.id, body: k.kind === 'sme' ? 'A response is ' + (k.required === false ? 'requested' : 'required') + ' on "' + c.title + '". Question: ' + k.question : 'Your feedback is welcome on "' + c.title + '". No reply will block the decision.', kind: 'reminder', auto: true });
  });
  c.audit.push({ ts: now, actor: auto ? 'system' : actor.id, action: 'Reminders sent', note: due.map(d => byId(d.personId).name).concat(pendAtt.map(a => byId(a.personId).name)).concat(rvDue.map(id => byId(id).name)).concat(leadRem ? [byId(withRole('lead')[0].id).name + ' (to finalize)'] : []).filter((n, i, arr) => arr.indexOf(n) === i).join(', '), from: c.stage, to: c.stage, auto: auto, tag: '' });
  return sealAudit(c, ctx.rv || 1, now);
}

// ---- Available actions for a person on a case ----
function actionsFor(c, actor, ctx) {
  const R = ctx.rules, role = actor.role, mine = c.submitterId === actor.id, out = [];
  const A = (id, label, o) => out.push(Object.assign({ id, label, tone: '', fields: [] }, o || {}));
  const subm = () => byId(c.submitterId).name;
  const sepB = (role === 'panel' || role === 'exec' || role === 'lead') && dutyBlock(c, actor.id, role === 'exec' ? 'exec' : 'panel');
  const adv = c.adviserId ? actor.id === c.adviserId : role === 'adviser';
  const helpOpen = (c.helpRequests || []).some(h => h.status === 'open');
  const BACK = () => ({ intro: 'This sends the use case back to ' + subm() + ', the submitter, with your reason by email. They update the details and resubmit, and it goes through triage and scoring again. Panel notes and votes are cleared, but expert and stakeholder responses are kept. It is not a rejection.' });
  const REJ = () => ({ intro: 'This closes the use case and emails your reason to ' + subm() + '. It leaves the review process unless ' + subm() + ' returns it to the suggestion box to start over. Your reason is also shown to people who later propose something similar, so say what was wrong and, where you can, what would make an idea acceptable.' });
  const NPF = { name: 'notPermitted', label: 'Not permitted', type: 'checks', required: false, options: [{ v: 'np', l: 'Mark this use case as not permitted. It cannot be returned to the suggestion box unless the governance lead removes the mark.' }], value: [] };
  const RSN = { name: 'rationale', label: 'Reason (guides future submitters)', type: 'textarea', required: true };
  const NOTE = req => ({ name: 'note', label: req ? 'Reason' : 'Note (optional)', type: 'textarea', required: !!req });
  const tier = c.tier;
  const threads = (c.stage === 'panel' || c.stage === 'exec') && c.scoring ? looseThreads(c, R) : [], sv = c.scoring ? supportView(c, R) : null;
  const dr = c.reviewDraft || null, dval = (k, d) => (dr && dr.vals && dr.vals[k] != null ? dr.vals[k] : d);
  const savedOv = {}; threads.forEach(t => { const o = dr && dr.overrides && dr.overrides[t.slug]; if (o && (o.reason || o.on) && o.sig === t.kind + '|' + t.detail + '|' + t.label) savedOv[t.slug] = { on: !!o.on, reason: o.reason || '' }; });
  // Carried forward: risks the panel already accepted when recommending stay accepted for the executives if the item itself has not changed.
  if (c.stage === 'exec' && c.panelDecision && c.panelDecision.decision === 'recommend') threads.forEach(t => { if (savedOv[t.slug]) return; const p = (c.panelDecision.overrides || []).find(x => x.id === t.id && x.kind === t.kind && (x.detail || '') === (t.detail || '')); if (p) savedOv[t.slug] = { on: true, reason: p.reason || '' }; });
  const draftNote = dr ? 'Last saved by ' + byId(dr.by).name + ' on ' + new Date(dr.at).toDateString() + '.' : '';
  const pendList = (c.consults || []).filter(k => k.kind === 'sme' && k.status === 'pending' && k.required !== false), pendSME = pendList.length, pendNames = pendList.map(k => byId(k.personId).name + ' (' + (byId(k.personId).title || 'expert') + ')').join(', ');
  const reviewers = new Set((c.panelNotes || []).filter(n => byId(n.by).role === 'panel').map(n => n.by)).size;
  const needRev = Math.max(0, (R.quorum[tier] != null ? R.quorum[tier] : (tier === 'low' ? R.quorum.moderate : 0)) - 1);
  const reqMissing = c.legacy ? [] : Object.values(consultNeeds(c.form, R)).filter(n => n.level === 'required' && !(c.consults || []).some(k => k.personId === n.personId)).map(n => n.label + (dutyBlock(c, n.personId, 'expert') ? ' (no independent expert: ' + dutyBlock(c, n.personId, 'expert').replace(/ on it\.$/, '') + '; assign the area to someone else)' : ''));
  const hold = () => pendSME ? 'Waiting on ' + pendSME + ' required expert response' + (pendSME > 1 ? 's' : '') + ' from ' + pendNames + '.' : reqMissing.length ? 'A required consult has not been requested yet: ' + reqMissing.join(', ') + '. Use Consult experts first.' : reviewers < needRev ? 'Needs a note from ' + (needRev - reviewers) + ' more panel reviewer' + (needRev - reviewers > 1 ? 's' : '') + '.' : '';
  const mf = (req) => ((c.acceptance && c.acceptance.measures) || []).map(m => ({ name: 'mv_' + m.id, label: m.name + ' (' + (m.dir === 'lower' ? 'lower' : 'higher') + ' is better; target ' + m.target + ', stop limit ' + m.stop + ')' + (req ? '' : ' (optional)'), type: 'number', required: !!req, measure: true }));
  const acc = () => [
    { name: 'measures', label: 'KPIs (key performance indicators) and stop limits', type: 'measures', required: true, value: (c.acceptance && c.acceptance.measures) || (c.priorAcceptance && c.priorAcceptance.measures) || c.form.measures || [], proposed: c.form.measures || [] },
    { name: 'limits', label: 'Production controls, conditions, and limits (beyond the listed controls)', type: 'textarea', required: true, value: (c.acceptance && c.acceptance.limits) || (c.priorAcceptance && c.priorAcceptance.limits) || '' },
    { name: 'validDays', label: 'Approval valid for (days)', type: 'number', required: true, value: 365 },
    { name: 'prodDays', label: 'Review in production every (days, maximum ' + R.reviewMaxDays[tier] + ')', type: 'number', required: true, value: R.reviewCadenceDays[tier] }];
  // Shared approval form: one field set, grouped into tabs. mode 'approve' needs everything; 'draft' and 'note' only save.
  const TAB_APPROVE = [['notes', 'Panel notes'], ['approval', 'Risks'], ['pilot', 'Pilot Conditions'], ['kpi', 'KPIs and Limits'], ['prod', 'Production Conditions'], ['ctl', 'Claimed Controls']];
  const noteRows = () => { const v = revVotes(c); return revPool(c).map(id => { const n = (c.panelNotes || []).find(x => x.by === id), x = v[id]; return { by: byId(id).name, role: byId(id).title || '', dec: x ? x.dec : '', firm: !!(x && x.firm), text: n ? n.text : '', at: n ? n.at : (x ? x.at : 0), me: id === actor.id }; }); };
  const reviewFields = (req, kind, extra) => {
    const T = (tab, f) => Object.assign({ tab }, f), out = [];
    const decTab = 'notes';
    const recDec = c.panelDecision && ['recommend', 'escalate'].includes(c.panelDecision.decision) ? { by: byId(c.panelDecision.by).name, at: c.panelDecision.at, text: c.panelDecision.rationale } : null;
    const decF = T(decTab, { name: 'rationale', label: (kind === 'exec' || kind === 'execwaive') ? 'Executive decision notes (for the submitter)' : kind === 'recommend' ? 'Panel recommendation notes (for the executives)' : 'Panel decision notes (for the submitter)', type: 'textarea', required: !!req, value: dval('rationale', '') });
    if (decTab === 'notes') out.push(decF);
    out.push(T('notes', { name: 'panelnotes', type: 'panelnotes', label: 'Reviewers', rec: (kind === 'exec' || kind === 'execwaive') ? recDec : null, notes: noteRows(), stage: c.stage }));
    if (decTab === 'approval') out.push(decF);
    out.push(T('approval', { name: 'overrides', type: 'overrides', label: 'Open items', threads, saved: savedOv, req: !!req }));
    (extra || []).forEach(f => out.push(T('approval', f)));
    if (kind === 'waive' || kind === 'execwaive') out.push(T('pilot', { name: 'waiver', label: 'Reason for waiving the pilot', type: 'textarea', required: !!req, value: dval('waiver', '') }));
    else {
      const rp = c.recommendedPilot || {};
      out.push(T('pilot', { name: 'scope', label: 'Pilot scope and conditions', type: 'textarea', required: !!req, value: dval('scope', kind === 'exec' ? (rp.scope || '') : (rp.scope || 'Limited to one site and a small group of users.')) }));
      out.push(T('pilot', { name: 'days', label: 'Pilot review in (days)', type: 'number', required: !!req, value: dval('days', kind === 'exec' ? (rp.days || R.pilotDays[tier]) : (rp.days || R.pilotDays[tier])) }));
    }
    const af = acc();
    af.forEach(f => {
      const tab = f.name === 'measures' ? 'kpi' : 'prod';
      const g = Object.assign({}, f, { tab, required: !!req });
      if (f.name === 'limits') g.label = 'Production controls, conditions, and limits (beyond the claimed controls)';
      if (dr && dr.vals && dr.vals[f.name] != null) g.value = dr.vals[f.name];
      out.push(g);
    });
    out.push({ tab: 'ctl', name: 'support', type: 'support', label: 'Claimed controls', rows: sv ? sv.rows : [], threads: [], net: sv ? sv.net : null, supported: sv ? sv.supported : 0, netTier: sv ? sv.netTier : null, inherent: c.scoring ? c.scoring.inherent : null });
    out.push({ tab: 'approval', name: 'draftrev', type: 'hidden', value: dr ? dr.rev : 0 });
    if (draftNote) out.push({ tab: 'approval', name: 'draftnote', type: 'note', label: draftNote + ' Anyone on the review can add to it. Only an approver can approve.' });
    return out;
  };
  const noteFields = () => {
    const mine = (c.panelNotes || []).find(n => n.by === actor.id) || {};
    return [{ name: 'lean', label: 'Your leaning', type: 'select', required: true, value: mine.lean || '', options: [{ v: 'approve', l: 'Approve' }, { v: 'remediate', l: 'Remediate' }, { v: 'reject', l: 'Reject' }] }, { name: 'text', label: 'Your review note (what you changed, and thoughts for the panel)', type: 'textarea', required: true, value: mine.text || '' }];
  };
  const voteFields = () => {
    const X = c.stage === 'exec', v0 = revVotes(c), mv = v0[actor.id] || {}, mn = (c.panelNotes || []).find(n => n.by === actor.id) || {}, bl0 = revBlockers(c, R);
    const kinds = X ? ['approve', 'waive', 'remediate', 'reject'] : ['approve'].concat(tier === 'critical' ? [] : ['waive']).concat(['remediate', 'reject']).concat(tier === 'critical' ? [] : ['escalate']).concat(['abstain', 'await']);
    const f = [];
    if (bl0.texts.length) f.push({ tab: 'notes', name: 'blk', type: 'note', label: 'Not ready for a firm decision. ' + bl0.texts.join(' ') + ' Until that clears you can lean, ask to wait for input, or abstain. When it clears, every reviewer is emailed to look again.' });
    const ch = mv.snap ? termsDiff(mv.snap, termsNow(c, R)) : [];
    if (ch.length) f.push({ tab: 'notes', name: 'chg', type: 'note', label: 'What changed since your firm decision: ' + ch.map(x => x.label + (Array.isArray(x.to) ? ' (changed)' : ' (was "' + x.from + '", now "' + x.to + '")')).join('; ') + '.' });
    f.push({ tab: 'notes', name: 'decision', label: 'Your decision', type: 'select', required: false, value: mv.dec || '', options: kinds.map(d => ({ v: d, l: decLabel(d, tier, c.stage) })) });
    if (kinds.length) f.push({ tab: 'notes', name: 'strength', label: 'How sure are you?', type: 'select', required: false, value: mv.dec && !['abstain', 'await'].includes(mv.dec) ? (mv.firm ? 'firm' : 'leaning') : '', options: [{ v: 'firm', l: 'Firm: I have decided' }, { v: 'leaning', l: 'Leaning: I may still change my mind' }] });
    f.push({ tab: 'notes', name: 'text', label: 'Your review note (what you changed, and thoughts for the others)', type: 'textarea', required: false, value: mn.text || '' });
    if (!X) {
      const opt = (c.consults || []).filter(k => k.status === 'pending' && !(k.kind === 'sme' && k.required !== false)).map(k => ({ v: k.id, l: byId(k.personId).name + ' (' + (k.kind === 'sme' ? 'expert' : 'stakeholder') + ')' }))
        .concat((c.attestations || []).filter(a => a.status !== 'confirmed' && a.status !== 'declined').map(a => ({ v: 'a:' + a.controlId, l: byId(a.personId).name + ' (confirmer for ' + ((R.controls.find(k => k.id === a.controlId) || {}).short || a.controlId) + ')' })));
      if (opt.length) f.push({ tab: 'notes', name: 'awaitIds', label: 'Only if you chose Awaiting input: you always wait for the required expert responses. Tick any other answers you also want to hear first. You are emailed when they all arrive.', type: 'checks', required: false, options: opt, value: mv.dec === 'await' ? (mv.awaitIds || []) : [] });
    }
    f.push({ tab: 'pilot', name: 'waiver', label: 'Reason for waiving the pilot (only needed to hold "approve and waive" firm)', type: 'textarea', required: false, value: dval('waiver', '') });
    return f.concat(reviewFields(false, X ? 'exec' : 'panel').filter(x => x.name !== 'rationale'));
  };
  const canEvidence = ['use_case', 'vetting', 'panel', 'exec', 'pilot', 'production'].includes(c.stage) && role !== 'admin' && (['lead', 'panel', 'sme', 'stakeholder', 'exec'].includes(role) || adv || mine || actor.id === ownerOf(c) || (c.attestations || []).some(a => a.personId === actor.id));
  const myAtt = (c.attestations || []).filter(a => a.personId === actor.id && a.status === 'pending');
  const tiersAbove = t => TIERS.filter(x => tIdx(x) > tIdx(t)).map(x => ({ v: x, l: TIER_LABEL[x] }));
  const mineConsult = (c.consults || []).find(k => k.personId === actor.id && k.status === 'pending');
  if (mineConsult && ['use_case', 'vetting', 'panel', 'exec'].includes(c.stage)) A('respond', mineConsult.kind === 'sme' ? 'Respond to consult (required)' : 'Share feedback', { tone: 'primary', fields: [{ name: 'stance', label: mineConsult.kind === 'sme' ? 'Assessment' : 'View', type: 'select', required: true, options: [{ v: 'support', l: 'No concerns' }, { v: 'concerns', l: 'Concerns to address' }, { v: 'serious', l: 'Serious concern' }] }, { name: 'text', label: mineConsult.kind === 'sme' ? 'Your assessment' : 'Feedback on business value, risks and concerns', type: 'textarea', required: true }] });
  switch (c.stage) {
    case 'suggestion':
      if (mine || adv) A('develop', 'Develop into a use case', { tone: 'primary', fields: [NOTE(false)] });
      if (mine && !adv) A('ask_adviser', 'Ask adoption adviser', { fields: [{ name: 'message', label: 'What do you need help with? (optional)', type: 'textarea', required: false }], confirmLabel: 'Send request', intro: 'Your adoption adviser is ' + (byId(c.adviserId) || { name: 'the governance lead' }).name + '. They will get your request in their queue and by email.' });
      if (adv && helpOpen) A('help_done', 'Mark help given', { fields: [NOTE(false)] });
      if (role === 'lead') A('set_adviser', 'Change adviser', { fields: [{ name: 'adviser', label: 'Adoption adviser', type: 'select', required: true, value: c.adviserId || '', options: PEOPLE.filter(x => x.role === 'adviser' || x.role === 'lead').map(x => ({ v: x.id, l: x.name })) }] });
      break;
    case 'use_case': {
      const so = c.signoff && c.signoff.status === 'requested', own = ownerOf(c);
      if (so) {
        if (actor.id === c.signoff.ownerId) { A('signoff_accept', 'Accept and submit for triage', { tone: 'primary', form: true }); A('save_draft', 'Save draft', { form: true }); A('request_confirmations', 'Send confirmation requests', { form: true }); A('signoff_decline', 'Decline and return', { tone: 'warn', fields: [NOTE(true)] }); }
        else if (mine || c.signoff.requestedBy === actor.id) A('withdraw_signoff', 'Withdraw sign-off request', { fields: [NOTE(false)] });
      } else if (mine || adv) {
        if (mine && !adv) A('ask_adviser', 'Ask adoption adviser', { fields: [{ name: 'message', label: 'What do you need help with? (optional)', type: 'textarea', required: false }], confirmLabel: 'Send request', intro: 'Your adoption adviser is ' + (byId(c.adviserId) || { name: 'the governance lead' }).name + '. They will get your request in their queue and by email.' });
        if (adv && helpOpen) A('help_done', 'Mark help given', { fields: [NOTE(false)] });
        if (role === 'lead') A('set_adviser', 'Change adviser', { fields: [{ name: 'adviser', label: 'Adoption adviser', type: 'select', required: true, value: c.adviserId || '', options: PEOPLE.filter(x => x.role === 'adviser' || x.role === 'lead').map(x => ({ v: x.id, l: x.name })) }] });
        A('submit', own === actor.id ? 'Submit for triage' : 'Request owner sign-off', { tone: 'primary', form: true });
        { const bl = trainingBlocks(ctx.training, actor, R, ctx.now); if (bl.length) { const sub = out[out.length - 1]; sub.blockedMsg = trainingMsg(bl); } }
        A('save_draft', 'Save draft', { form: true });
        A('request_confirmations', 'Send confirmation requests', { form: true });
      }
      break;
    }
    case 'vetting':
      if (role === 'lead') {
        if (tier === 'low') A('vet_approve', 'Approve to production', { tone: 'go', fields: [NOTE(false)].concat(acc()) });
        const slo = secondLookOptions(c, R), sdiff = formDiff(c.formAtReturn, c.form, R), pendAsk = (c.consults || []).filter(k => k.status === 'pending').map(k => ({ v: k.id, l: byId(k.personId).name + ' (' + (k.kind === 'sme' ? (k.required !== false ? 'required expert' : 'expert') : 'process stakeholder') + '), asked ' + new Date(k.requestedAt).toDateString() }));
        A('vet_to_panel', 'Send to standing panel', { tone: tier === 'low' ? '' : 'primary', intro: tier === 'low' ? 'A Low case does not have to be rated higher to deserve a second look. Give your reason below. Raising the tier is optional.' : 'Add a note if you like. Raising the tier is optional.', fields: [{ name: 'note', label: tier === 'low' ? 'Reason for sending this case to the panel' : 'Note (optional)', type: 'textarea', required: tier === 'low' }].concat(tier === 'critical' ? [] : [{ name: 'raiseTo', label: 'Raise the tier? (not required)', type: 'select', required: false, options: [{ v: '', l: 'No, keep ' + TIER_LABEL[tier] }].concat(tiersAbove(tier)) }]).concat(slo.length ? [{ name: 'diffnote', type: 'note', label: c.formAtReturn ? 'Changed since it was returned: ' + (sdiff.length ? sdiff.join('; ') : 'no answers changed') + '.' : 'Experts and stakeholders consulted earlier are listed below.' }, { name: 'again', label: 'Ask for a second look (they are emailed their earlier comments and what changed). Experts whose area is still triggered hold the decision until they respond. Everyone else stays on the case as they answered.', type: 'checks', required: false, options: slo, value: [] }] : []).concat(pendAsk.length ? [{ name: 'cancelPending', label: 'Still waiting on these requests, sent before the case was returned. Leave them and the answer counts when the case reaches the panel (a required expert still holds the decision). Tick one to cancel a request you no longer need.', type: 'checks', required: false, options: pendAsk, value: [] }] : []) });
        A('vet_remediate', 'Remediate, with reason', Object.assign({ tone: 'warn', fields: [NOTE(true)] }, BACK()));
      }
      break;
    case 'panel': {
      const isRev = (role === 'panel' || role === 'lead') && !sepB;
      const bl = revBlockers(c, R), rdy = revReady(c, R), dl = revDeadlock(c, R, ctx.now), wq = revQuorumWaivable(c, R), NQ = revNeed(c, R);
      if (isRev) {
        A('rv_vote', revVotes(c)[actor.id] ? 'Change my decision' : 'Record my decision', { tone: 'primary', tabs: TAB_APPROVE, defaultTab: 'notes', intro: 'Choose a decision and write your note. You can also change the approval terms on the other tabs. Everyone on the review sees your decision and note.', fields: voteFields() });
        A('review_draft', 'Save changes without deciding', { inline: true, tabs: TAB_APPROVE, fields: reviewFields(false, 'panel') });
        if (rdy && rdy.ok) A('rv_decline', 'Leave it for the lead', { inline: true, hidden: true });
      }
      if (isRev && rdy && rdy.ok) {
        const intro = rdy.firm + ' of ' + NQ + ' needed reviewers hold this decision firm and nobody disagrees. Check each tab one last time, then confirm. Write the summary for the submitter yourself.';
        const d = rdy.dec;
        if (d === 'approve' && tier === 'critical') A('panel_recommend', 'Finalize: recommend approval to executives', { tone: 'go', tabs: TAB_APPROVE, canDraft: true, intro, fields: reviewFields(true, 'recommend') });
        else if (d === 'approve') A('panel_approve', 'Finalize: approve for pilot', { tone: 'go', tabs: TAB_APPROVE, canDraft: true, intro, fields: reviewFields(true, 'panel') });
        else if (d === 'waive') A('panel_waive', 'Finalize: approve and waive pilot', { tone: 'neutral', tabs: TAB_APPROVE.map(t => t[0] === 'pilot' ? ['pilot', 'Pilot waiver'] : t), canDraft: true, intro, fields: reviewFields(true, 'waive') });
        else if (d === 'escalate') A('panel_escalate', 'Finalize: send to executives', { tone: 'escalate', intro: intro + ' The executives decide this case, with the full executive quorum. The tier does not change.', fields: [{ name: 'note', label: 'Note for the executives (optional)', type: 'textarea', required: false }] });
        else if (d === 'remediate') A('panel_remediate', 'Finalize: remediate', Object.assign({ tone: 'warn', fields: [{ name: 'rationale', label: 'Summary for the submitter', type: 'textarea', required: true }] }, BACK(), { intro: intro + ' ' + BACK().intro }));
        else if (d === 'reject') A('panel_reject', 'Finalize: reject', Object.assign({ tone: 'stop', fields: [RSN, NPF] }, REJ(), { intro: intro + ' ' + REJ().intro }));
      }
      if (role === 'lead' && !sepB && dl) {
        const opts = deadlockOptions(c, dl), wv = opts.some(o => o.v === 'waive'), lean = !!dl.lean;
        A('panel_break', 'Break deadlock', { tone: 'escalate', tabs: TAB_APPROVE, canDraft: true, intro: (lean ? 'Everyone left holds "' + opts[0].l + '" and the deadline has passed, but not everyone is firm, so leanings now count as firm. You may carry it out. Write the summary for the submitter in the decision notes.' : 'The reviewers disagree. Read every reviewer\'s decision and note in the list on this tab, choose how to resolve it, and write the summary for the submitter in the decision notes. ') + (lean ? '' : opts[0].v === 'remediate' ? 'Because someone wants changes, a rejection or more input, the only way forward is to send it back for remediation. Nothing is approved over a dissent.' : 'The reviewers only differ on the form of approval, so you may push one of the approval decisions.'), fields: [{ tab: 'notes', name: 'outcome', label: 'How to resolve it', type: 'select', required: false, value: opts[0].v, options: opts.map(o => ({ v: o.v, l: o.l })) }].concat(reviewFields(false, 'panel', (wv ? [{ name: 'waiver', label: 'Reason for waiving the pilot (only if you choose approve and waive)', type: 'textarea', required: false, value: dval('waiver', '') }] : []).concat(opts.some(o => o.v === 'reject') ? [NPF] : []))) });
      }
      if (role === 'lead' && !sepB && wq) {
        A('panel_waivequorum', 'Waive quorum', { tone: 'escalate', tabs: TAB_APPROVE, canDraft: true, intro: wq.n + ' of ' + wq.of + ' reviewers are left and all of them hold "' + decLabel(wq.dec, tier) + '" firm. The others abstained, so the usual quorum of ' + NQ + ' cannot be met. Waiving the quorum carries out that decision, and the record will say it was decided with ' + wq.n + ' of ' + wq.of + ' reviewers.', fields: reviewFields(false, wq.dec === 'waive' ? 'waive' : 'panel', wq.dec === 'reject' ? [NPF] : []) });
      }
      if (role === 'lead') {
        const asked = new Set((c.consults || []).map(k => k.personId)), lastK = pid => (c.consults || []).filter(k => k.personId === pid).sort((a, b) => b.requestedAt - a.requestedAt)[0], optOf = p => ({ v: p.id, l: p.name + ', ' + p.title, disabled: asked.has(p.id) });
        const need = c.legacy ? {} : consultNeeds(c.form, R), byPerson = {}; Object.values(need).forEach(n => { byPerson[n.personId] = n; });
        const areas = (R.consultAreas || []).filter(a => a.enabled !== false && byId(a.personId)), askedK = a => (c.consults || []).filter(k => k.kind === 'sme' && (k.areaId ? k.areaId === a.id : k.personId === a.personId)).sort((x, y) => y.requestedAt - x.requestedAt)[0];
        const smeOpts = areas.map(a => { const n = need[a.id], k = askedK(a), p = byId(a.personId), blk = k ? '' : dutyBlock(c, a.personId, 'expert'); return { v: a.id, l: a.label + ' (' + p.name + ')', blocked: blk, disabled: !!blk || (!!k && k.status !== 'pending'), level: n ? n.level : '', why: n ? n.reasons[n.reasons.length - 1].label : '', asked: !!k, askedNote: k ? (k.status === 'pending' ? askedAgo(k.requestedAt, ctx.now) : 'responded') : '', askedQ: k ? k.question : '', responded: !!k && k.status !== 'pending', held: !!k && k.required !== false, qDefault: a.question || '' }; }), stk = withRole('stakeholder').concat(c.adviserId && byId(c.adviserId).role === 'adviser' ? [byId(c.adviserId)] : []).filter(p => !dutyBlock(c, p.id, 'stakeholder')).map(optOf);
        const pre = smeOpts.filter(o => !o.blocked && (o.asked || need[o.v])).map(o => o.v), preReq = smeOpts.filter(o => !o.blocked && ((o.asked && o.held) || (need[o.v] && need[o.v].level === 'required'))).map(o => o.v);
        A('consult', 'Consult experts and notify stakeholders', { tone: 'primary', confirmLabel: 'Send', fields: [{ name: 'smes', sec: 'sme', secTitle: 'Subject matter experts', label: 'Tick each area you need a view on and write a question for it. Required experts are always asked and always hold the decision. For the others, tick Hold only if their answer must come first. You can also untick Hold for an expert who was already asked.', type: 'smetable', options: smeOpts.map(o => Object.assign({}, o, { forced: o.level === 'required' })), value: pre, reqValue: preReq }, { name: 'stakeholders', sec: 'stk', secTitle: 'Process stakeholders', label: 'Operators, users and customers of the process. Feedback is welcome and never holds the decision. They all get the same message.', type: 'stkblock', options: stk, value: [], qValue: 'Please share your feedback on the business value, risks and concerns of this use case.' }].concat(secondLookOptions(c, R).length ? [{ name: 'again', label: 'Ask for a second look: people who already answered. They are emailed their earlier comment' + (c.formAtReturn ? ' and what changed since the case was returned' : '') + '. Experts whose area is still triggered hold the decision until they respond.', type: 'checks', required: false, options: secondLookOptions(c, R), value: [] }] : []) });
        { const pend = (c.consults || []).filter(k => k.status === 'pending'), lab = (k, dflt) => ({ v: k.id, l: byId(k.personId).name + ' (' + (byId(k.personId).title || dflt) + '), ' + askedAgo(k.requestedAt, ctx.now, k.lastReminderAt) }),
            pk = pend.filter(k => k.kind === 'sme').map(k => lab(k, 'expert')), psl = pend.filter(k => k.kind !== 'sme').map(k => lab(k, 'stakeholder')),
            pa = (c.attestations || []).filter(a => a.status !== 'confirmed' && a.status !== 'declined').map(a => ({ v: 'a:' + a.controlId, l: byId(a.personId).name + ' (confirmer for ' + ((R.controls.find(k => k.id === a.controlId) || {}).short || a.controlId) + '), ' + askedAgo(a.requestedAt || a.at || c.updatedAt, ctx.now, a.lastReminderAt) }));
          if (pk.length || psl.length || pa.length) A('remind', 'Send reminders', { tone: 'soft', confirmLabel: 'Send', intro: 'These people have been asked and have not responded. Tick the ones to remind.', fields: [{ name: 'whoE', label: 'Experts', type: 'checks', options: pk, value: [] }, { name: 'whoS', label: 'Process stakeholders', type: 'checks', options: psl, value: [] }, { name: 'whoC', label: 'Confirmers', type: 'checks', options: pa, value: [] }].filter(f => f.options.length) }); }
      }
      break;
    }
    case 'exec':
      if (role === 'exec' && !sepB) {
        const rdy = revReady(c, R), dl = revDeadlock(c, R, ctx.now), NQ = revNeed(c, R), rat = { name: 'rationale', label: 'Summary for the submitter', type: 'textarea', required: true };
        A('rv_vote', revVotes(c)[actor.id] ? 'Change my decision' : 'Record my decision', { tone: 'primary', tabs: TAB_APPROVE, defaultTab: 'notes', intro: 'Choose a decision and write your note. You can also change the approval terms on the other tabs. Every executive decides individually. Your decision stays open to change until the executives decide.', fields: voteFields() });
        A('review_draft', 'Save changes without deciding', { inline: true, tabs: TAB_APPROVE, fields: reviewFields(false, 'exec') });
        if (rdy && rdy.ok) {
          const intro = rdy.firm + ' of ' + NQ + ' needed executives hold this decision firm and nobody disagrees. Check each tab one last time, then confirm. Write the summary for the submitter yourself.', d = rdy.dec;
          if (d === 'approve') A('exec_approve', 'Finalize: approve for pilot', { tone: 'go', tabs: TAB_APPROVE, canDraft: true, intro, fields: reviewFields(true, 'exec') });
          else if (d === 'waive') A('exec_waive', 'Finalize: approve and waive pilot', { tone: 'neutral', tabs: TAB_APPROVE.map(t => t[0] === 'pilot' ? ['pilot', 'Pilot waiver'] : t), canDraft: true, intro, fields: reviewFields(true, 'execwaive') });
          else if (d === 'remediate') A('exec_remediate', 'Finalize: remediate', Object.assign({ tone: 'warn', fields: [rat] }, BACK(), { intro: intro + ' ' + BACK().intro }));
          else if (d === 'reject') A('exec_reject', 'Finalize: reject', Object.assign({ tone: 'stop', fields: [RSN, NPF] }, REJ(), { intro: intro + ' ' + REJ().intro }));
        }
        if (dl) {
          const opts = deadlockOptions(c, dl), lean = !!dl.lean;
          A('exec_break', 'Break deadlock', { tone: 'escalate', tabs: TAB_APPROVE, canDraft: true, intro: (lean ? 'Everyone left holds "' + opts[0].l + '" and the deadline has passed, but not everyone is firm, so leanings now count as firm. Write the single summary for the submitter in the decision notes.' : 'The executives disagree. Read every executive\'s decision and note in the list on this tab, choose how to resolve it, and write the single summary for the submitter in the decision notes. ') + (lean ? '' : opts[0].v === 'remediate' ? 'The executives split on the direction, so the case goes back to the submitter for remediation.' : 'The executives only differ on whether to run a pilot, so it goes to pilot.'), fields: [{ tab: 'notes', name: 'outcome', label: 'How to resolve it', type: 'select', required: false, value: opts[0].v, options: opts.map(o => ({ v: o.v, l: o.l })) }].concat(reviewFields(false, 'exec', (opts.some(o => o.v === 'waive') ? [{ name: 'waiver', label: 'Reason for waiving the pilot', type: 'textarea', required: false, value: dval('waiver', '') }] : []).concat(opts.some(o => o.v === 'reject') ? [NPF] : []))) });
        }
      }
      break;
    case 'pilot':
      if (role === 'lead') {
        A('pilot_promote', 'Promote to production', { tone: 'go', fields: [NOTE(false)].concat(mf(true)) });
        A('pilot_rework', 'Needs rework, stay in pilot', { tone: 'warn', intro: 'The use case stays in pilot and the next pilot review moves out 14 days, so the team has time to fix the problems. Your note is emailed to ' + subm() + '. Enter the latest KPI results below if you have them.', fields: [NOTE(true)].concat(mf(false)) });
        A('pilot_escalate', 'Risk beyond approval: back to panel', { tone: 'escalate', intro: 'Use this when the pilot shows risk beyond what the panel approved. The use case goes back to the standing panel for a fresh review, and panel members are emailed your note. Earlier panel notes and consultation replies are cleared, but the approved KPIs and limits stay as the starting point.', fields: [NOTE(true)].concat(mf(false)) });
        A('pilot_reject', 'Fails or new risk: reject', { tone: 'stop', intro: 'This ends the pilot and closes the use case. Your reason is emailed to ' + subm() + ', who can return it to the suggestion box to start over. It is also shown to people who later propose something similar. Enter the latest KPI results below if you have them.', fields: [Object.assign({}, NOTE(true), { label: 'Reason (guides future submitters)' }), NPF].concat(mf(false)) });
        if (mf(true).length) A('log_measure', 'Record KPI results', { tone: 'primary', intro: 'Enter the latest result for each KPI. The use case stays where it is. If a result passes its stop limit, the governance lead is alerted and decides what happens next.', fields: mf(true) });
      }
      break;
    case 'production':
      if (role === 'lead') A('monitor_ok', 'Log review: continue', { tone: 'go', intro: 'Use this for a routine review when the use case is still working as approved. It stays in production and the next review is scheduled ' + ((c.acceptance && c.acceptance.prodReviewDays) || R.reviewCadenceDays[c.tier]) + ' days from now. Enter the latest KPI results below (required), and say how bias was reviewed.', fields: [NOTE(false), { name: 'bias', label: 'Model bias review (required)', type: 'select', required: true, options: BIAS_OPTS.map(o => ({ v: o[0], l: o[1] })) }].concat(mf(true)) });
      if (role === 'lead' && mf(true).length) A('log_measure', 'Record KPI results', { tone: 'primary', intro: 'Enter the latest result for each KPI. The use case stays where it is. If a result passes its stop limit, the governance lead is alerted and decides what happens next.', fields: mf(true) });
      if (role === 'lead' || mine) A('monitor_reassess', 'Material change: reassess', { tone: 'warn', intro: 'Use this when the use case has changed in a way the approval did not cover, such as a new data source, a wider audience or a new capability. You are not entering new metrics: explain the change in the reason. The case moves back to the Use case stage and ' + subm() + ', the submitter, is emailed your reason. They update the details and resubmit, and it goes through triage, scoring and review again. The KPI results below are optional.', fields: [NOTE(true)].concat(mf(false)) });
      break;
    case 'closed':
      if (c.closed && c.closed.notPermitted) { if (role === 'lead') A('allow_again', 'Remove "not permitted"', { tone: 'warn', intro: 'This idea was marked not permitted. Removing the mark lets the submitter, the owner, an adviser or you return it to the suggestion box.', fields: [NOTE(true)] }); }
      else if (mine || actor.id === ownerOf(c) || role === 'lead' || adv) A('reopen', 'Return to the suggestion box', { fields: [NOTE(false)] });
      break;
  }
  if (acceptanceExpired(c, ctx.now) && role === 'lead') A('renew_acceptance', 'Renew the approval', { tone: 'go', intro: 'The approval has expired. Renewing it confirms the use case is still fine as it is running and sets a new approval period, so it stays in production. Check the KPIs and limits below and change them if they no longer fit.', fields: [NOTE(false)].concat(acc()) });
  if (canEvidence && (c.form.controls || []).length) A('add_evidence', 'Add evidence', { inline: true });
  if (canEvidence && !['sme', 'stakeholder'].includes(role) && (c.form.controls || []).some(id => { const k = (normRules(ctx.rules).controls || []).find(x => x.id === id); return k && !ctlApplies(k, c.form, normRules(ctx.rules)); })) A('remove_control', 'Remove a control that does not apply', { inline: true });
  (c.evidenceItems || []).filter(e => !e.removed && canEvidence && (e.by === actor.id || role === 'lead')).forEach(e => A('remove_evidence', 'Remove evidence', { inline: true, evidenceId: e.id }));
  if (myAtt.length && (SCORED_STAGES.includes(c.stage) || c.stage === 'use_case')) A('attest', 'Confirm controls (' + myAtt.length + ')', { tone: 'primary', fields: myAtt.map(a => ({ name: 'd_' + a.controlId, label: ((R.controls.find(x => x.id === a.controlId) || {}).text || a.controlId) + (a.evidence ? '. Evidence offered: ' + a.evidence : ''), type: 'select', required: true, options: [{ v: 'confirm', l: 'I confirm this control is in place' }, { v: 'decline', l: 'I cannot confirm it' }] })).concat([{ name: 'text', label: 'Basis for your answer', type: 'textarea', required: true }]) });
  return out;
}

// ---- Apply an action. Returns a new case object; throws Error with a readable message. ----
function perform(c0, id, input, actor, ctx) {
  input = input || {};
  const c = clone(c0), R = ctx.rules, now = ctx.now;
  const allowed = actionsFor(c0, actor, ctx).find(a => a.id === id);
  if (!allowed) throw new Error('This action is not available to ' + actor.name + ' right now.');
  if (allowed.disabled) throw new Error(allowed.why);
  (allowed.fields || []).forEach(f => { if (f.required && !(Array.isArray(input[f.name]) ? input[f.name].length : String(input[f.name] == null ? '' : input[f.name]).trim())) throw new Error(f.label.replace(/ \(.*\)$/, '') + ' is required.'); });
  const note = String(input.note || '').trim(), rat = String(input.rationale || '').trim();
  const DRAFT_KEYS = ['rationale', 'scope', 'days', 'waiver', 'limits', 'validDays', 'prodDays'];
  const saveDraft = () => {
    if (!DRAFT_KEYS.some(k => k in input) && !('measures' in input)) return;
    const tBefore = termsNow(c, R);
    const d = clone(c.reviewDraft || { rev: 0, vals: {}, overrides: {}, touched: [] });
    if (c.reviewDraft && input.draftrev !== undefined && input.draftrev !== 'force' && String(input.draftrev == null ? '' : input.draftrev) !== String(c.reviewDraft.rev)) throw new Error('Someone else saved a newer version of this review (' + byId(c.reviewDraft.by).name + ', ' + new Date(c.reviewDraft.at).toDateString() + '). Close and reopen to see it, or save again to overwrite it.');
    DRAFT_KEYS.forEach(k => { if (k in input) d.vals[k] = input[k]; });
    if ('measures' in input) d.vals.measures = clone(input.measures);
    looseThreads(c, R).forEach(t => { const r = String(input['ov_' + t.slug] || '').trim(), on = !!input['ovc_' + t.slug]; if (r || on) d.overrides[t.slug] = { on, reason: r, sig: t.kind + '|' + t.detail + '|' + t.label, by: actor.id, at: now }; else delete d.overrides[t.slug]; });
    d.rev = (d.rev || 0) + 1; d.by = actor.id; d.at = now; d.touched = (d.touched || []).concat([{ by: actor.id, at: now }]).slice(-30);
    c.reviewDraft = d;
    if (!input.__seed) dropFirm(termsDiff(tBefore, termsNow(c, R)));
  };
  // When someone changes the shared terms, firm decisions of the other reviewers go back to leaning. Only those reviewers are emailed.
  const dropFirm = ch => {
    const vs = c[voteKey(c)]; if (!ch.length || !vs) return;
    const hit = Object.keys(vs).filter(pid => pid !== actor.id && vs[pid].firm); if (!hit.length) return;
    hit.forEach(pid => { vs[pid].firm = false; vs[pid].lastMailAt = now; });
    const lbl = ch.map(x => x.label).join(', ');
    mail(hit, 'Approval terms changed on ' + c.id + ': please look again', actor.name + ' changed ' + lbl + ' on "' + c.title + '". Your firm decision is now a leaning one until you confirm it again.', 'task', { banner: ['ask', 'The approval terms changed', actor.name + ' changed the terms after you decided. Your decision now counts as leaning until you confirm it.'], notes: [['What changed', lbl, 'note']], button: 'Open the case and review the changes', only: 1 });
    log('Panel note: terms changed', 'Changed ' + lbl + '. Firm decisions went back to leaning.', {});
  };
  const draftTouched = () => ((c.reviewDraft && c.reviewDraft.touched) || []).map(t => ({ by: t.by, at: t.at }));
  const collectOverrides = () => looseThreads(c, R).map(t => { const r = String(input['ov_' + t.slug] || '').trim(); if (!input['ovc_' + t.slug]) throw new Error('Tick Accept for this risk before approving: ' + t.label + '.'); if (!r) throw new Error('Say why you accept this risk as is: ' + t.label + '.'); return { id: t.id, kind: t.kind, head: t.head || t.label, stance: t.stance || '', label: t.kind === 'concern' ? t.label + ', ' + (t.stance === 'serious' ? 'serious concern' : 'concerns to address') : t.label, detail: t.detail, reason: r }; });
  const voteSummary = () => { const v = revVotes(c); return revPool(c).filter(id => v[id]).map(id => ({ by: id, dec: v[id].dec, firm: !!v[id].firm })); };
  const archiveRound = (kind, outcome, how, summary) => {
    const v = revVotes(c), X = kind === 'exec';
    c.rounds = c.rounds || [];
    c.rounds.push({ n: c.rounds.length + 1, kind, at: now, by: actor.id, outcome, how: how || 'consensus', summary: summary || '', votes: voteSummary(), notes: (c.panelNotes || []).filter(n => (byId(n.by).role === 'exec') === X).map(n => ({ by: n.by, text: n.text, dec: (v[n.by] || {}).dec || n.lean, firm: !!(v[n.by] || {}).firm, at: n.at })), terms: termsNow(c, R) });
  };
  const wqInfo = id === 'panel_waivequorum' ? revQuorumWaivable(c0, R) : null;
  const howTxt = how => how === 'deadlock' ? ' The reviewers disagreed. ' + actor.name + ' broke the deadlock.' : how === 'quorum' && wqInfo ? ' Quorum waived by ' + actor.name + ': decided with ' + wqInfo.n + ' of ' + wqInfo.of + ' reviewers, the others abstained.' : '';
  const stamp = how => ({ how: how || 'consensus', votes: voteSummary() });
  const ovNote = ov => ov.length ? ' Accepted ' + ov.length + ' risk' + (ov.length > 1 ? 's' : '') + ' as is: ' + ov.map(o => o.label + ' (' + o.reason + ')').join('; ') + '.' : '';
  // One formal notice at approval: everything the submitter and owner have agreed to.
  const approvalNotice = (how, notes, ov) => {
    const d = ts => new Date(ts).toDateString(), ac = c.acceptance || {}, L = [];
    const subs = c.audit.filter(e => e.action === 'Submitted for triage').map(e => e.ts);
    L.push('Decision: ' + how + ', by ' + actor.name + ' on ' + d(now) + '.');
    L.push('Time from submission to decision: ' + (subs.length ? Math.max(0, Math.round((now - subs[0]) / DAY)) + ' days' : 'not recorded') + ', over ' + (subs.length || 1) + ' review cycle' + (subs.length > 1 ? 's' : '') + '.');
    if (notes) L.push('Decision notes: ' + notes);
    L.push('Accepted risks: ' + (ov.length ? ov.map(o => o.label + ' (' + o.reason + ')').join('; ') : 'none.'));
    if (c.pilot && c.pilot.waived) L.push('Pilot: waived. Reason: ' + c.pilot.waiverReason + '.');
    else if (c.pilot) L.push('Pilot scope and conditions: ' + String(c.pilot.scope).replace(/\.$/, '') + '. Pilot review date: ' + d(c.pilot.reviewDueAt) + '.');
    else L.push('Pilot: none. Approved straight to production.');
    L.push('Production conditions and limits: ' + (ac.limits || 'none beyond the claimed controls.'));
    L.push('Approval valid until: ' + (ac.validUntil ? d(ac.validUntil) : 'not set') + '.');
    L.push('Review cycle: every ' + (ac.prodReviewDays || R.reviewCadenceDays[c.tier]) + ' days in production' + (c.production ? '. Next review: ' + d(c.production.nextReviewAt) + '.' : ', starting when it is promoted to production.'));
    L.push('KPIs: ' + ((ac.measures || []).map(m => m.name + ' (target ' + m.target + ', stop limit ' + m.stop + ')').join('; ') || 'none.'));
    const sv = supportView(c, R), stl = { confirmed: 'confirmed', evidence: 'supported by evidence', declined: 'declined' };
    L.push('Claimed controls: ' + (sv.rows.length ? sv.rows.map(r => r.text + ' (' + (r.na ? 'does not apply to this case' : (stl[r.status] || 'not yet supported')) + ')').join('; ') : 'none.'));
    mail(c.submitterId, 'Approval notice: ' + c.title, L.join('\n'), 'decision');
  };
  const log = (action, text, o) => { o = o || {}; const from = c.stage; if (o.to && o.to !== from) { c.stage = o.to; c.stageSince = now; } if ('due' in o) c.dueAt = o.due; c.audit.push({ ts: now, actor: o.auto ? 'system' : actor.id, action, note: text || '', from, to: c.stage, auto: !!o.auto, tag: o.tag || '' }); };
  const mail = (to, subject, body, kind, x, opt) => { const base = [].concat(to), extra = []; if (base.includes(c.submitterId)) { const ow = ownerOf(c), ad = c.adviserId; if (ow && ow !== c.submitterId) extra.push(ow); if (ad) extra.push(ad); } const recips = base.concat(extra.filter(id => !(opt && opt.skipActor && id === actor.id))); c.outbox.push({ x: x ? JSON.stringify(x) : null, ts: now, n: c.outbox.length, to: recips.filter((id, k) => recips.indexOf(id) === k), subject, body, kind: kind || '', auto: true }); };
  const lead = withRole('lead')[0], panelPeople = [lead].concat(withRole('panel')).map(p => p.id);
  const cadence = () => (c.acceptance && c.acceptance.prodReviewDays) || R.reviewCadenceDays[c.tier];
  // The approver's measures and limits stay visible as the starting suggestion for the next approval. KPI results move to history.
  const keepApproval = () => { if (c.acceptance) c.priorAcceptance = c.acceptance; c.measurementHistory = (c.measurementHistory || []).concat(c.measurements || []); c.acceptance = null; c.measurements = []; };
  const toProduction = (how) => { c.production = { since: now, lastReviewAt: now, nextReviewAt: now + cadence() * DAY, reviews: 0, how }; };
  // Records the approver's boundaries and the approved measures. The submitter's original proposal is kept beside them.
  const recordAcceptance = (scope) => {
    const ms = parseMeasures(input.measures, true); if (!ms.length) throw new Error('Record at least one KPI with a target and a stop limit.');
    ms.forEach((m, i) => { m.id = 'm' + (i + 1); });
    const vd = Math.round(+input.validDays), pd = Math.round(+input.prodDays);
    if (!(vd > 0) || !(pd > 0)) throw new Error('The validity period and the production review period must be whole days above zero.');
    if (pd > R.reviewMaxDays[c.tier]) throw new Error('The production review period cannot be longer than the maximum of ' + R.reviewMaxDays[c.tier] + ' days for this tier.');
    if (c.acceptance) { c.acceptanceHistory = (c.acceptanceHistory || []).concat([c.acceptance]); }
    c.acceptance = { by: actor.id, at: now, rv: ctx.rv || 1, scope, limits: String(input.limits || '').trim(), measures: ms, proposed: clone(c.form.measures || []), validDays: vd, validUntil: now + vd * DAY, prodReviewDays: pd };
    c.measurementHistory = (c.measurementHistory || []).concat(c.measurements || []); c.measurements = []; c.priorAcceptance = null;
    return ' Approved for ' + vd + ' days, production review every ' + pd + ' days, ' + ms.length + ' KPI' + (ms.length > 1 ? 's' : '') + '.';
  };
  // Reads the measured values typed with an action and appends them to the case. Returns text for the audit note.
  const recordMeas = () => {
    const ms = (c.acceptance && c.acceptance.measures) || [], values = {}, bits = [], stops = [];
    ms.forEach(m => { const raw = input['mv_' + m.id]; if (raw === '' || raw == null) return; if (isNaN(+raw)) throw new Error(m.name + ' needs a number.'); values[m.id] = +raw; const st = measureState(m, +raw); bits.push(m.name + ' ' + (+raw) + ' (' + MEAS_STATE[st].toLowerCase() + ')'); if (st === 'stop') stops.push(m.name); });
    if (!bits.length) return '';
    c.measurements = (c.measurements || []).concat([{ at: now, by: actor.id, stage: c.stage, values }]);
    if (stops.length) mail(withRole('lead')[0].id, 'Stop limit passed: ' + c.title, 'A KPI result passed its stop limit: ' + stops.join(', ') + '. Review the case and decide whether to rework, reassess or reject.', 'alert');
    return ' Measured: ' + bits.join('; ') + '.';
  };
  const noLongerNeeded = a => { const k = R.controls.find(x => x.id === a.controlId) || {}; mail(a.personId, 'No longer needed: ' + (k.short || k.text || a.controlId) + ' on ' + c.title, 'Your confirmation is no longer needed for the control "' + (k.text || a.controlId) + '" on "' + c.title + '". If you were asked about other controls on this case, those requests are unchanged.', 'notice'); };
  const syncUnit = c2 => { const u = c2.form && c2.form.unitId; if (u && u !== c2.unitId) { assignAdviser(c2, R, u); log('Business unit changed', 'The adviser is now ' + byId(c2.adviserId).name + '.', {}); } };
  const buildAtts = () => {
    const prev = c.attestations || [], out = [];
    (c.form.controls || []).forEach(cid => {
      const pid = (c.form.attesters || {})[cid]; if (!pid) return;
      const ev = String((c.form.evidence || {})[cid] || '').trim(), old = prev.find(a => a.controlId === cid && a.personId === pid);
      // A confirmation is a person's attestation and is independent of the evidence text, so editing evidence never resets it.
      if (old) { old.evidence = ev; out.push(old); return; }
      out.push({ controlId: cid, personId: pid, status: 'pending', evidence: ev, requestedAt: now, at: null, text: '' });
      mail(pid, 'Please confirm a control: ' + c.title, 'You were named as able to confirm "' + ((R.controls.find(x => x.id === cid) || {}).text || cid) + '" from your own knowledge of this use case. You can respond at any time before approval.' + (ev ? ' The submitter also noted: ' + ev : '') + ' Open the case and confirm or decline.', 'task', { banner: ['ask', 'Your confirmation is requested', 'Please respond as soon as you can. It does not block the decision, but your confirmation will strengthen the case.'], notes: [['The control', (R.controls.find(x => x.id === cid) || {}).text || cid, 'ask']].concat(ev ? [['What the submitter noted', ev, 'note']] : []), button: 'Open the case and respond', only: 1 });
    });
    prev.filter(a => !out.some(o => o.controlId === a.controlId && o.personId === a.personId)).forEach(a => { if (a.status === 'pending') noLongerNeeded(a); (c.removedControls = c.removedControls || []).push({ controlId: a.controlId, attestation: a, at: now, by: actor.id }); });
    c.attestations = out;
  };
  // A second look: the person is asked again and shown their earlier comment. Old and new responses both stay on the case.
  const nextKid = () => 'k' + (Math.max(0, ...c.consults.map(k => +String(k.id).slice(1) || 0)) + 1);
  const reconsult = ids => {
    const out = [], needC = c.legacy ? {} : consultNeeds(c.form, R), due = now + R.deadlines.consult[c.tier] * DAY;
    [].concat(ids || []).forEach(kid => {
      const k0 = c.consults.find(k => k.id === kid && k.status !== 'pending' && !k.supersededBy); if (!k0) return;
      const b0 = dutyBlock(c, k0.personId, k0.kind === 'sme' ? 'expert' : 'stakeholder'); if (b0 && !(k0.kind === 'sme' && c.consults.some(k => k.personId === k0.personId))) throw new Error(b0);
      const sme = k0.kind === 'sme', n = k0.areaId ? needC[k0.areaId] : null, req = sme && !!n && (n.level === 'required' || k0.required !== false);
      const nk = { id: nextKid(), kind: k0.kind, personId: k0.personId, areaId: k0.areaId || null, question: k0.question, requestedAt: now, dueAt: sme ? due : null, status: 'pending', reminders: 0, required: req, prevId: k0.id, round: (c.rounds || []).length + 1 };
      c.consults.push(nk); k0.supersededBy = nk.id;
      const stTxt = ({ support: 'No concerns', concerns: 'Concerns to address', serious: 'Serious concern' }), diff = formDiff(k0.formSnap || c.formAtReturn, c.form, R);
      const hist = c.consults.filter(k => k.personId === k0.personId && k.response).sort((a, b) => a.response.at - b.response.at).map(k => ['Your response, ' + new Date(k.response.at).toDateString() + ' (' + (stTxt[k.response.stance] || '') + ')', k.response.text, 'note']);
      mail(k0.personId, 'Second look requested: ' + c.title, 'The use case came back after changes. ' + (sme ? 'A response is ' + (req ? 'required' : 'requested') + ' by ' + new Date(due).toDateString() + '.' : 'Your feedback is welcome.') + ' Your earlier comment: ' + k0.response.text + (diff.length ? ' What changed: ' + diff.join('; ') + '.' : ''), 'consult', { due: sme ? [(req ? 'A response is required by ' : 'A response is requested by ') + new Date(due).toDateString() + '.', req ? 'The decision waits on it.' : 'It does not hold up the decision.'] : undefined, intro: actor.name + ' (' + roleName(actor) + ') asks you to take a second look. The use case was sent back, changed and resubmitted.', notes: hist.concat([['What changed since your last response', diff.join('; ') || 'No answers changed. The case is back for another review.', 'ask']]), button: 'Open the case and respond', only: 1 });
      out.push(byId(k0.personId).name + (req ? ' (required)' : ''));
    });
    if (out.length) log('Consult: second look requested', out.join(', '), {});
    return out;
  };
  const bounce = (from, reason, action, who, tx) => {
    c.returned = { from, reason, at: now }; keepApproval(); c.signoff = null; c.formAtReturn = clone(c.form); c.panelNotes = []; c.votes = {}; c.xvotes = {}; c.readyBy = null; c.reviewDraft = null; c.panelDecision = null; c.briefing = null; c.execDecision = null; c.vetting = null; c.recommendedPilot = null;
    log(action, reason + (tx || ''), { to: 'use_case', due: null, tag: 'remediate' });
    mail(c.submitterId, 'Returned for remediation: ' + c.title, reason, 'return', { banner: ['ret', 'Sent back for changes', 'Returned by ' + actor.name + ' on ' + new Date(now).toDateString() + '. Your use case is not rejected. It needs the changes below, then you can resubmit.'], notes: [['What needs to change', reason, 'note']], button: 'Open and fix your use case', only: 1 });
  };
  const close = (from, reason, action, tx) => { const np = (input.notPermitted || []).includes('np'); c.closed = { from, reason, at: now, notPermitted: np }; log(action + (np ? ' (not permitted)' : ''), reason + (tx || ''), { to: 'closed', due: null, tag: 'reject' }); mail(c.submitterId, 'Closed with reason: ' + c.title, reason + (np ? '\nThis idea was marked as not permitted.' : ''), 'close', { banner: ['cls', np ? 'Closed: not permitted' : 'Closed', 'Closed by ' + actor.name + ' on ' + new Date(now).toDateString() + '.'], notes: [['Reason', reason, 'note']], button: 'View the case', only: 1 }); };
  const startPilot = (scope, days) => { c.pilot = { scope, reviewDays: +days, startedAt: now, reviewDueAt: now + days * DAY, reworks: 0, waived: false }; };
  const doSubmit = () => {
    parseMeasures(c.form.measures, true);
      log('Submitted for triage', '');
      const t = runTriage(c.form, R); c.triage = Object.assign({ at: now, rv: ctx.rv || 1 }, t);
      if (t.result === 'remediate') { c.returned = { from: 'triage', reason: t.reasons.join(' '), reasons: t.reasons, at: now }; log('Triage: remediate', t.reasons.join(' '), { auto: true, to: 'use_case', due: null, tag: 'remediate' }); mail(c.submitterId, 'Returned from triage: ' + c.title, t.reasons.join('\n'), 'return'); }
      else {
        buildAtts(); const sc = runScoring(c.form, R, c.attestations); c.scoring = Object.assign({ at: now, rv: ctx.rv || 1 }, sc); c.tier = sc.tier;
        log('Triage: passed', 'Guardrails clear. Data readiness ' + t.ready.count + ' of ' + t.ready.of + '.', { auto: true });
        log('Scored: ' + TIER_LABEL[sc.tier], 'Inherent ' + sc.inherent + ', residual ' + sc.residual + ' after controls.' + sc.overrides.filter(o => o.raised).map(o => ' Override: ' + o.label + ' raised the tier.').join(''), { auto: true, to: 'vetting', due: dueFor('vetting', sc.tier, now, R) });
        mail(lead.id, 'Ready for vetting: ' + c.title + ' (' + TIER_LABEL[sc.tier] + ')', 'Vetting is due ' + new Date(c.dueAt).toDateString() + '.', 'task');
        { const est = estimateDays(sc.tier, R); mail(c.submitterId, 'Your use case is under review: ' + c.title, 'It passed triage and was scored. The review has started.\nEstimated time to a decision: about ' + est + ' days, around ' + new Date(now + est * DAY).toDateString() + '. This is a standard estimate of how long each review step normally takes. It was made without looking at the details of your case, so it can change with the details and with what the review and any expert consultations turn up.', 'notice', { banner: ['est', 'Your use case is under review', 'We have received it and the review has started.'], facts: [['Estimated time to a final decision', 'About ' + est + ' days from now'], ['Expected around', new Date(now + est * DAY).toDateString()]], caveat: 'This is a standard estimate of how long each review step normally takes. The turnaround may vary based on the details of your use case.', button: 'Track your use case', only: 1 }); }
      }
  };

  // Carries out a panel decision. The reviewers' decisions are archived first so Review history keeps every round.
  const needIn = (kind, how) => {
    if (!rat && !(kind === 'escalate' && how === 'consensus')) throw new Error('Write the summary for the submitter.');
    if (kind === 'approve' || kind === 'recommend') { if (!String(input.scope || '').trim()) throw new Error('Pilot scope and conditions is required.'); if (!(+input.days > 0)) throw new Error('Pilot review days is required.'); } else if (kind === 'waive' && !String(input.waiver || '').trim()) throw new Error('Reason for waiving the pilot is required.');
    if ((kind === 'approve' || kind === 'waive') && !String(input.limits || '').trim()) throw new Error('Production controls, conditions, and limits is required.');
  };
  const panelEnd = (kind, how) => {
    if (kind === 'approve' && c.tier === 'critical') kind = 'recommend';
    needIn(kind, how);
    const tx = howTxt(how), isEsc = kind === 'escalate';
    archiveRound('panel', kind, how, rat || note);
    if (kind === 'approve') { const ov = collectOverrides(); c.panelDecision = Object.assign({ by: actor.id, at: now, decision: 'approve', rationale: rat, overrides: ov, contributors: draftTouched() }, stamp(how)); c.reviewDraft = null; startPilot(String(input.scope).trim(), +input.days); const at = recordAcceptance(c.pilot.scope); log('Panel decision: approved for pilot', rat + at + ovNote(ov) + tx, { to: 'pilot', due: c.pilot.reviewDueAt, tag: 'approve' }); approvalNotice('approved for pilot by the panel', rat, ov); }
    else if (kind === 'waive') { const ov = collectOverrides(); c.panelDecision = Object.assign({ by: actor.id, at: now, decision: 'approve-waive', rationale: rat, overrides: ov, contributors: draftTouched() }, stamp(how)); c.reviewDraft = null; c.pilot = { waived: true, waiverReason: String(input.waiver).trim() }; const at = recordAcceptance('Production'); toProduction('Pilot waived'); log('Panel decision: approved, pilot waived', rat + ' Waiver: ' + c.pilot.waiverReason + at + ovNote(ov) + tx, { to: 'production', due: c.production.nextReviewAt, tag: 'waive' }); approvalNotice('approved by the panel with the pilot waived', rat, ov); }
    else if (kind === 'recommend' || isEsc) {
      const ovr = isEsc ? [] : collectOverrides(), rat2 = isEsc ? (note || rat) : rat;
      c.panelDecision = Object.assign({ by: actor.id, at: now, decision: isEsc ? 'escalate' : 'recommend', rationale: rat2, overrides: ovr, contributors: draftTouched() }, stamp(how)); c.recommendedPilot = isEsc ? null : { scope: String(input.scope).trim(), days: +input.days };
      const sc = c.scoring, v = +c.form.valueUSD || 0, cost = +c.form.costUSD || 0;
      const svb = supportView(c, R), rb = threeYearRoi(c.form), bf = budgetFlag(c.form, R);
      const bdata = { title: c.title, id: c.id, solution: c.form.solution || 'Not provided', tier: c.tier, inherent: sc.inherent, supportedN: svb.rows.filter(r => r.status === 'confirmed' || r.status === 'evidence').length, claimedN: svb.rows.length, net: svb.net, netTier: svb.netTier, valueUSD: v, costUSD: cost, ongoingUSD: +c.form.ongoingCostUSD || 0, ongoingBasis: ONGOING_BASIS[c.form.ongoingBasis] || '', budgetSource: c.form.budgetSource || 'an unnamed budget', budgetNote: bf ? 'Budget scrutiny applies: per-user cost is above $' + bf.limit + ' a month.' : '', roiNet: rb.net, roiPct: rb.roi, roiReason: rb.reason || '', minTier: sc.overrides.filter(o => o.raised).map(o => o.label), experts: c.consults.filter(k => k.kind === 'sme').map(k => ({ title: byId(k.personId).title, name: byId(k.personId).name, stance: k.response ? k.response.stance : 'pending', text: k.response ? k.response.text : '' })), stakeholders: c.consults.filter(k => k.kind === 'stakeholder' && k.response).map(k => ({ title: byId(k.personId).title, name: byId(k.personId).name, stance: k.response.stance, text: k.response.text })), panelRec: rat2, escalated: isEsc };
      c.briefing = { at: now, data: bdata, lines: ['Use case: ' + c.title + ' (' + c.id + ')', 'Proposed solution: ' + (c.form.solution || 'Not provided') + '', 'Tier: ' + TIER_LABEL[c.tier] + '. Inherent risk ' + sc.inherent + ', residual ' + sc.residual + ' after ' + (c.form.controls || []).length + ' controls.', 'Value and cost: Estimated annual value $' + v.toLocaleString('en-US') + ' against one-time cost $' + cost.toLocaleString('en-US') + ' and ongoing cost $' + (+c.form.ongoingCostUSD || 0).toLocaleString('en-US') + ' ' + (ONGOING_BASIS[c.form.ongoingBasis] || '') + ', paid from ' + (c.form.budgetSource || 'an unnamed budget') + (budgetFlag(c.form, R) ? '. Budget scrutiny applies: per-user cost is above $' + budgetFlag(c.form, R).limit + ' a month' : '') + '.', 'Minimum tier rules applied: ' + (sc.overrides.filter(o => o.raised).map(o => o.label).join('; ') || 'none') + '.', 'Expert responses: ' + (c.consults.filter(k => k.kind === 'sme').map(k => byId(k.personId).title + ' ' + (k.response ? ({ support: 'no concerns', concerns: 'concerns', serious: 'serious concern' })[k.response.stance] : 'pending')).join('; ') || 'none requested') + '.', (isEsc ? 'Panel escalation: the panel asks the executives to decide. ' + rat2 : 'Panel recommendation: approve for pilot. ' + rat)] };
      log(isEsc ? 'Panel decision: escalated to the executives' : 'Panel decision: recommends approval', rat2 + ovNote(ovr) + howTxt(how), { to: 'exec', due: dueFor('exec', c.tier, now, R), tag: 'recommend' });
      c.readyBy = null; mail(withRole('exec').map(p => p.id), 'Executive decision needed: ' + c.title, 'A briefing pack is attached to the case. Decision due ' + new Date(c.dueAt).toDateString() + '.', 'task'); 
    }
    else if (kind === 'remediate') bounce('panel', rat, 'Panel decision: remediate' + (how === 'deadlock' ? ' (deadlock broken)' : how === 'quorum' ? ' (quorum waived)' : ''), null, tx);
    else close('panel', rat, 'Panel decision: rejected' + (how === 'quorum' ? ' (quorum waived)' : ''), tx);
  };
  const execEnd = (kind, how) => {
    needIn(kind === 'approve' ? 'approve' : kind, how); if (!rat) throw new Error('Write the summary for the submitter.');
    const tx = howTxt(how), voters = voteSummary().filter(v => v.dec !== 'abstain').map(v => v.by);
    archiveRound('exec', kind, how, rat);
    const ov = (kind === 'approve' || kind === 'waive') ? collectOverrides() : [];
    c.execDecision = { by: actor.id, at: now, present: voters, decision: kind === 'waive' ? 'approve-waive' : kind, rationale: rat, overrides: ov, contributors: draftTouched(), how, votes: voteSummary() }; if (kind === 'approve' || kind === 'waive') c.reviewDraft = null;
    if (kind === 'approve') { startPilot(String(input.scope).trim(), +input.days); const at = recordAcceptance(c.pilot.scope); log('Executive decision: approved for pilot', rat + at + ovNote(ov) + tx, { to: 'pilot', due: c.pilot.reviewDueAt, tag: 'approve' }); approvalNotice('approved for pilot by the executives', rat, ov); }
    else if (kind === 'waive') { c.pilot = { waived: true, waiverReason: String(input.waiver).trim() }; const at = recordAcceptance('Production'); toProduction('Pilot waived'); log('Executive decision: approved, pilot waived', rat + ' Waiver: ' + c.pilot.waiverReason + at + ovNote(ov) + tx, { to: 'production', due: c.production.nextReviewAt, tag: 'waive' }); approvalNotice('approved by the executives with the pilot waived', rat, ov); }
    else if (kind === 'remediate') bounce('exec', rat, 'Executive decision: remediate' + (how === 'deadlock' ? ' (deadlock broken)' : ''), null, tx);
    else close('exec', rat, 'Executive decision: rejected', tx);
  };
  switch (id) {
    case 'ask_adviser': {
      const gaps = unclaimedRequired(c.form || {}, R).map(n => n.text);
      const h = { id: 'h' + ((c.helpRequests || []).length + 1), by: actor.id, at: now, message: String(input.message || '').trim(), controls: gaps, status: 'open' };
      c.helpRequests = (c.helpRequests || []).concat([h]);
      const ad = c.adviserId || leadId();
      c.outbox.push({ ts: now, n: c.outbox.length, to: [ad], subject: 'Help requested: ' + c.title, body: actor.name + ' asks for your help with "' + c.title + '".' + (h.message ? ' ' + h.message : '') + (gaps.length ? ' Required controls not yet claimed: ' + gaps.join('; ') + '.' : ''), kind: 'task', auto: true });
      log('Help requested', 'Asked ' + byId(ad).name + (h.message ? '. ' + h.message : '.'), {}); break;
    }
    case 'help_done': { (c.helpRequests || []).forEach(h => { if (h.status === 'open') { h.status = 'done'; h.doneBy = actor.id; h.doneAt = now; } }); log('Help given', note || 'The adviser marked the help request done.', {}); break; }
    case 'set_adviser': {
      if (!byId(input.adviser)) throw new Error('Pick an adviser.');
      c.adviserId = input.adviser; log('Adviser changed', byId(input.adviser).name + ' is now the adoption adviser.', {});
      if (input.adviser !== actor.id) mail(input.adviser, 'You are now the adviser: ' + c.title, actor.name + ' named you the adoption adviser for this case.', 'notice'); break;
    }
    case 'develop':
      c.returned = null; log('Developed into a use case', note, { to: 'use_case', due: null });
      if (actor.id !== c.submitterId) mail(c.submitterId, 'Your suggestion is being developed: ' + c.title, actor.name + ' is helping shape it into a use case. Please complete the details.', 'notice', null, { skipActor: true });
      break;
    case 'save_draft': c.form = Object.assign(c.form, input.form || {}); syncUnit(c); syncOwner(c); c.updatedAt = now; (c.attestations || []).forEach(a => { if ((c.form.attesters || {})[a.controlId] === a.personId) a.evidence = String((c.form.evidence || {})[a.controlId] || '').trim(); }); break;
    case 'submit': case 'signoff_accept': {
      if (input.ipAck) c.ipAcks = (c.ipAcks || []).concat([{ by: actor.id, at: now }]);
      c.form = Object.assign(c.form, input.form || {}); syncUnit(c); syncOwner(c); c.updatedAt = now;
      { const bl = trainingBlocks(ctx.training, actor, R, now); if (bl.length) throw new Error(trainingMsg(bl)); }
      const oid = ownerOf(c), op = byId(oid);
      { const sc0 = selfConfirmed(c, R); if (sc0.length) throw new Error('The submitter and the owner cannot confirm their own use case. Name someone else for: ' + sc0.join(', ') + '.'); } { const db0 = (c.form.controls || []).map(id => dutyBlock(c, (c.form.attesters || {})[id], 'confirm')).filter(Boolean)[0]; if (db0) throw new Error(db0 + ' Name someone else.'); }
      if (id === 'submit' && oid === actor.id) { c.ownerAccepted = { by: actor.id, at: now }; c.signoff = null; c.returned = null; doSubmit(); break; }
      if (id === 'signoff_accept') { c.form.ownerId = actor.id; syncOwner(c); c.ownerAccepted = { by: actor.id, at: now }; const ch = changedFields(c0.form, c.form); c.signoff = Object.assign({}, c.signoff, { status: 'accepted', decidedAt: now }); c.returned = null; log('Owner accepted and submitted', ch.length ? 'The owner edited: ' + ch.join(', ') + '.' : 'No edits.', {}); doSubmit(); break; }
      if (!oid || !OWNER_ROLES.includes(op.role)) throw new Error('Pick the owner who will sign off.');
      if (oid === actor.id) throw new Error('You are the owner, so submit directly.');
      c.returned = null; c.signoff = { status: 'requested', ownerId: oid, requestedBy: actor.id, at: now };
      log('Owner sign-off requested', 'Sent to ' + op.name + '. The draft is locked to the owner until they accept or decline.', {});
      mail(oid, 'Sign-off requested: ' + c.title, actor.name + ' asks you to accept ownership of this use case and submit it for triage. You can edit the draft first. The review clock starts only when it is submitted.', 'task'); break;
    }
    case 'request_confirmations': {
      c.form = Object.assign(c.form, input.form || {}); syncOwner(c); c.updatedAt = now;
      const before = (c.attestations || []).length;
      if (!Object.values(c.form.attesters || {}).some(Boolean)) throw new Error('Name a confirmer on at least one claimed control first.');
      { const sc0 = selfConfirmed(c, R); if (sc0.length) throw new Error('The submitter and the owner cannot confirm their own use case. Name someone else for: ' + sc0.join(', ') + '.'); } { const db0 = (c.form.controls || []).map(id => dutyBlock(c, (c.form.attesters || {})[id], 'confirm')).filter(Boolean)[0]; if (db0) throw new Error(db0 + ' Name someone else.'); }
      buildAtts();
      const names = c.attestations.map(a => byId(a.personId).name).filter((n, i, arr) => arr.indexOf(n) === i);
      log('Confirmation requested', 'Asked ' + names.join(', ') + ' to confirm ' + c.attestations.length + ' control' + (c.attestations.length > 1 ? 's' : '') + ' before submission. They can respond any time before approval.', {}); break;
    }
    case 'add_evidence': {
      const k = R.controls.find(x => x.id === input.controlId); if (!k || !(c.form.controls || []).includes(k.id)) throw new Error('Pick one of the controls claimed on this case.');
      const url = String(input.url || '').trim(), fileId = input.fileId || '';
      if (!url && !fileId) throw new Error('Add a link or a file.');
      if (url && !/^https?:\/\/\S+$/i.test(url)) throw new Error('A link must start with http:// or https://.');
      if (fileId) { if (!(+input.size > 0) || +input.size > EVIDENCE_MAX) throw new Error('A file can be up to ' + Math.round(EVIDENCE_MAX / 1024) + ' KB.'); if (!EVIDENCE_EXT.test(String(input.fileName || ''))) throw new Error('This file type is not accepted. Use one of: ' + EVIDENCE_TYPES + '.'); }
      const it = { id: 'e' + ((c.evidenceItems || []).length + 1), controlId: k.id, kind: fileId ? 'file' : 'link', name: fileId ? String(input.fileName) : url, url: fileId ? '' : url, fileId, size: fileId ? +input.size : 0, type: String(input.type || ''), note: String(input.note || '').trim(), by: actor.id, at: now };
      c.evidenceItems = (c.evidenceItems || []).concat([it]);
      log('Evidence added', k.text + ': ' + (fileId ? 'file ' : 'link ') + it.name + (it.note ? '. ' + it.note : ''), {}); break;
    }
    case 'remove_control': {
      const k = R.controls.find(x => x.id === input.controlId); if (!k || !(c.form.controls || []).includes(k.id)) throw new Error('Pick one of the controls claimed on this case.');
      if (ctlApplies(k, c.form, R)) throw new Error('This control still applies to the answers, so it cannot be removed here.');
      const gone = (c.attestations || []).filter(a => a.controlId === k.id);
      (c.removedControls = c.removedControls || []).push({ controlId: k.id, attestations: gone, evidence: ((c.form.evidence || {})[k.id] || ''), at: now, by: actor.id });
      gone.filter(a => a.status === 'pending').forEach(noLongerNeeded);
      c.form.controls = c.form.controls.filter(x => x !== k.id); delete (c.form.attesters || {})[k.id]; c.attestations = (c.attestations || []).filter(a => a.controlId !== k.id);
      if (c.scoring) { const sc = runScoring(c.form, R, c.attestations); c.scoring = Object.assign({}, c.scoring, { controlCredit: sc.controlCredit, withheld: sc.withheld, inapplicable: sc.inapplicable, residual: sc.residual, residualTier: sc.residualTier }); }
      log('Control removed', k.text + ' no longer applied to the answers' + (gone.some(a => a.status === 'pending') ? '. The confirmer was told their input is no longer needed.' : '.'), {}); break;
    }
    case 'remove_evidence': {
      const it = (c.evidenceItems || []).find(e => e.id === input.evidenceId && !e.removed); if (!it) throw new Error('That evidence is already removed.');
      it.removed = { by: actor.id, at: now };
      log('Evidence removed', ((R.controls.find(x => x.id === it.controlId) || {}).text || it.controlId) + ': ' + it.name, {}); break;
    }
    case 'withdraw_signoff': c.signoff = null; log('Sign-off request withdrawn', note, {}); break;
    case 'signoff_decline': {
      c.signoff = Object.assign({}, c.signoff, { status: 'declined', reason: note, decidedAt: now });
      c.returned = { from: 'owner', reason: note, at: now };
      log('Owner declined sign-off', note, { tag: 'remediate' }); mail(c.submitterId, 'Owner declined sign-off: ' + c.title, note, 'return', null, { skipActor: true }); break;
    }
    case 'vet_approve': { c.vetting = { by: actor.id, at: now, note }; const at = recordAcceptance('Production'); toProduction('Approved at vetting'); log('Vetting: approved to production', note + at, { to: 'production', due: c.production.nextReviewAt, tag: 'approve' }); approvalNotice('approved to production at vetting', note, []); break; }
    case 'vet_to_panel': {
      const nt = String(input.raiseTo || '');
      if (c.tier === 'low' && !note) throw new Error('Say why you are sending a Low case to the panel.');
      if (nt) {
        if (tIdx(nt) <= tIdx(c.tier)) throw new Error('Pick a tier above ' + TIER_LABEL[c.tier] + ', or leave the tier as it is.');
        if (!note) throw new Error('Say why you are raising the tier.');
        const old = c.tier; c.vetting = { by: actor.id, at: now, note, raisedTo: nt, raisedFrom: old }; c.tier = nt;
        log('Vetting: tier raised to ' + TIER_LABEL[nt] + ', sent to panel', TIER_LABEL[old] + ' to ' + TIER_LABEL[nt] + '. ' + note, { to: 'panel', due: dueFor('panel', nt, now, R), tag: 'raise' });
        mail(panelPeople, 'Panel review: ' + c.title + ' (' + TIER_LABEL[nt] + ')', 'The governance lead raised the tier. ' + note, 'task');
      } else {
        c.vetting = { by: actor.id, at: now, note }; log('Vetting: sent to standing panel', note, { to: 'panel', due: dueFor('panel', c.tier, now, R) });
        mail(panelPeople, 'Panel review: ' + c.title + ' (' + TIER_LABEL[c.tier] + ')', 'Panel review is due ' + new Date(c.dueAt).toDateString() + '.' + (note ? ' ' + note : ''), 'task');
      }
      [].concat(input.cancelPending || []).forEach(kid => { const i = c.consults.findIndex(k => k.id === kid && k.status === 'pending'); if (i < 0) return; const k = c.consults[i]; c.consults.splice(i, 1); log('Consult request cancelled', byId(k.personId).name + (k.kind === 'sme' ? ' (' + (k.required !== false ? 'required expert' : 'expert') + ')' : ' (process stakeholder)') + ', asked ' + new Date(k.requestedAt).toDateString() + '.', {}); mail(k.personId, 'No longer needed: ' + c.title, 'You do not need to answer the earlier request on "' + c.title + '" now. The lead cancelled it after the use case was sent back.', 'notice'); });
      reconsult(input.again);
      break;
    }
    case 'vet_remediate': bounce('vetting', note, 'Vetting: remediate'); break;
    case 'consult': {
      const needC = c.legacy ? {} : consultNeeds(c.form, R), forcedAll = new Set(Object.values(needC).filter(n => n.level === 'required').map(n => n.personId)), forced = Object.values(needC).filter(n => n.level === 'required').map(n => n.personId).filter(pid => !c.consults.some(k => k.personId === pid));
      const areaFor = id => (R.consultAreas || []).find(a => a.id === id) || (R.consultAreas || []).find(a => a.personId === id), areaByPid = {}, toPid = id => { const a = areaFor(id); if (a) { areaByPid[a.personId] = a; return a.personId; } return id; };
      Object.values(needC).forEach(n => { const a = (R.consultAreas || []).find(x => x.id === n.id); if (a) areaByPid[a.personId] = a; });
      const smesIn = (input.smes || []).map(toPid).filter(pid => c.consults.some(k => k.personId === pid) || !dutyBlock(c, pid, 'expert')); forced.forEach(pid => { if (!smesIn.includes(pid) && !dutyBlock(c, pid, 'expert')) smesIn.push(pid); });
      (input.smes || []).map(toPid).forEach(pid => { if (!c.consults.some(k => k.personId === pid)) { const b0 = dutyBlock(c, pid, 'expert'); if (b0) throw new Error(b0); } });
      (input.stakeholders || []).forEach(pid => { const b1 = dutyBlock(c, pid, 'stakeholder'); if (b1) throw new Error(b1); });
      const reqSet = new Set((input.reqSmes === undefined ? [] : input.reqSmes.map(toPid)).concat(forced));
      if (!smesIn.length && !(input.stakeholders || []).length && !(input.again || []).length) throw new Error('Pick at least one expert or stakeholder.');
      const due = now + R.deadlines.consult[c.tier] * DAY, names = [], changed = [], qs = [], qFor = pid => { const a = areaByPid[pid], qm = input.questions || {}; return String((a && qm[a.id]) || qm[pid] || input.question || (a && a.question) || '').trim(); };
      smesIn.concat(input.stakeholders || []).forEach(pid => {
        const old = c.consults.find(k => k.personId === pid && k.status === 'pending');
        if (old) { if (old.kind === 'sme' && input.reqSmes !== undefined && !forcedAll.has(pid)) { const want = reqSet.has(pid); if ((old.required !== false) !== want) { old.required = want; changed.push(byId(pid).name + (want ? ': now holds the decision' : ': no longer holds the decision')); } } return; }
        if (c.consults.some(k => k.personId === pid)) return;
        if (!qFor(pid)) throw new Error('Add a question for ' + byId(pid).name + '.');
        const p = byId(pid), kind = p.role === 'sme' ? 'sme' : 'stakeholder';
        c.consults.push({ id: nextKid(), kind, personId: pid, areaId: kind === 'sme' && areaByPid[pid] ? areaByPid[pid].id : null, question: qFor(pid), requestedAt: now, dueAt: kind === 'sme' ? due : null, status: 'pending', reminders: 0, required: kind === 'sme' ? reqSet.has(pid) : false });
        names.push(p.name); qs.push(p.name + ': ' + qFor(pid));
        mail(pid, kind === 'sme' ? 'Consult requested: ' + c.title : 'Your input is welcome: ' + c.title, kind === 'sme' ? 'A response is ' + (reqSet.has(pid) ? 'required' : 'requested') + ' by ' + new Date(due).toDateString() + '.' + (reqSet.has(pid) ? ' The decision waits on it.' : '') + ' ' + qFor(pid) : 'Please share feedback on business value, risks and concerns. No reply will block the decision. ' + qFor(pid), 'consult', kind === 'sme' ? { due: [(reqSet.has(pid) ? 'A response is required by ' : 'A response is requested by ') + new Date(due).toDateString() + '.', reqSet.has(pid) ? 'The decision waits on it.' : 'It does not hold up the decision.'], intro: actor.name + ' (' + roleName(actor) + ') is asking for your expert view on this use case.', notes: [["The governance lead's question", qFor(pid), 'ask']], button: 'Open the case and respond', only: 1 } : { intro: actor.name + ' would like your feedback on this use case. It covers business value, risks and concerns. No reply will block the decision.', notes: [['Context', qFor(pid), 'ask']], button: 'Open the case and respond', only: 1 });
      });
      const reNames = reconsult(input.again);
      if (!names.length && !changed.length && !reNames.length) throw new Error('Everyone selected already has a pending request.');
      if (!names.length && !changed.length) break;
      log(names.length ? 'Consult and notify' : 'Consult: hold changed', (names.length ? qs.join(' | ') : '') + (names.length && changed.length ? ' | ' : '') + changed.join('; '), {}); break;
    }
    case 'respond': {
      const k = c.consults.find(x => x.personId === actor.id && x.status === 'pending'); k.status = 'responded'; k.response = { stance: input.stance, text: String(input.text).trim(), at: now }; k.formSnap = clone(c.form);
      log((k.kind === 'sme' ? 'Expert responded' : 'Stakeholder feedback') + ': ' + ({ support: 'no concerns', concerns: 'concerns', serious: 'serious concern' })[input.stance], k.response.text, {});
      mail(lead.id, 'Response received: ' + c.title, actor.name + ': ' + k.response.text, 'notice'); break;
    }
    case 'remind': { const picked = [].concat(input.whoE || [], input.whoS || [], input.whoC || []); if (!picked.length) throw new Error('Tick at least one person to remind.'); const r = remindCase(c0, ctx, actor, picked); if (!r) throw new Error('Nothing to remind.'); return r; }
    case 'review_draft': { saveDraft(); log('Approval draft saved', 'Saved changes to the shared approval draft without approving.', {}); break; }
    case 'rv_vote': {
      const X = c.stage === 'exec', key = voteKey(c), dec = String(input.decision || ''), crit = c.tier === 'critical';
      const kinds = X ? ['approve', 'waive', 'remediate', 'reject'] : ['approve'].concat(crit ? [] : ['waive']).concat(['remediate', 'reject']).concat(crit ? [] : ['escalate']).concat(['abstain', 'await']);
      if (!kinds.includes(dec)) throw new Error('Choose your decision.');
      const text = String(input.text || '').trim(); if (!text && dec !== 'abstain') throw new Error('Write your review note.');
      if (FIRMABLE.includes(dec) && !['firm', 'leaning'].includes(input.strength)) throw new Error('Say whether this is a firm decision or a leaning.');
      const r0 = revReady(c0, R), wasOk = !!(r0 && r0.ok);
      c[key] = c[key] || clone(revVotes(c));
      saveDraft();
      const firm = FIRMABLE.includes(dec) && input.strength === 'firm';
      if (firm) {
        const bt = X ? [] : revBlockers(c, R).hard; if (bt.length) throw new Error('You cannot hold a firm decision yet. ' + bt.join(' ') + ' Record it as leaning, ask to wait for input, or abstain.');
        if (!input.__seed) { const g = termsGaps(c, R, dec); if (g.length) throw new Error('Complete these before you hold an approval firm: ' + g.join('; ') + '.'); }
      }
      const prev = c[key][actor.id], v = { dec, firm, at: now };
      if (firm) v.snap = termsNow(c, R); else if (prev && prev.snap) v.snap = prev.snap;
      if (prev && prev.lastMailAt) v.lastMailAt = prev.lastMailAt;
      if (dec === 'await') { v.awaitIds = [].concat(input.awaitIds || []); v.awaitReq = revBlockers(c, R).pend.length > 0; }
      c[key][actor.id] = v;
      c.panelNotes = (c.panelNotes || []).filter(n => n.by !== actor.id); if (text) c.panelNotes.push({ by: actor.id, at: now, lean: dec, firm, text });
      log((X ? 'Executive note: ' : 'Panel note: ') + (dec === 'abstain' ? 'abstained' : dec === 'await' ? 'awaiting input' : (firm ? 'firm ' : 'leaning ') + decLabel(dec, c.tier, c.stage).toLowerCase()), text, {});
      const r1 = revReady(c, R); c.readyBy = r1 && r1.ok ? (wasOk && c.readyBy ? c.readyBy : { by: actor.id, at: now, declined: false }) : null;
      break;
    }
    case 'rv_decline': {
      c.readyBy = Object.assign({}, c.readyBy || {}, { by: actor.id, declined: true });
      const ld = withRole('lead')[0]; if (ld && ld.id !== actor.id) mail(ld.id, 'Ready to finalize: ' + c.title, 'The reviewers agree on "' + decLabel((revReady(c, R) || {}).dec, c.tier) + '". ' + actor.name + ' left the finalizing to you.', 'task', { banner: ['ask', 'Ready to finalize', 'The reviewers agree. ' + actor.name + ' left the finalizing to you.'], notes: [['The decision', decLabel((revReady(c, R) || {}).dec, c.tier), 'note']], button: 'Open the case and finalize', only: 1 });
      log('Panel note: ready to finalize', actor.name + ' saved without finalizing.', {}); break;
    }
    case 'panel_approve': panelEnd('approve', 'consensus'); break;
    case 'panel_waive': panelEnd('waive', 'consensus'); break;
    case 'panel_recommend': panelEnd('recommend', 'consensus'); break;
    case 'panel_escalate': panelEnd('escalate', 'consensus'); break;
    case 'panel_remediate': panelEnd('remediate', 'consensus'); break;
    case 'panel_reject': panelEnd('reject', 'consensus'); break;
    case 'panel_break': { const dl = revDeadlock(c0, R, now), outs = dl ? deadlockOptions(c0, dl).map(o => o.v) : []; if (!outs.includes(String(input.outcome || ''))) throw new Error('Choose how to resolve the deadlock.'); panelEnd(input.outcome, 'deadlock'); break; }
    case 'panel_waivequorum': { const wq = revQuorumWaivable(c0, R); if (!wq) throw new Error('The quorum cannot be waived now.'); panelEnd(wq.dec, 'quorum'); break; }
    case 'exec_approve': execEnd('approve', 'consensus'); break;
    case 'exec_waive': execEnd('waive', 'consensus'); break;
    case 'exec_remediate': execEnd('remediate', 'consensus'); break;
    case 'exec_reject': execEnd('reject', 'consensus'); break;
    case 'exec_break': { const dl = revDeadlock(c0, R, now), outs = dl ? deadlockOptions(c0, dl).map(o => o.v) : []; if (!outs.includes(String(input.outcome || ''))) throw new Error('Choose how to resolve the deadlock.'); execEnd(input.outcome, 'deadlock'); break; }
    case 'pilot_promote': { const mt = recordMeas(); toProduction('Promoted after pilot'); log('Pilot review: promoted to production', note + mt, { to: 'production', due: c.production.nextReviewAt, tag: 'approve' }); mail(c.submitterId, 'Promoted to production: ' + c.title, note || 'The pilot met its goals.', 'decision'); break; }
    case 'pilot_rework': { const mt = recordMeas(); c.pilot.reworks = (c.pilot.reworks || 0) + 1; c.pilot.reviewDueAt = now + 14 * DAY; log('Pilot review: rework', note + mt, { due: c.pilot.reviewDueAt, tag: 'rework' }); mail(c.submitterId, 'Pilot needs rework: ' + c.title, note, 'return'); break; }
    case 'pilot_escalate': { const mt = recordMeas(); keepApproval(); c.panelDecision = null; c.panelNotes = []; c.votes = {}; c.xvotes = {}; c.readyBy = null; c.consults = []; log('Pilot review: risk beyond approval, back to panel', note + mt, { to: 'panel', due: dueFor('panel', c.tier, now, R), tag: 'escalate' }); mail(panelPeople, 'Back to panel from pilot: ' + c.title, note, 'task'); break; }
    case 'pilot_reject': { const mt = recordMeas(); close('pilot', note + mt, 'Pilot review: rejected'); break; }
    case 'monitor_ok': { const mt = recordMeas(); const bo = BIAS_OPTS.find(o => o[0] === input.bias); if (!bo) throw new Error('Choose how bias was reviewed.'); c.production.biasReviews = (c.production.biasReviews || []).concat([{ at: now, by: actor.id, level: bo[0] }]); c.production.lastReviewAt = now; c.production.reviews++; c.production.nextReviewAt = now + cadence() * DAY; log('Monitoring review: continue', note + mt + ' Model bias review: ' + bo[1] + '.', { due: c.production.nextReviewAt }); break; }
    case 'monitor_reassess': { const mt = recordMeas(); bounce('monitoring', note + mt, 'Material change: reassess'); break; }
    case 'log_measure': { const mt = recordMeas(); if (!mt) throw new Error('Enter at least one KPI result.'); log('KPI results recorded', mt.trim(), {}); break; }
    case 'renew_acceptance': { const at = recordAcceptance(c.acceptance ? c.acceptance.scope : 'Production'); c.production && (c.production.nextReviewAt = now + cadence() * DAY); log('Approval renewed', (note ? note + ' ' : '') + at.trim(), { due: c.production ? c.production.nextReviewAt : c.dueAt }); break; }
    case 'attest': {
      const mine2 = (c.attestations || []).filter(a => a.personId === actor.id && a.status === 'pending'), before = c.scoring ? c.scoring.residual : null, bits = [];
      mine2.forEach(a => { a.status = input['d_' + a.controlId] === 'confirm' ? 'confirmed' : 'declined'; a.at = now; a.text = String(input.text).trim(); bits.push(((R.controls.find(x => x.id === a.controlId) || {}).text || a.controlId) + ': ' + a.status); });
      let resTxt = '';
      if (c.scoring) { const sc = runScoring(c.form, R, c.attestations); c.scoring = Object.assign({}, c.scoring, { controlCredit: sc.controlCredit, withheld: sc.withheld, inapplicable: sc.inapplicable, residual: sc.residual, residualTier: sc.residualTier }); resTxt = ' Residual ' + before + (before === sc.residual ? ' unchanged.' : ' to ' + sc.residual + '.'); } else resTxt = ' Scoring happens at submission.';
      log('Control attestation', bits.join('; ') + '.' + resTxt + ' ' + c.attestations.length + ' attestation' + (c.attestations.length > 1 ? 's' : '') + ' on this case.', {}); mail(lead.id, 'Control attestation: ' + c.title, actor.name + ' ' + bits.join('; ') + '.', 'notice'); break;
    }
    case 'allow_again': c.closed = Object.assign({}, c.closed, { notPermitted: false }); log('"Not permitted" removed', note, {}); break;
    case 'reopen': c.closed = null; c.returned = null; log('Returned to the suggestion box', note, { to: 'suggestion', due: null }); break;
    default: throw new Error('Unknown action.');
  }
  // Review follow-ups: nobody is emailed twice for the same thing.
  if (c.readyBy && !((revReady(c, R) || {}).ok)) c.readyBy = null;
  if (c0.stage === 'panel' && c.stage === 'panel' && id !== 'rv_vote') {
    if (revBlockers(c0, R).texts.length && !revBlockers(c, R).texts.length) {
      const pv = c.votes || {}; revPool(c).forEach(pid => { if (pv[pid]) pv[pid].lastMailAt = now; });
      mail(revPool(c), 'Nothing is holding the decision on ' + c.id + ' now', 'What held the decision on "' + c.title + '" has cleared. Please look at the case again and record a firm decision.', 'task', { banner: ['ask', 'The decision is unblocked', 'The expert responses or reviewers it was waiting on are in. You can now hold a firm decision.'], button: 'Open the case and decide', only: 1 });
    }
  }
  if ((id === 'respond' || id === 'attest') && c.votes) {
    Object.keys(c.votes).forEach(pid => {
      const v = c.votes[pid]; if (v.dec !== 'await' || !(v.awaitIds || []).length || v.awaitNotified) return;
      const open = v.awaitIds.filter(x => x.startsWith('a:') ? (c.attestations || []).some(a => 'a:' + a.controlId === x && a.status !== 'confirmed' && a.status !== 'declined') : (c.consults || []).some(k => k.id === x && k.status === 'pending'));
      if (!open.length) { v.awaitNotified = true; v.lastMailAt = now; mail([pid], 'The input you waited for is in on ' + c.id, 'Everything you asked to wait for on "' + c.title + '" has come in. Please look at the case again and record your decision.', 'task', { banner: ['ask', 'The input you asked for has arrived', 'Please look again and record your decision.'], button: 'Open the case and decide', only: 1 }); }
    });
  }
  return sealAudit(c, ctx.rv || 1, now);
}

// ---- AI tool catalog (B-06) ----
// A simple dictionary of known AI tools. Production review stays on the use case, which a tool links to.
const TOOL_STATUS = { draft: 'Draft', reported: 'Reported', review: 'Under review', approved: 'Approved', not_approved: 'Not approved', retired: 'Retired' };
const TOOL_SOURCE = { reported: 'Reported by a person', use_case: 'Created from a use case' };
const nextToolId = tools => 'T-' + (Math.max(1000, ...(tools || []).map(t => +String(t.id).slice(2) || 0)) + 1);
const newTool = (id, reporterId, now) => ({ outbox: [], id, status: 'draft', name: '', vendor: '', purpose: '', users: '', accessNote: '', link: '', ownerId: reporterId, reportedBy: reporterId, source: 'reported', useCaseId: null, createdAt: now, reportedAt: null, history: [{ ts: now, actor: reporterId, action: 'Draft started', note: '' }] });
// A reporter's draft is private to them. Everything else is visible to everyone.
const toolVisible = (t, person) => t.status !== 'draft' || t.reportedBy === person.id;
const TOOL_FIELDS = ['name', 'vendor', 'purpose', 'users', 'accessNote', 'link', 'ownerId'];
function toolActions(t, actor) {
  const out = [], A = (id, label, o) => out.push(Object.assign({ id, label, tone: '', fields: [] }, o || {}));
  if (t.status === 'draft') {
    if (t.reportedBy === actor.id) { A('report_tool', 'Report this AI tool', { tone: 'primary', form: true }); A('save_tool', 'Save draft', { form: true }); A('discard_tool', 'Discard draft'); }
    return out;
  }
  const lead = actor.role === 'lead';
  if (lead || actor.id === t.ownerId) A('edit_tool', 'Save changes', { tone: 'primary', form: true });
  if (lead) A('set_tool_status', 'Change status', { fields: [{ name: 'status', label: 'New status', type: 'select', required: true, options: ['reported', 'review', 'approved', 'not_approved', 'retired'].filter(x => x !== t.status).map(x => ({ v: x, l: TOOL_STATUS[x] })) }, { name: 'note', label: 'Note (optional)', type: 'textarea', required: false }] });
  return out;
}
function performTool(t0, id, input, actor, ctx) {
  input = input || {}; const t = clone(t0), now = ctx.now;
  const a = toolActions(t0, actor).find(x => x.id === id);
  if (!a) throw new Error('This action is not available to ' + actor.name + ' right now.');
  (a.fields || []).forEach(f => { if (f.required && !String(input[f.name] || '').trim()) throw new Error(f.label + ' is required.'); });
  const log = (action, note) => t.history.push({ ts: now, actor: actor.id, action, note: note || '' });
  const merge = () => { const f = input.form || {}; TOOL_FIELDS.forEach(k => { if (k in f) t[k] = String(f[k] == null ? '' : f[k]).trim(); }); };
  switch (id) {
    case 'save_tool': merge(); break;
    case 'report_tool': {
      merge();
      if (!t.name) throw new Error('Give the AI tool a name.'); if (!t.purpose) throw new Error('Say what it is used for.'); if (!t.ownerId || byId(t.ownerId).role === 'unknown') throw new Error('Pick an owner.');
      t.status = 'reported'; t.reportedAt = now;
      const tmail = (to, subject, body) => { t.outbox = (t.outbox || []).concat([{ ts: now, n: (t.outbox || []).length, to: [to], subject, body, kind: 'notice', auto: true }]); };
      if (t.ownerId !== actor.id) tmail(t.ownerId, 'AI tool reported with you as owner: ' + t.name, actor.name + ' reported this AI tool and named you as its owner. You can open it and edit its details. Reporting an AI tool carries no consequence.');
      withRole('lead').forEach(l => { if (l.id !== actor.id && l.id !== t.ownerId) tmail(l.id, 'New AI tool reported: ' + t.name, actor.name + ' reported this AI tool (owner: ' + byId(t.ownerId).name + '). It shows as Reported in the AI tool catalog. Reporting carries no consequence.'); });
      log('Reported', 'Reporting an AI tool carries no consequence. Reviews apply going forward.'); break;
    }
    case 'discard_tool': t.discard = true; break;
    case 'edit_tool': { const before = clone(t); merge(); const ch = TOOL_FIELDS.filter(k => before[k] !== t[k]); log('Edited', ch.length ? 'Changed: ' + ch.join(', ') + '.' : 'No changes.'); break; }
    case 'set_tool_status': {
      const old = t.status; t.status = input.status; log('Status changed', TOOL_STATUS[old] + ' to ' + TOOL_STATUS[t.status] + (input.note ? '. ' + String(input.note).trim() : ''));
      // The owner is told. The reporter is deliberately not, so a move to Under review does not alarm them.
      if (t.ownerId && t.ownerId !== actor.id) t.outbox = (t.outbox || []).concat([{ ts: now, n: (t.outbox || []).length, to: [t.ownerId], subject: 'AI tool status changed: ' + t.name, body: 'The governance lead changed the status of this AI tool from ' + TOOL_STATUS[old] + ' to ' + TOOL_STATUS[t.status] + '.' + (input.note ? ' Note: ' + String(input.note).trim() : ''), kind: 'notice', auto: true }]);
      break;
    }
  }
  return t;
}
// When a use case reaches production it gets a catalog entry, once. Returns the updated case and the new tool, or null.
function ensureTool(c0, tools, now, rv) {
  if (c0.stage !== 'production' || c0.toolId) return null;
  const c = clone(c0), id = nextToolId(tools), sol = String(c.form.solution || '').split(/(?<=\.)\s/)[0].slice(0, 220);
  const tool = { outbox: [], id, status: 'approved', name: c.title, vendor: '', purpose: sol, users: c.form.users || '', accessNote: '', link: '', ownerId: ownerOf(c), reportedBy: c.submitterId, source: 'use_case', useCaseId: c.id, createdAt: now, reportedAt: now, history: [{ ts: now, actor: 'system', action: 'Created from ' + c.id, note: 'The use case reached production. Owner and key details were copied once and can now change here without touching the use case.' }] };
  c.toolId = id; c.audit.push({ ts: now, actor: 'system', action: 'AI tool catalog entry created', note: id, from: c.stage, to: c.stage, auto: true, tag: '' });
  return { c: sealAudit(c, rv || 1, now), tool };
}

// ---- Derived facts ----
function isOpen(c) { return c.stage !== 'closed' && c.stage !== 'production'; }
function waitingOn(c, ctx) {
  // people who can act now, for queue building
  return PEOPLE.filter(p => actionsFor(c, p, ctx).some(a => !a.disabled || a.id.startsWith('panel_') || a.id === 'respond'));
}
function csvEscape(v) { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
function toCsv(rows) { return rows.map(r => r.map(csvEscape).join(',')).join('\n'); }

// How ready the data is: how many of the enabled checks are answered Yes, and whether that meets the rules' minimum.
function readyStatus(form, R) {
  const checks = R.readiness.filter(r => r.enabled !== false), count = checks.filter(r => (form.readiness || {})[r.id] === true).length;
  return { count, of: checks.length, need: R.minReady, ok: count >= R.minReady };
}
// Simple three-year return. Needs the ongoing cost as a yearly total: a per-user cost cannot be turned into a total without the number of users.
function threeYearRoi(f) {
  if (f.ongoingBasis === 'per_user_month') return { reason: 'per_user' };
  if (!(+f.valueUSD > 0)) return { reason: 'no_value' };
  if (isBlank(f.costUSD) || isBlank(f.ongoingCostUSD) || isNaN(+f.costUSD) || isNaN(+f.ongoingCostUSD)) return { reason: 'no_cost' };
  const cost = +f.costUSD + 3 * +f.ongoingCostUSD, value = 3 * +f.valueUSD, net = value - cost;
  return { cost, value, net, roi: cost > 0 ? net / cost : null };
}


// ---- Exceptions accepted at approval (dashboard chart) ----
const EXC_KINDS = [['unsupported', 'Control unsupported'], ['declined', 'Control declined'], ['missing', 'Required control not claimed'], ['concern', 'Concern'], ['serious', 'Serious concern'], ['condition', 'Condition to clear']];
function exceptionData(cases, since, R) {
  const rows = {};
  cases.forEach(c => [c.panelDecision, c.execDecision].filter(d => d && d.at >= since && (d.overrides || []).length).forEach(d => (d.overrides || []).forEach(o => {
    const kind = o.kind === 'concern' && o.stance === 'serious' ? 'serious' : o.kind;
    let head = o.head || o.label;
    const mk = /^k:(.+)$/.exec(o.id || ''); if (mk) { const k = (c.consults || []).find(x => x.id === mk[1]); if (k) head = k.kind === 'sme' ? 'Expert - ' + (byId(k.personId).title || 'Expert') : 'Stakeholder'; }
    const m = /^ctl:(.+)$/.exec(o.id || '') || /^req:(.+)$/.exec(o.id || ''); if (m && R) { const k = R.controls.find(x => x.id === m[1]); if (k) head = k.short || k.text; }
    const r = rows[head] = rows[head] || { head, total: 0, kinds: {}, cases: [] };
    r.total++; r.kinds[kind] = (r.kinds[kind] || 0) + 1; if (!r.cases.includes(c.id)) r.cases.push(c.id);
  })));
  return Object.values(rows).sort((a, b) => b.total - a.total);
}

