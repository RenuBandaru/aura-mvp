// The Rules page (demo admin only): edit the governance rules as a draft, check it, and save it as a new
// version. Port of build 27's vRules.
//
// How it works:
// * The draft lives here, in the browser. Nothing changes for anyone until "Save rules".
// * Every time the draft changes, the page asks the API about it (POST /api/rules/inspect): what each
//   item is used by, whether it may be deleted, each rule in words, and which tabs have changes.
// * Adding or editing a question, rule, control, readiness check or consult trigger goes through the
//   pop-up editors in RuleEditors.tsx, which ask the API to check the item (POST /api/rules/item).
// * Plain settings (points, thresholds, days, goals) are typed straight into the draft. The full check
//   runs before saving (POST /api/rules/check) and again on the server when saving, so nothing the
//   checks refuse can be saved, whatever this page does.

import { Fragment, useEffect, useMemo, useState } from 'react';
import { get, post } from '../api';
import { useApp } from '../state';
import type { Dict } from '../types';
import { ALERT, PageHead, TierChip, useLoad } from '../components/bits';
import { EditTarget, RuleItemEditor, Source } from '../components/RuleEditors';
import { fdt } from '../format';

interface RulesData { rules: Dict; version: number; defaults: Dict; labels: Dict; versions: Dict[] }
interface Inspect {
  sources: Source[]; questions: Dict; rules: Dict; controls: Dict; readiness: Dict; units: Dict;
  triggers: string[][]; changes: string[]; dirtyTabs: string[];
}
interface Check { errors: string[]; warnings: string[]; changes: string[]; nextVersion: number }

const TABS: [string, string][] = [
  ['rules', 'Rules'], ['questions', 'Questions'], ['controls', 'Controls'], ['scoring', 'Scoring'], ['whatif', 'What-if'],
  ['units', 'Business units'], ['consults', 'Consult areas'], ['training', 'Training'], ['readiness', 'Data readiness'],
  ['deadlines', 'Deadlines and quorums'], ['dashboard', 'Dashboard'], ['versions', 'Versions'], ['advanced', 'Advanced'],
];

const copy = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

export function RulesPage() {
  const { me, toast, changed, reloadBoot } = useApp();
  const { data, error, reload } = useLoad(() => get<RulesData>('/rules'), [me.id]);
  const [draft, setDraft] = useState<Dict | null>(null);
  const [info, setInfo] = useState<Inspect | null>(null);
  const [tab, setTab] = useState('rules');
  const [edit, setEdit] = useState<EditTarget | null>(null);
  const [valid, setValid] = useState<Check | null>(null); // the check's problems, shown above the tabs (build 27 S.valid)
  const [saveAsk, setSaveAsk] = useState<Check | null>(null); // the save panel (build 27 S.saveAsk)
  const [reason, setReason] = useState('');

  // A fresh copy of the saved rules becomes the draft whenever the saved rules are (re)loaded.
  useEffect(() => { if (data) setDraft(copy(data.rules)); }, [data]);

  // Ask the API about the draft after each change, waiting for typing to pause.
  useEffect(() => {
    if (!draft) return;
    let live = true;
    const t = window.setTimeout(() => {
      post<Inspect>('/rules/inspect', { draft }).then(r => { if (live) setInfo(r); }).catch(e => { if (live) toast(e.message, true); });
    }, 250);
    return () => { live = false; window.clearTimeout(t); };
  }, [draft, toast]);

  if (me.role !== 'admin') return <><PageHead title="Rules" /><div className="callout warn">Only the demo admin can change the rules. Switch "Viewing as" to the demo admin.</div></>;
  if (error) return <div className="callout bad">{error}</div>;
  if (!data || !draft || !info) return <p className="muted">Loading the rules...</p>;

  const L = data.labels;
  // Any change counts, including one made only through the JSON on the Advanced tab (build 27 isDirty).
  const dirty = info.dirtyTabs.length > 0 || JSON.stringify(draft) !== JSON.stringify(data.rules);
  const edited = (d: Dict | ((x: Dict) => Dict)) => { setDraft(x => (typeof d === 'function' ? d(x!) : d)); setValid(null); setSaveAsk(null); };
  const put = (k: string, v: unknown) => edited(d => ({ ...d, [k]: v }));
  const patchAt = (k: string, i: number, patch: Dict) => put(k, draft[k].map((x: Dict, j: number) => (j === i ? { ...x, ...patch } : x)));
  const removeAt = (k: string, i: number) => put(k, draft[k].filter((_: Dict, j: number) => j !== i));
  const move = (k: string, i: number, by: number) => {
    const list = [...draft[k]]; const j = i + by;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    put(k, list);
  };
  const open = (t: EditTarget) => setEdit(t);

  /** Save rules: errors and warnings appear above the tabs; with none, the save panel asks for a reason. Build 27 saverules / saveanyway. */
  const startSave = async (anyway = false) => {
    try {
      const c = await post<Check>('/rules/check', { draft });
      if (c.errors.length || (c.warnings.length && !anyway)) { setValid(c); setSaveAsk(null); return; }
      setValid(null); setSaveAsk(c); setReason(''); setEdit(null);
      window.setTimeout(() => { const el = document.getElementById('rs_reason'); if (el) { el.scrollIntoView({ block: 'center' }); el.focus(); } }, 50);
    } catch (e: any) { toast(e.message, true); }
  };
  const confirmSave = async () => {
    if (!reason.trim()) { toast('Say why the rules are changing. One reason covers the whole save.', true); return; }
    try {
      const r = await post<Dict>('/rules/save', { draft, reason, acceptWarnings: true });
      if (!r.saved) { setValid({ ...(saveAsk as Check), ...r } as Check); setSaveAsk(null); return; }
      setSaveAsk(null); toast('Rules saved as version ' + r.version + '.');
      reload(); reloadBoot(); changed();
    } catch (e: any) { toast(e.message, true); }
  };
  const discard = () => { setDraft(copy(data.rules)); setValid(null); setSaveAsk(null); setEdit(null); };
  const rescore = async () => {
    if (dirty) { toast('Save or discard your draft first, so cases are re-scored under saved rules.', true); return; }
    try {
      const r = await post<{ rescored: number }>('/rules/rescore');
      toast(r.rescored + ' open case' + (r.rescored === 1 ? '' : 's') + ' re-scored.');
      changed();
    } catch (e: any) { toast(e.message, true); }
  };

  const props = { draft, info, L, put, patchAt, removeAt, move, open, edited };
  // How many items each list tab holds, and how many problems the last check found on it, as in build 27.
  const counts: Record<string, number> = { rules: draft.rules.length, questions: draft.questions.length, controls: draft.controls.length, readiness: draft.readiness.length };
  const issues = valid ? valid.errors.concat(valid.warnings) : [], byTab: Record<string, number> = {};
  issues.forEach(m => { const t = tabOfMsg(m); byTab[t] = (byTab[t] || 0) + 1; });
  const tabLabel = (k: string) => (TABS.find(t => t[0] === k) || ['', ''])[1];
  return (
    <>
      <PageHead title="Rules" sub={`Changes stay in a draft until you save them. You are on version ${data.version}.`}>
        {dirty && <span className="chip warn">Unsaved changes</span>}
        <button className="btn primary" onClick={() => startSave()} disabled={!dirty}>Save rules</button>
        <button className="btn" onClick={discard} disabled={!dirty}>Discard changes</button>
        <button className="btn" onClick={rescore}>Re-score open cases</button>
      </PageHead>
      <div className="stack">
        {valid && <div className={'callout ' + (valid.errors.length ? 'bad' : 'warn')}><b>{ALERT} {valid.errors.length ? 'These problems must be fixed before saving' : 'Check these before saving'}</b>
          {[valid.errors, valid.warnings].map((list, n) => list.length ? <ul key={n} className="small" style={{ margin: '4px 0 0', paddingLeft: 18 }}>{list.map((x, i) => <li key={i}>{x} <a href="#" className="small" onClick={e => { e.preventDefault(); setTab(tabOfMsg(x)); }}>Show on the {tabLabel(tabOfMsg(x))} tab</a></li>)}</ul> : null)}
          {!valid.errors.length ? <div className="row" style={{ marginTop: 6 }}><button className="btn primary" onClick={() => startSave(true)}>Save anyway</button><button className="btn ghost" onClick={() => setValid(null)}>Go back and fix</button></div>
            : <div><button className="btn ghost" onClick={() => setValid(null)}>Dismiss</button></div>}</div>}
        {saveAsk && <div className="card"><h2>Save as version {saveAsk.nextVersion}</h2><p className="muted small" style={{ marginBottom: 8 }}>Saving creates a new version of the rules. Every triage, score and decision from now on is stamped with it. One reason covers everything changed in this save.</p>
          <h3>What changed ({saveAsk.changes.length})</h3><ul className="small" style={{ margin: '4px 0 10px', paddingLeft: 18 }}>{saveAsk.changes.length ? saveAsk.changes.slice(0, 40).map((x, i) => <li key={i}>{x}</li>) : <li>No setting changed.</li>}{saveAsk.changes.length > 40 && <li>and {saveAsk.changes.length - 40} more.</li>}</ul>
          <div className="field"><label htmlFor="rs_reason">Why are you changing the rules? (required)</label><textarea id="rs_reason" placeholder="For example: added a guardrail for AI-written firmware." value={reason} onChange={e => setReason(e.target.value)} /></div>
          <div className="row" style={{ marginTop: 10 }}><button className="btn primary" onClick={confirmSave}>Save version {saveAsk.nextVersion}</button><button className="btn ghost" onClick={() => setSaveAsk(null)}>Back to editing</button></div></div>}
        <div className="tabs" role="tablist" aria-label="Rules sections">
          {TABS.map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => { setTab(k); setEdit(null); }}>
              {label}{counts[k] != null && <span className="n">{counts[k]}</span>}{byTab[k] ? <span className="n bad" title="Problems to look at on this tab">{byTab[k]}</span> : null}{info.dirtyTabs.includes(k) && <span className="dot" title="Unsaved changes on this tab" />}
            </button>
          ))}
        </div>

        {tab === 'rules' && <RulesTab {...props} />}
        {tab === 'questions' && <QuestionsTab {...props} />}
        {tab === 'controls' && <ControlsTab {...props} />}
        {tab === 'scoring' && <ScoringTab {...props} />}
        {tab === 'whatif' && <WhatIfTab draft={draft} L={L} />}
        {tab === 'units' && <UnitsTab {...props} />}
        {tab === 'consults' && <ConsultsTab {...props} />}
        {tab === 'training' && <TrainingTab {...props} />}
        {tab === 'readiness' && <ReadinessTab {...props} />}
        {tab === 'deadlines' && <DeadlinesTab {...props} />}
        {tab === 'dashboard' && <GoalsTab {...props} />}
        {tab === 'versions' && <VersionsTab versions={data.versions} live={data.version} onLoad={r => edited(r)} />}
        {tab === 'advanced' && <AdvancedTab draft={draft} defaults={data.defaults} setDraft={edited} />}
      </div>

      {edit && <RuleItemEditor target={edit} draft={draft} info={info} labels={L}
        onApplied={d => { edited(d); setEdit(null); }} onClose={() => setEdit(null)} />}
    </>
  );
}

/** Which tab a check message belongs on. Build 27's tabOfMsg. */
function tabOfMsg(m: string) {
  if (/^(Rule |A rule|Two rules)/.test(m)) return 'rules';
  if (/^(Question |A question|Two questions|The answer type|Answer )/.test(m) || /needs at least two answers|needs at least two options/.test(m)) return 'questions';
  if (/^(Control |Two controls)/.test(m)) return 'controls';
  if (/^(Readiness |Two readiness)/.test(m)) return 'readiness';
  if (/^Tier /.test(m)) return 'scoring';
  if (/^Goal /.test(m)) return 'dashboard';
  if (/production review cycle/.test(m)) return 'deadlines';
  return 'rules';
}

interface TabProps {
  draft: Dict; info: Inspect; L: Dict;
  put: (k: string, v: unknown) => void; patchAt: (k: string, i: number, p: Dict) => void;
  removeAt: (k: string, i: number) => void; move: (k: string, i: number, by: number) => void;
  open: (t: EditTarget) => void; edited: (d: Dict) => void;
}

/** Move up or down, Edit, Enable or Disable, and Delete (red, or greyed with the reason when the item is in use). Build 27's rowActions. */
function RowButtons({ k, i, item, block, p, onEdit }: { k: string; i: number; item: Dict; block?: string; p: TabProps; onEdit: () => void }) {
  const off = item.enabled === false;
  return (<>
    <div className="row" style={{ flexWrap: 'nowrap', gap: 2 }}>
      <button className="btn sm ghost" aria-label="Move up" onClick={() => p.move(k, i, -1)}>&uarr;</button>
      <button className="btn sm ghost" aria-label="Move down" onClick={() => p.move(k, i, 1)}>&darr;</button>
      <button className="btn sm" onClick={onEdit}>Edit</button>
      <button className="btn sm" onClick={() => p.patchAt(k, i, { enabled: off })}>{off ? 'Enable' : 'Disable'}</button>
      {block ? <button className="btn sm" disabled title={block} aria-label={'Cannot delete: ' + block}>Delete</button>
        : <button className="btn sm stop" onClick={() => p.removeAt(k, i)}>Delete</button>}
    </div>
    {block && <div className="muted small" style={{ marginTop: 3 }}>{block}</div>}
  </>);
}

/** Enabled or Disabled. JavaScript statusChip. */
const Status = ({ on }: { on: unknown }) => on === false ? <span className="chip">Disabled</span> : <span className="chip ok">Enabled</span>;
const cases = (n: number) => n + ' case' + (n === 1 ? '' : 's');

function RulesTab(p: TabProps) {
  const { draft, info, L } = p;
  return (<>
    <div className="callout warn"><b>All values here are illustrative.</b><span>They exist so the workflow can run. Replace them with the real rules once they are decided. New rules apply to new submissions and to cases you re-score. Re-scoring does not send anything back; unanswered items are ignored and flagged on the case.</span></div>
    <p className="muted small">A rule says "when these answers are given, do this". Guardrails send a case back at triage and no one in the process can waive them. Conditions let the case through but must be confirmed later. Minimum tier rules set a floor for the tier. Points add to the score.</p>
    {L.kindOrder.map((kind: string) => {
      const rows = draft.rules.map((r: Dict, i: number) => ({ r, i })).filter((x: Dict) => x.r.kind === kind);
      return (
        <div key={kind} className="card">
          <div className="row" style={{ justifyContent: 'space-between' }}><h2>{L.rulePlural[kind]}</h2>
            <button className="btn sm" onClick={() => p.open({ kind: 'rule', isNew: true, item: { kind, label: '', when: [{ src: '', in: [] }], enabled: true } })}>Add {String(L.ruleKinds[kind]).toLowerCase()}</button></div>
          {rows.length ? <div className="tablewrap"><table className="rtab">
            <thead><tr><th>Rule</th><th>When</th><th>Effect</th><th>Status</th><th>Applied</th><th></th></tr></thead>
            <tbody>{rows.map(({ r, i }: Dict) => {
              const ri = info.rules[r.id] || {};
              return <tr key={r.id} className={r.enabled === false ? 'off' : ''}>
                <td><div className="title">{r.label}</div>{r.ref && <div className="muted small mono">{r.ref}</div>}</td>
                <td className="small">{ri.when}{ri.neverApplies && <> <span className="chip warn">{ALERT} Never applies</span></>}</td>
                <td className="small">{ri.effect}</td><td><Status on={r.enabled} /></td><td className="small">{cases(ri.applied || 0)}</td>
                <td><RowButtons k="rules" i={i} item={r} block={ri.deleteBlock} p={p} onEdit={() => p.open({ kind: 'rule', isNew: false, item: r })} /></td></tr>;
            })}</tbody></table></div> : <p className="muted small" style={{ marginTop: 4 }}>None.</p>}
        </div>
      );
    })}
  </>);
}

function QuestionsTab(p: TabProps) {
  const { draft, info } = p;
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between' }}><h2>Risk questions</h2>
        <button className="btn sm" onClick={() => p.open({ kind: 'question', isNew: true, item: { text: '', short: '', type: 'yesno', allowUnknown: true, enabled: true } })}>Add question</button></div>
      <p className="muted small" style={{ margin: '6px 0 8px' }}>Questions only ask for facts. What an answer means (points, a guardrail, a minimum tier) is set in the rules, so one question can feed several rules. A question that has been answered on a case cannot be deleted, only disabled. Disabled questions are not asked and rules that depend on them cannot apply.</p>
      <div className="tablewrap"><table className="rtab">
        <thead><tr><th>Question</th><th>Answers</th><th>Status</th><th>Used by</th><th></th></tr></thead>
        <tbody>{draft.questions.map((q: Dict, i: number) => {
          const qi = info.questions[q.id] || { rules: [], answered: 0 }, nr = qi.rules.length;
          return <tr key={q.id} className={q.enabled === false ? 'off' : ''}>
            <td><div className="title">{q.text}</div><div className="muted small">{q.short || ''}</div></td>
            <td>{q.type === 'yesno' ? 'Yes or no' : q.type === 'single' ? 'Pick one' : 'Pick any'}{q.allowUnknown ? ' + Not known' : ''}
              {q.type !== 'yesno' && <div className="muted small">{(q.options || []).map((o: Dict) => o.label).join(', ')}</div>}</td>
            <td><Status on={q.enabled} /></td>
            <td className="small">{nr} rule{nr === 1 ? '' : 's'}<br />{cases(qi.answered)}</td>
            <td><RowButtons k="questions" i={i} item={q} block={qi.deleteBlock} p={p} onEdit={() => p.open({ kind: 'question', isNew: false, item: q })} /></td></tr>;
        })}</tbody></table></div>
    </div>
  );
}

function ControlsTab(p: TabProps) {
  const { draft, info } = p;
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between' }}><h2>Controls</h2>
        <button className="btn sm" onClick={() => p.open({ kind: 'control', isNew: true, item: { text: '', short: '', credit: 1, attest: 'optional', enabled: true } })}>Add control</button></div>
      <div className="tablewrap" style={{ marginTop: 8 }}><table className="rtab">
        <thead><tr><th>Control</th><th>Credit</th><th>Confirmer</th><th>Status</th><th>Used on</th><th></th></tr></thead>
        <tbody>{draft.controls.map((c: Dict, i: number) => {
          const ci = info.controls[c.id] || {};
          return <tr key={c.id} className={c.enabled === false ? 'off' : ''}>
            <td>{c.text}{ci.applies && <div className="muted small">Applies when: {ci.applies}</div>}</td>
            <td><Num value={c.credit} label={'controls.' + i + '.credit'} onChange={v => p.patchAt('controls', i, { credit: v })} /></td>
            <td>{c.attest === 'required' ? <span className="chip warn">Required</span> : <span className="chip">Optional</span>}</td>
            <td><Status on={c.enabled} /></td><td className="small">{cases(ci.used || 0)}</td>
            <td><RowButtons k="controls" i={i} item={c} block={ci.deleteBlock} p={p} onEdit={() => p.open({ kind: 'control', isNew: false, item: c })} /></td></tr>;
        })}</tbody></table></div>
    </div>
  );
}

/** A number input's value: kept as typed while empty, so the field can be cleared and retyped. */
const num = (v: string) => (v === '' ? '' : Number(v));

/** Build 27's nIn: a small number box inside a sentence or table cell. */
function Num({ value, onChange, label, width, min = 0, max }: { value: any; onChange: (v: any) => void; label: string; width?: number; min?: number; max?: number }) {
  return <input type="number" min={min} max={max} aria-label={label} value={value ?? ''} style={width ? { width } : undefined} onChange={e => onChange(num(e.target.value))} />;
}

function ScoringTab(p: TabProps) {
  const { draft, put } = p;
  const set = (k: string, sub: string, v: unknown) => put(k, { ...draft[k], [sub]: v });
  return (<>
    <div className="card"><h2>Budget scrutiny</h2><div className="row">Flag a use case for extra budget scrutiny when ongoing cost per user per month is above $ <Num label="budget.perUserMonthly" value={draft.budget.perUserMonthly} onChange={v => set('budget', 'perUserMonthly', v)} /> <span className="muted small">A flag only alerts reviewers. It never stops a case or changes its score.</span></div></div>
    <div className="card"><h2>Tier thresholds (inherent score)</h2><div className="row">Low up to <Num label="tiers.lowMax" value={draft.tiers.lowMax} onChange={v => set('tiers', 'lowMax', v)} /> Moderate up to <Num label="tiers.moderateMax" value={draft.tiers.moderateMax} onChange={v => set('tiers', 'moderateMax', v)} /> High up to <Num label="tiers.highMax" value={draft.tiers.highMax} onChange={v => set('tiers', 'highMax', v)} /> Above that is Critical.</div></div>
    <div className="card"><h2>Reach and autonomy points</h2>
      <div className="ptrow"><b>Reach</b>{Object.keys(draft.scopePoints).map(k => <label key={k} className="field"><span className="lab">{k}</span><Num label={'scopePoints.' + k} value={draft.scopePoints[k]} onChange={v => set('scopePoints', k, v)} /></label>)}</div>
      <div className="ptrow"><b>Autonomy</b>{Object.keys(draft.autonomyPoints).map(k => <label key={k} className="field"><span className="lab">{k}</span><Num label={'autonomyPoints.' + k} value={draft.autonomyPoints[k]} onChange={v => set('autonomyPoints', k, v)} /></label>)}</div></div>
  </>);
}

function WhatIfTab({ draft, L }: { draft: Dict; L: Dict }) {
  const { toast } = useApp();
  const [input, setInput] = useState<Dict>({ ucType: '', scope: 'team', autonomy: 'advice', answers: {} });
  const [res, setRes] = useState<Dict | null>(null);
  useEffect(() => {
    let live = true;
    const t = window.setTimeout(() => {
      post<Dict>('/rules/whatif', { draft, input }).then(r => { if (live) setRes(r); }).catch(e => { if (live) toast(e.message, true); });
    }, 200);
    return () => { live = false; window.clearTimeout(t); };
  }, [draft, input, toast]);
  const answer = (qid: string, v: unknown) => setInput(x => { const a = { ...x.answers }; if (v === undefined) delete a[qid]; else a[qid] = v; return { ...x, answers: a }; });
  const sc = res?.scoring;
  return (
    <div className="card sd"><h2>Try it: what happens with these answers? <span className="chip">Uses your draft, saves nothing</span></h2>
      <p className="muted small" style={{ marginBottom: 8 }}>Pick answers for an imaginary use case and see the result under the rules as drafted. Unanswered questions are ignored, as they are in real scoring. Data readiness is assumed met.</p>
      <div className="formgrid">
        <div className="field"><label htmlFor="wi_ucType">Type of AI use case</label><select id="wi_ucType" value={input.ucType} onChange={e => setInput(x => ({ ...x, ucType: e.target.value }))}>
          <option value="">Not chosen</option>{(draft.ucTypes || []).map((t: Dict) => <option key={t.id} value={t.id}>{t.label}</option>)}</select></div>
        <div className="field"><label htmlFor="wi_scope">Reach</label><select id="wi_scope" value={input.scope} onChange={e => setInput(x => ({ ...x, scope: e.target.value }))}>
          {L.scopeOpts.map((o: Dict) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></div>
        <div className="field"><label htmlFor="wi_autonomy">Autonomy</label><select id="wi_autonomy" value={input.autonomy} onChange={e => setInput(x => ({ ...x, autonomy: e.target.value }))}>
          {L.autonomyOpts.map((o: Dict) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></div>
      </div>
      <div style={{ marginTop: 8 }}>{(res?.questions || []).map((q: Dict) => {
        const cur = input.answers[q.id];
        if (q.type === 'single') return <div key={q.id} className="qa block"><span>{q.text}</span><span className="yn"><select name={'wi_' + q.id} aria-label={q.short || q.text} value={cur || ''} onChange={e => answer(q.id, e.target.value || undefined)}>
          <option value="">Not chosen</option>{q.options.map((o: Dict) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></span></div>;
        const tok = q.type === 'yesno' ? (cur === true ? 'yes' : cur === false ? 'no' : cur) : cur;
        return <div key={q.id} className="qa block"><span>{q.text}</span><span className="yn">{q.options.map((o: Dict) => q.type === 'multi'
          ? <label key={o.id}><input type="checkbox" name={'wi_' + q.id} checked={Array.isArray(cur) && cur.includes(o.id)} onChange={e => { const l = (Array.isArray(cur) ? cur : []).filter((x: string) => x !== o.id); answer(q.id, e.target.checked ? [...l, o.id] : l.length ? l : undefined); }} /> {o.label}</label>
          : <label key={o.id}><input type="radio" name={'wi_' + q.id} checked={tok === o.id} onChange={() => answer(q.id, q.type === 'yesno' ? (o.id === 'yes' ? true : o.id === 'no' ? false : o.id) : o.id)} /> {o.label}</label>)}
          <button className="btn sm ghost" onClick={() => answer(q.id, undefined)}>Clear</button></span></div>;
      })}</div>
      {sc && <>
        <div className={'callout ' + (res!.stops.length ? 'bad' : 'ok')} style={{ marginTop: 12 }}><b>{res!.stops.length ? 'Guardrail applies' : 'No guardrail applies'}</b>
          {res!.stops.length ? <span>{res!.stops.map((x: Dict) => x.text).join('; ')}. The case would go back to the submitter.</span> : <span>No guardrail applies to these answers.</span>}</div>
        {res!.needs.length > 0 && <div className="callout" style={{ marginTop: 12 }}><b>Controls the submitter would see</b><span>{res!.needs.map((n: Dict, i: number) => <span key={i}>{i > 0 && <br />}{(n.level === 'required' ? 'Required: ' : 'Recommended: ') + n.text}</span>)}</span></div>}
        <div className="score" style={{ marginTop: 12 }}><div><div className="muted small">Tier</div><TierChip tier={sc.tier} label={L.tierLabels[sc.tier]} /></div><div><div className="muted small">Inherent risk</div><div className="big">{sc.inherent}</div></div></div>
        <div className="contrib">{sc.explain.length ? sc.explain.map((x: Dict, i: number) => <div key={i}><span>{x.label}</span><b className="num">+{x.points}</b></div>) : <div><span className="muted">No risk points.</span></div>}</div>
        <p className="small">{sc.overrides.length ? 'Minimum tier rules that apply: ' + sc.overrides.map((o: Dict) => o.label + (o.raised ? ' (raises the tier to ' + L.tierLabels[o.minTier] + ')' : ' (no change)')).join('; ') + '.' : 'No minimum tier rules apply.'}{' '}
          {(sc.conditions || []).length > 0 && <><br />Conditions to clear: {sc.conditions.map((c: Dict) => c.text).join('; ')}.</>}</p>
        {res!.gaps.length > 0 && <p className="small muted" style={{ marginTop: 6 }}>Not answered, so ignored: {res!.gaps.map((q: Dict) => q.short || q.text).join('; ')}.</p>}
      </>}
    </div>
  );
}

function UnitsTab(p: TabProps) {
  const { draft, info, L } = p;
  const lead = L.advisers.find((a: Dict) => a.lead)?.id || '';
  return (
    <div className="card"><div className="row" style={{ justifyContent: 'space-between' }}><h2>Business units and advisers</h2>
      <button className="btn sm" onClick={() => p.put('units', [...draft.units, { id: 'u_' + Date.now().toString(36), label: 'New business unit', adviserId: lead }])}>Add business unit</button></div>
      <p className="muted small" style={{ margin: '6px 0 8px' }}>Every user belongs to one business unit, and every unit has an adoption adviser. A new unit starts with the governance lead. New ideas alert the adviser of the unit chosen on the suggestion.</p>
      <div className="tablewrap"><table className="rtab">
        <thead><tr><th>Business unit</th><th>Adoption adviser</th><th>People</th><th></th></tr></thead>
        <tbody>{draft.units.map((u: Dict, i: number) => {
          const n = info.units[u.id]?.people ?? 0, c = info.units[u.id]?.cases ?? 0;
          return <tr key={u.id}>
            <td><input type="text" aria-label="Business unit name" value={u.label} onChange={e => p.patchAt('units', i, { label: e.target.value })} /></td>
            <td><select aria-label={'Adviser for ' + u.label} value={u.adviserId} onChange={e => p.patchAt('units', i, { adviserId: e.target.value })}>
              {L.advisers.map((a: Dict) => <option key={a.id} value={a.id}>{a.name}{a.lead ? ' (governance lead)' : ''}</option>)}</select></td>
            <td className="small">{n} {n === 1 ? 'person' : 'people'}, {cases(c)}</td>
            <td>{n || c ? <span className="muted small">In use</span> : <button className="btn sm stop" onClick={() => p.removeAt('units', i)}>Remove</button>}</td></tr>;
        })}</tbody></table></div>
    </div>
  );
}

function ConsultsTab(p: TabProps) {
  const { draft, info, L } = p;
  const areas: Dict[] = draft.consultAreas || [];
  const setArea = (ai: number, patch: Dict) => p.put('consultAreas', areas.map((a, j) => (j === ai ? { ...a, ...patch } : a)));
  return (
    <div className="card"><h2>Consult areas</h2>
      <p className="muted small" style={{ margin: '6px 0 8px' }}>Each area names who is asked and when the consult is suggested or required. A row matches when all its conditions hold, and an area takes the strongest row that matches. In production the expert can be a shared mailbox or group from the identity system. The lead can always add other experts and mark any consult as required.</p>
      <div className="stack">{areas.map((a, ai) => (
        <div key={a.id || ai} className="tcard">
          <div className="formgrid">
            <div className="field"><label htmlFor={'ca_l_' + ai}>Area</label><input id={'ca_l_' + ai} type="text" value={a.label} onChange={e => setArea(ai, { label: e.target.value })} /></div>
            <div className="field"><label htmlFor={'ca_p_' + ai}>Expert asked</label><select id={'ca_p_' + ai} value={a.personId} onChange={e => setArea(ai, { personId: e.target.value })}>
              {L.experts.map((x: Dict) => <option key={x.id} value={x.id}>{x.name}, {x.title}</option>)}</select></div>
            <div className="field wide"><label htmlFor={'ca_q_' + ai}>Default question</label><textarea id={'ca_q_' + ai} value={a.question || ''} onChange={e => setArea(ai, { question: e.target.value })} /></div>
          </div>
          <div className="row" style={{ gap: 40 }}>
            <label className="checks"><span style={{ display: 'flex', gap: 8 }}><input type="checkbox" checked={a.enabled !== false} onChange={e => setArea(ai, { enabled: e.target.checked })} /> Enabled</span></label>
            <label className="checks"><span style={{ display: 'flex', gap: 8 }}><input type="checkbox" checked={!!a.baseline} onChange={e => setArea(ai, { baseline: e.target.checked })} /> Suggest for every use case</span></label>
          </div>
          <div className="tablewrap" style={{ marginTop: 6 }}><table className="rtab">
            <thead><tr><th>Trigger</th><th>Effect</th><th>When</th><th></th></tr></thead>
            <tbody>{(a.triggers || []).length ? (a.triggers || []).map((t: Dict, ti: number) => (
              <tr key={ti}><td>{t.label}</td><td>{t.level === 'required' ? <span className="chip warn">Required</span> : <span className="chip">Recommended</span>}</td>
                <td className="small">{info.triggers[ai]?.[ti]}</td>
                <td><button className="btn sm" onClick={() => p.open({ kind: 'trigger', isNew: false, area: ai, index: ti, item: t })}>Edit</button>{' '}
                  <button className="btn sm stop" onClick={() => setArea(ai, { triggers: a.triggers.filter((_: Dict, j: number) => j !== ti) })}>Remove</button></td></tr>
            )) : <tr><td colSpan={4} className="muted small">No triggers. The lead adds this consult by hand.</td></tr>}</tbody>
          </table></div>
          <div className="row" style={{ marginTop: 6 }}><button className="btn sm" onClick={() => p.open({ kind: 'trigger', isNew: true, area: ai, item: { label: '', level: 'recommended', when: [{ src: '', in: [] }] } })}>Add trigger</button></div>
        </div>
      ))}</div>
    </div>
  );
}

function TrainingTab(p: TabProps) {
  const { draft } = p;
  const list: Dict[] = draft.trainings || [];
  const add = () => p.put('trainings', [...list, { id: 't_' + Date.now().toString(36), title: 'New training', link: '', summary: '', refreshMonths: 12, version: '1', requiredToSubmit: false, contact: '', appliesTo: 'all' }]);
  return (
    <div className="card"><div className="row" style={{ justifyContent: 'space-between' }}><h2>Trainings</h2><button className="btn sm" onClick={add}>Add training</button></div>
      <p className="muted small" style={{ margin: '6px 0 8px' }}>Completion is recorded in AURA. The submit gate is off for a new training. When it is on, anyone who is not current on that training cannot submit a use case and sees the contact below.</p>
      <div className="stack">{list.map((t: Dict, i: number) => {
        const set = (patch: Dict) => p.patchAt('trainings', i, patch);
        const T = (k: string, label: string, wide = false) => <div className={'field' + (wide ? ' wide' : '')}><label htmlFor={'tr_' + k + '_' + i}>{label}</label>
          <input id={'tr_' + k + '_' + i} type="text" value={t[k] || ''} onChange={e => set({ [k]: e.target.value })} /></div>;
        return (
          <div key={t.id} className="tcard">
            <div className="formgrid">{T('title', 'Title', true)}{T('summary', 'What it covers', true)}{T('link', 'Link to the material', true)}{T('contact', 'Contact if someone is blocked (email)')}{T('version', 'Version')}
              <div className="field"><label htmlFor={'tr_m_' + i}>Refresh every (months)</label><input id={'tr_m_' + i} type="number" min={0} value={t.refreshMonths ?? 12} onChange={e => set({ refreshMonths: num(e.target.value) })} /></div></div>
            <label className="checks"><span style={{ display: 'flex', gap: 8 }}><input type="checkbox" checked={!!t.requiredToSubmit} onChange={e => set({ requiredToSubmit: e.target.checked })} /> Required before a use case can be submitted</span></label>
            <div className="row" style={{ marginTop: 6 }}><button className="btn sm stop" onClick={() => p.removeAt('trainings', i)}>Remove training</button></div>
          </div>
        );
      })}</div>
    </div>
  );
}

function ReadinessTab(p: TabProps) {
  const { draft, info } = p;
  const enabled = draft.readiness.filter((r: Dict) => r.enabled !== false).length;
  return (
    <div className="card"><div className="row" style={{ justifyContent: 'space-between' }}><h2>Data readiness</h2>
      <button className="btn sm" onClick={() => p.open({ kind: 'readiness', isNew: true, item: { text: '', enabled: true } })}>Add check</button></div>
      <div className="tablewrap" style={{ marginTop: 8 }}><table className="rtab">
        <thead><tr><th>Check</th><th>Status</th><th>Answered on</th><th></th></tr></thead>
        <tbody>{draft.readiness.map((r: Dict, i: number) => (
          <tr key={r.id} className={r.enabled === false ? 'off' : ''}>
            <td>{r.text}</td><td><Status on={r.enabled} /></td><td className="small">{cases(info.readiness[r.id]?.used || 0)}</td>
            <td><RowButtons k="readiness" i={i} item={r} block={info.readiness[r.id]?.deleteBlock} p={p} onEdit={() => p.open({ kind: 'readiness', isNew: false, item: r })} /></td></tr>
        ))}</tbody></table></div>
      <div className="row" style={{ marginTop: 10 }}>Checks needed to be feasible: <Num label="minReady" value={draft.minReady} onChange={v => p.put('minReady', v)} /> <span className="muted small">of {enabled} enabled</span></div>
    </div>
  );
}

function DeadlinesTab(p: TabProps) {
  const { draft, L, put } = p;
  const tiers: string[] = L.tiers;
  const rows: [string, string][] = [['deadlines.vetting', 'Vetting'], ['deadlines.panel', 'Panel review'], ['deadlines.consult', 'Expert response'], ['deadlines.exec', 'Executive decision'],
    ['pilotDays', 'Default pilot length'], ['reviewCadenceDays', 'Default production review cycle'], ['reviewMaxDays', 'Max production review cycle']];
  const get_ = (path: string) => path.split('.').reduce((a: Dict, x) => a[x], draft);
  const setPath = (path: string, t: string, v: unknown) => {
    const [k, sub] = path.split('.');
    put(k, sub ? { ...draft[k], [sub]: { ...draft[k][sub], [t]: v } } : { ...draft[k], [t]: v });
  };
  return (<>
    <div className="card"><h2>Deadlines by tier (days)</h2><div className="tablewrap"><table className="rtab">
      <thead><tr><th>Step</th>{tiers.map(t => <th key={t}>{L.tierLabels[t]}</th>)}</tr></thead>
      <tbody>{rows.map(([k, l]) => <tr key={k}><td>{l}</td>{tiers.map(t => <td key={t}><Num label={k + '.' + t} value={get_(k)[t]} onChange={v => setPath(k, t, v)} /></td>)}</tr>)}</tbody>
    </table></div></div>
    <div className="card"><h2>Review quorums</h2><div className="stack" style={{ gap: 12 }}>
      <div className="row">Panel reviewers who must hold the same firm decision. The lead is one of the panel's reviewers but need not be among them; the lead can still break a deadlock or waive the quorum without voting: {tiers.slice(1).map(t => <Fragment key={t}>{' ' + L.tierLabels[t]}{t === 'moderate' ? ' and Low' : ''} <Num label={'quorum.' + t} value={draft.quorum[t]} onChange={v => put('quorum', { ...draft.quorum, [t]: v })} /></Fragment>)}</div>
      <div className="row">Executives who must hold the same firm decision for the executives to decide: <Num label="execQuorum" value={draft.execQuorum} onChange={v => put('execQuorum', v)} /></div>
    </div></div>
  </>);
}

function GoalsTab(p: TabProps) {
  const { draft, L, put } = p;
  const set = (id: string, patch: Dict) => put('goals', { ...draft.goals, [id]: { ...(draft.goals || {})[id], ...patch } });
  return (
    <div className="card"><h2>Dashboard goals</h2>
      <p className="muted small" style={{ marginBottom: 8 }}>A goal appears next to the matching figure on the dashboard, green when the figure is equal to or better than the goal and red when it is not. A goal that is switched on needs a value in its range.</p>
      <div className="tablewrap"><table className="rtab">
        <thead><tr><th>On</th><th>Goal</th><th>Value</th><th>Meets the goal when</th></tr></thead>
        <tbody>{L.goalDefs.map((d: Dict) => {
          const g = (draft.goals || {})[d.id] || { on: false, value: '' };
          return <tr key={d.id}>
            <td><input type="checkbox" aria-label={'Use the goal ' + d.label} checked={!!g.on} onChange={e => set(d.id, { on: e.target.checked })} /></td>
            <td>{d.label}</td>
            <td><input type="number" min={d.min} max={d.max} aria-label={d.label + ' goal value'} style={{ width: 130 }} disabled={!g.on} value={g.value ?? ''} onChange={e => set(d.id, { value: num(e.target.value) })} /> <span className="muted small">{d.min.toLocaleString('en-US')} to {d.max.toLocaleString('en-US')}</span></td>
            <td className="small">{d.better === 'lower' ? 'the figure is at or below the goal' : 'the figure is at or above the goal'}</td></tr>;
        })}</tbody></table></div>
    </div>
  );
}

function VersionsTab({ versions, live, onLoad }: { versions: Dict[]; live: number; onLoad: (r: Dict) => void }) {
  const { toast } = useApp();
  const load = async (n: number) => {
    try { onLoad((await get<{ rules: Dict }>('/rules/versions/' + n)).rules); toast('Version ' + n + ' loaded into the draft. Save to make it a new version.'); }
    catch (e: any) { toast(e.message, true); }
  };
  return (
    <div className="card"><h2>Versions of the rules</h2>
      <p className="muted small" style={{ marginBottom: 8 }}>A new version is created each time you save. Cases show which version scored them. Loading an old version puts it in the draft; saving it makes a new version, so history is never rewritten.</p>
      <div className="tablewrap"><table className="rtab">
        <thead><tr><th>Version</th><th>Saved</th><th>Reason and changes</th><th>Cases scored under it</th><th></th></tr></thead>
        <tbody>{[...versions].sort((a, b) => b.n - a.n).map(v => (
          <tr key={v.n}>
            <td><b>v{v.n}</b> {v.n === live && <span className="chip ok">Current</span>}</td>
            <td className="small">{fdt(v.at)}<br />{v.byName}</td>
            <td>{v.reason}<details className="chg"><summary className="small">What changed ({(v.summary || []).length})</summary><ul className="small">{(v.summary || []).slice(0, 60).map((y: string, i: number) => <li key={i}>{y}</li>)}</ul></details></td>
            <td className="small">{v.casesScored}</td>
            <td><button className="btn sm" onClick={() => load(v.n)}>Load into draft</button></td>
          </tr>
        ))}</tbody></table></div>
    </div>
  );
}

function AdvancedTab({ draft, defaults, setDraft }: { draft: Dict; defaults: Dict; setDraft: (d: Dict) => void }) {
  const { toast } = useApp();
  const shown = useMemo(() => JSON.stringify(draft, null, 2), [draft]);
  const [text, setText] = useState(shown);
  useEffect(() => { setText(shown); }, [shown]);
  const apply = () => {
    let r: Dict;
    try { r = JSON.parse(text); } catch { toast('That is not valid JSON.', true); return; }
    if (!r.questions || !r.tiers || !r.deadlines) { toast('The rules are missing required sections.', true); return; }
    setDraft(r); toast('Loaded into the draft. Save rules to make it live.');
  };
  return (
    <div className="card"><h2>Advanced: all rules as JSON</h2>
      <p className="muted small" style={{ marginBottom: 8 }}>Shows the draft. Edit anything, then load it back into the draft. It is checked when you save.</p>
      <textarea className="json" id="rjson" spellCheck={false} value={text} onChange={e => setText(e.target.value)} />
      <div className="row" style={{ marginTop: 8 }}><button className="btn" onClick={apply}>Load into draft</button>
        <button className="btn ghost" onClick={() => { setDraft(copy(defaults)); toast('Default rules loaded into the draft. Save rules to make them live.'); }}>Start from the default rules</button></div>
    </div>
  );
}
