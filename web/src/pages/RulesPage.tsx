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

import { useEffect, useMemo, useState } from 'react';
import { get, post } from '../api';
import { useApp } from '../state';
import type { Dict } from '../types';
import { PageHead, useLoad } from '../components/bits';
import { EditTarget, RuleItemEditor, Source } from '../components/RuleEditors';
import { fdatetime } from '../format';

interface RulesData { rules: Dict; version: number; defaults: Dict; labels: Dict; versions: Dict[] }
interface Inspect {
  sources: Source[]; questions: Dict; rules: Dict; controls: Dict; readiness: Dict; units: Dict;
  triggers: string[][]; changes: string[]; dirtyTabs: string[];
}
interface Check { errors: string[]; warnings: string[]; changes: string[]; nextVersion: number }

const TABS: [string, string][] = [
  ['rules', 'Rules'], ['questions', 'Questions'], ['controls', 'Controls'], ['scoring', 'Scoring'], ['whatif', 'What-if'],
  ['units', 'Business units'], ['consults', 'Consult areas'], ['training', 'Training'], ['readiness', 'Data readiness'],
  ['deadlines', 'Deadlines and quorums'], ['dashboard', 'Dashboard goals'], ['versions', 'Versions'], ['advanced', 'Advanced'],
];
const STAGE_NAMES: Dict = { vetting: 'Vetting', panel: 'Panel review', consult: 'Expert consult', exec: 'Executive review' };

const copy = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

export function RulesPage() {
  const { me, toast, changed, reloadBoot } = useApp();
  const { data, error, reload } = useLoad(() => get<RulesData>('/rules'), [me.id]);
  const [draft, setDraft] = useState<Dict | null>(null);
  const [info, setInfo] = useState<Inspect | null>(null);
  const [tab, setTab] = useState('rules');
  const [edit, setEdit] = useState<EditTarget | null>(null);
  const [saving, setSaving] = useState<Check | null>(null);

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
  const dirty = info.dirtyTabs.length > 0;
  const put = (k: string, v: unknown) => setDraft(d => ({ ...d!, [k]: v }));
  const patchAt = (k: string, i: number, patch: Dict) => put(k, draft[k].map((x: Dict, j: number) => (j === i ? { ...x, ...patch } : x)));
  const removeAt = (k: string, i: number) => put(k, draft[k].filter((_: Dict, j: number) => j !== i));
  const move = (k: string, i: number, by: number) => {
    const list = [...draft[k]]; const j = i + by;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    put(k, list);
  };
  const open = (t: EditTarget) => setEdit(t);

  const startSave = async () => {
    try { setSaving(await post<Check>('/rules/check', { draft })); } catch (e: any) { toast(e.message, true); }
  };
  const discard = () => { setDraft(copy(data.rules)); toast('Draft discarded. The saved rules are unchanged.'); };
  const rescore = async () => {
    try {
      const r = await post<{ rescored: number }>('/rules/rescore');
      toast(r.rescored ? `Re-scored ${r.rescored} open case${r.rescored === 1 ? '' : 's'} under version ${data.version}.` : 'No open case needed re-scoring.');
      changed();
    } catch (e: any) { toast(e.message, true); }
  };
  const afterSave = (n: number) => {
    setSaving(null);
    toast(`Rules saved as version ${n}.`);
    reload(); reloadBoot(); changed();
  };

  const props = { draft, info, L, put, patchAt, removeAt, move, open };
  return (
    <>
      <PageHead title="Rules" sub={`Version ${data.version} is live. Changes stay in this draft until you save them.`}>
        <button className="btn primary" onClick={startSave} disabled={!dirty}>Save rules</button>
        <button className="btn" onClick={discard} disabled={!dirty}>Discard changes</button>
        <button className="btn" onClick={rescore} disabled={dirty} title={dirty ? 'Save or discard the draft first' : undefined}>Re-score open cases</button>
      </PageHead>

      {dirty
        ? <div className="callout warn"><b>Unsaved changes ({info.changes.length})</b>
          <ul className="small">{info.changes.slice(0, 6).map((c, i) => <li key={i}>{c}</li>)}{info.changes.length > 6 && <li>and {info.changes.length - 6} more</li>}</ul></div>
        : <p className="small muted">These settings are demo placeholders, not company policy.</p>}

      <div className="tabs" role="tablist" style={{ marginTop: 12 }}>
        {TABS.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
            {label}{info.dirtyTabs.includes(k) && <span className="dirtydot" title="Unsaved changes"> ●</span>}
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
      {tab === 'versions' && <VersionsTab versions={data.versions} live={data.version} onLoad={r => { setDraft(r); setTab('rules'); }} />}
      {tab === 'advanced' && <AdvancedTab draft={draft} defaults={data.defaults} setDraft={setDraft} />}

      {edit && <RuleItemEditor target={edit} draft={draft} info={info} labels={L}
        onApplied={d => { setDraft(d); setEdit(null); }} onClose={() => setEdit(null)} />}
      {saving && <SaveDialog check={saving} draft={draft} onSaved={afterSave} onClose={() => setSaving(null)} />}
    </>
  );
}

interface TabProps {
  draft: Dict; info: Inspect; L: Dict;
  put: (k: string, v: unknown) => void; patchAt: (k: string, i: number, p: Dict) => void;
  removeAt: (k: string, i: number) => void; move: (k: string, i: number, by: number) => void;
  open: (t: EditTarget) => void;
}

/** Edit, enable or disable, delete (only when the API says it may be), and move up or down. */
function RowButtons({ k, i, item, block, p, onEdit, noMove }: { k: string; i: number; item: Dict; block?: string; p: TabProps; onEdit?: () => void; noMove?: boolean }) {
  const off = item.enabled === false;
  return (
    <div className="row" style={{ flexWrap: 'nowrap', gap: 4 }}>
      {onEdit && <button className="btn" onClick={onEdit}>Edit</button>}
      <button className="btn" onClick={() => p.patchAt(k, i, { enabled: off })}>{off ? 'Enable' : 'Disable'}</button>
      <button className="btn danger" disabled={!!block} title={block || 'Delete'} onClick={() => p.removeAt(k, i)}>Delete</button>
      {!noMove && <><button className="btn ghost" aria-label="Move up" onClick={() => p.move(k, i, -1)}>↑</button>
        <button className="btn ghost" aria-label="Move down" onClick={() => p.move(k, i, 1)}>↓</button></>}
    </div>
  );
}

function RulesTab(p: TabProps) {
  const { draft, info, L } = p;
  return (
    <div className="stack">
      {L.kindOrder.map((kind: string) => {
        const rows = draft.rules.map((r: Dict, i: number) => ({ r, i })).filter((x: Dict) => x.r.kind === kind);
        return (
          <section key={kind} className="card">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h2>{L.rulePlural[kind]} <span className="muted small">({rows.length})</span></h2>
              <button className="btn" onClick={() => p.open({ kind: 'rule', isNew: true, item: { kind, label: '', when: [{ src: '', in: [] }], enabled: true } })}>Add</button>
            </div>
            <div className="tablewrap"><table>
              <thead><tr><th>Rule</th><th>When</th><th>Effect</th><th>Applied</th><th></th></tr></thead>
              <tbody>
                {rows.map(({ r, i }: Dict) => {
                  const ri = info.rules[r.id] || {};
                  return (
                    <tr key={r.id} className={r.enabled === false ? 'off' : undefined}>
                      <td><b>{r.label}</b>{r.ref && <div className="mono muted">{r.ref}</div>}{r.enabled === false && <span className="chip">Disabled</span>}</td>
                      <td className="small">{ri.when}{ri.neverApplies && <div><span className="chip warn">Never applies: no conditions</span></div>}</td>
                      <td className="small">{ri.effect}</td>
                      <td className="small">{ri.applied ? `${ri.applied} case${ri.applied === 1 ? '' : 's'}` : '-'}</td>
                      <td><RowButtons k="rules" i={i} item={r} block={ri.deleteBlock} p={p} onEdit={() => p.open({ kind: 'rule', isNew: false, item: r })} /></td>
                    </tr>
                  );
                })}
                {!rows.length && <tr><td colSpan={5} className="muted">None yet.</td></tr>}
              </tbody>
            </table></div>
          </section>
        );
      })}
    </div>
  );
}

function QuestionsTab(p: TabProps) {
  const { draft, info } = p;
  const types: Dict = { yesno: 'Yes or no', single: 'Pick one', multi: 'Pick any' };
  return (
    <section className="card">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2>Fact questions on the use case form</h2>
        <button className="btn" onClick={() => p.open({ kind: 'question', isNew: true, item: { text: '', short: '', type: 'yesno', allowUnknown: true, enabled: true } })}>Add a question</button>
      </div>
      <div className="tablewrap"><table>
        <thead><tr><th>Question</th><th>Answers</th><th>Used by</th><th></th></tr></thead>
        <tbody>
          {draft.questions.map((q: Dict, i: number) => {
            const qi = info.questions[q.id] || { rules: [], answered: 0 };
            return (
              <tr key={q.id} className={q.enabled === false ? 'off' : undefined}>
                <td><b>{q.text}</b><div className="muted small">{q.short}{q.showWhen?.length ? ' · asked only in some cases' : ''}</div>{q.enabled === false && <span className="chip">Disabled</span>}</td>
                <td className="small">{types[q.type]}{q.allowUnknown ? ', or not known' : ''}</td>
                <td className="small">{qi.rules.length} rule{qi.rules.length === 1 ? '' : 's'}, answered on {qi.answered} case{qi.answered === 1 ? '' : 's'}</td>
                <td><RowButtons k="questions" i={i} item={q} block={qi.deleteBlock} p={p} onEdit={() => p.open({ kind: 'question', isNew: false, item: q })} /></td>
              </tr>
            );
          })}
        </tbody>
      </table></div>
    </section>
  );
}

function ControlsTab(p: TabProps) {
  const { draft, info } = p;
  return (
    <section className="card">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2>Controls (safeguards) and the risk points they take off</h2>
        <button className="btn" onClick={() => p.open({ kind: 'control', isNew: true, item: { text: '', short: '', credit: 1, attest: 'optional', enabled: true } })}>Add a control</button>
      </div>
      <div className="tablewrap"><table>
        <thead><tr><th>Control</th><th>Points off</th><th>Confirmation</th><th>Applies</th><th>Used</th><th></th></tr></thead>
        <tbody>
          {draft.controls.map((c: Dict, i: number) => {
            const ci = info.controls[c.id] || {};
            return (
              <tr key={c.id} className={c.enabled === false ? 'off' : undefined}>
                <td><b>{c.short || c.text}</b><div className="muted small">{c.text}</div>{c.enabled === false && <span className="chip">Disabled</span>}</td>
                <td><input type="number" min={0} className="num" aria-label={'Points off for ' + (c.short || c.text)} value={c.credit}
                  onChange={e => p.patchAt('controls', i, { credit: num(e.target.value) })} /></td>
                <td className="small">{c.attest === 'required' ? 'Required' : 'Optional'}</td>
                <td className="small">{ci.applies || 'Every use case'}</td>
                <td className="small">{ci.used ? `${ci.used} case${ci.used === 1 ? '' : 's'}` : '-'}</td>
                <td><RowButtons k="controls" i={i} item={c} block={ci.deleteBlock} p={p} onEdit={() => p.open({ kind: 'control', isNew: false, item: c })} /></td>
              </tr>
            );
          })}
        </tbody>
      </table></div>
    </section>
  );
}

/** A number input's value: kept as typed while empty, so the field can be cleared and retyped. */
const num = (v: string) => (v === '' ? '' : Number(v));

function NumField({ id, label, value, onChange, help }: { id: string; label: string; value: any; onChange: (v: any) => void; help?: string }) {
  return (
    <div className="field"><label htmlFor={id}>{label}</label>
      <input id={id} type="number" value={value ?? ''} onChange={e => onChange(num(e.target.value))} />
      {help && <span className="muted small">{help}</span>}</div>
  );
}

function ScoringTab(p: TabProps) {
  const { draft, L, put } = p;
  const set = (k: string, sub: string, v: unknown) => put(k, { ...draft[k], [sub]: v });
  return (
    <div className="stack">
      <section className="card"><h2>Risk tiers</h2>
        <p className="small muted">A case's risk points decide its tier. Each number is the highest score in that tier; anything above the High limit is Critical.</p>
        <div className="formgrid">
          <NumField id="t_low" label="Low: up to" value={draft.tiers.lowMax} onChange={v => set('tiers', 'lowMax', v)} />
          <NumField id="t_mod" label="Moderate: up to" value={draft.tiers.moderateMax} onChange={v => set('tiers', 'moderateMax', v)} />
          <NumField id="t_high" label="High: up to" value={draft.tiers.highMax} onChange={v => set('tiers', 'highMax', v)} />
        </div></section>
      <section className="card"><h2>Points for reach and autonomy</h2>
        <div className="formgrid">
          <div>{L.scopeOpts.map((o: Dict) => <NumField key={o.id} id={'sp_' + o.id} label={'Reach: ' + o.label} value={draft.scopePoints[o.id]} onChange={v => set('scopePoints', o.id, v)} />)}</div>
          <div>{L.autonomyOpts.map((o: Dict) => <NumField key={o.id} id={'ap_' + o.id} label={'Autonomy: ' + o.label} value={draft.autonomyPoints[o.id]} onChange={v => set('autonomyPoints', o.id, v)} />)}</div>
        </div></section>
      <section className="card"><h2>Budget</h2>
        <NumField id="b_user" label="Extra scrutiny above this cost per user per month ($)" value={draft.budget.perUserMonthly} onChange={v => set('budget', 'perUserMonthly', v)} />
      </section>
    </div>
  );
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
  const answer = (qid: string, v: unknown) => setInput(x => ({ ...x, answers: { ...x.answers, [qid]: v } }));
  const s = res?.scoring;
  return (
    <div className="whatif">
      <section className="card stack" style={{ gap: 8 }}>
        <h2>Try some answers</h2>
        <p className="small muted">Scores imaginary answers under this draft. Nothing is saved, and every data readiness check counts as met.</p>
        <div className="field"><label htmlFor="wi_type">Type of AI use case</label>
          <select id="wi_type" value={input.ucType} onChange={e => setInput(x => ({ ...x, ucType: e.target.value }))}>
            <option value="">Not chosen</option>{(draft.ucTypes || []).map((t: Dict) => <option key={t.id} value={t.id}>{t.label}</option>)}</select></div>
        <div className="formgrid">
          <div className="field"><label htmlFor="wi_scope">Reach</label>
            <select id="wi_scope" value={input.scope} onChange={e => setInput(x => ({ ...x, scope: e.target.value }))}>
              {L.scopeOpts.map((o: Dict) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></div>
          <div className="field"><label htmlFor="wi_auto">Autonomy</label>
            <select id="wi_auto" value={input.autonomy} onChange={e => setInput(x => ({ ...x, autonomy: e.target.value }))}>
              {L.autonomyOpts.map((o: Dict) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></div>
        </div>
        {(res?.questions || []).map((q: Dict) => (
          <div key={q.id} className="field"><span className="lab">{q.text}</span>
            {q.type === 'multi'
              ? <div className="row">{q.options.map((o: Dict) => {
                const cur: string[] = input.answers[q.id] || [];
                return <label key={o.id} className="small"><input type="checkbox" checked={cur.includes(o.id)}
                  onChange={e => answer(q.id, e.target.checked ? [...cur, o.id] : cur.filter(x => x !== o.id))} /> {o.label}</label>;
              })}</div>
              : <select aria-label={q.text} value={input.answers[q.id] || ''} onChange={e => answer(q.id, e.target.value || undefined)}>
                <option value="">Not answered</option>{q.options.map((o: Dict) => <option key={o.id} value={o.id}>{o.label}</option>)}</select>}
          </div>
        ))}
      </section>
      <section className="card stack" style={{ gap: 8, alignSelf: 'start' }}>
        <h2>Result</h2>
        {!s ? <p className="muted">Working it out...</p> : <>
          {res!.stops.length > 0 && <div className="callout bad"><b>Sent back at triage</b>{res!.stops.map((x: Dict) => <span key={x.id}>{x.text}</span>)}</div>}
          <p>Tier <span className={'tier ' + s.tier}>{L.tierLabels[s.tier]}</span>, {s.inherent} risk points
            {s.residual !== s.inherent && <>; {s.residual} after control credit (<span className={'tier ' + s.residualTier}>{L.tierLabels[s.residualTier]}</span>)</>}.</p>
          {s.explain.length > 0 && <ul className="small">{s.explain.map((x: Dict, i: number) => <li key={i}>{x.label}: +{x.points}</li>)}</ul>}
          {s.overrides.filter((o: Dict) => o.raised).map((o: Dict) => <p key={o.id} className="small">Raised to at least {L.tierLabels[o.minTier]}: {o.label}</p>)}
          {res!.needs.length > 0 && <><b className="small">Controls these answers call for</b>
            <ul className="small">{res!.needs.map((n: Dict) => <li key={n.id}>{n.text} <span className={'chip ' + (n.level === 'required' ? 'bad' : '')}>{n.level === 'required' ? 'Required' : 'Recommended'}</span></li>)}</ul></>}
          {res!.gaps.length > 0 && <p className="small muted">{res!.gaps.length} question{res!.gaps.length === 1 ? '' : 's'} not answered yet, so the tier may be understated.</p>}
        </>}
      </section>
    </div>
  );
}

function UnitsTab(p: TabProps) {
  const { draft, info, L } = p;
  return (
    <section className="card"><h2>Business units and their adoption advisers</h2>
      <div className="tablewrap"><table>
        <thead><tr><th>Business unit</th><th>Adoption adviser</th><th>People</th><th>Cases</th></tr></thead>
        <tbody>
          {draft.units.map((u: Dict, i: number) => (
            <tr key={u.id}>
              <td><input type="text" className="wide" aria-label="Business unit name" value={u.label} onChange={e => p.patchAt('units', i, { label: e.target.value })} /></td>
              <td><select aria-label={'Adviser for ' + u.label} value={u.adviserId} onChange={e => p.patchAt('units', i, { adviserId: e.target.value })}>
                {L.advisers.map((a: Dict) => <option key={a.id} value={a.id}>{a.name}{a.lead ? ' (governance lead)' : ''}</option>)}</select></td>
              <td className="small">{info.units[u.id]?.people ?? 0}</td>
              <td className="small">{info.units[u.id]?.cases ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </section>
  );
}

function ConsultsTab(p: TabProps) {
  const { draft, info, L } = p;
  const areas: Dict[] = draft.consultAreas || [];
  const setArea = (ai: number, patch: Dict) => p.put('consultAreas', areas.map((a, j) => (j === ai ? { ...a, ...patch } : a)));
  return (
    <div className="stack">
      {areas.map((a, ai) => (
        <section key={a.id} className={'card' + (a.enabled === false ? ' off' : '')}>
          <div className="formgrid">
            <div className="field"><label htmlFor={'ca_l_' + ai}>Area</label><input id={'ca_l_' + ai} type="text" value={a.label} onChange={e => setArea(ai, { label: e.target.value })} /></div>
            <div className="field"><label htmlFor={'ca_p_' + ai}>Expert</label>
              <select id={'ca_p_' + ai} value={a.personId} onChange={e => setArea(ai, { personId: e.target.value })}>
                {L.experts.map((x: Dict) => <option key={x.id} value={x.id}>{x.name}{x.title ? ', ' + x.title : ''}</option>)}</select></div>
            <div className="field wide"><label htmlFor={'ca_q_' + ai}>What the expert is asked</label>
              <textarea id={'ca_q_' + ai} value={a.question || ''} onChange={e => setArea(ai, { question: e.target.value })} /></div>
          </div>
          <label className="small"><input type="checkbox" checked={a.enabled !== false} onChange={e => setArea(ai, { enabled: e.target.checked })} /> This consult area is in use</label>
          <div className="row" style={{ justifyContent: 'space-between', marginTop: 10 }}>
            <b>When to ask this expert</b>
            <button className="btn" onClick={() => p.open({ kind: 'trigger', isNew: true, area: ai, item: { label: '', level: 'recommended', when: [{ src: '', in: [] }] } })}>Add a trigger</button>
          </div>
          <div className="tablewrap"><table>
            <thead><tr><th>Trigger</th><th>When</th><th>Consult</th><th></th></tr></thead>
            <tbody>
              {(a.triggers || []).map((t: Dict, ti: number) => (
                <tr key={ti}>
                  <td><b>{t.label}</b></td>
                  <td className="small">{info.triggers[ai]?.[ti]}</td>
                  <td className="small">{t.level === 'required' ? 'Required' : 'Recommended'}</td>
                  <td><div className="row" style={{ flexWrap: 'nowrap', gap: 4 }}>
                    <button className="btn" onClick={() => p.open({ kind: 'trigger', isNew: false, area: ai, index: ti, item: t })}>Edit</button>
                    <button className="btn danger" onClick={() => setArea(ai, { triggers: a.triggers.filter((_: Dict, j: number) => j !== ti) })}>Delete</button>
                  </div></td>
                </tr>
              ))}
              {!(a.triggers || []).length && <tr><td colSpan={4} className="muted">No triggers: this expert is only consulted when someone asks.</td></tr>}
            </tbody>
          </table></div>
        </section>
      ))}
    </div>
  );
}

function TrainingTab(p: TabProps) {
  const { draft } = p;
  return (
    <div className="stack">
      {(draft.trainings || []).map((t: Dict, i: number) => {
        const set = (patch: Dict) => p.patchAt('trainings', i, patch);
        return (
          <section key={t.id} className="card">
            <div className="formgrid">
              <div className="field wide"><label htmlFor={'tr_t_' + i}>Course</label><input id={'tr_t_' + i} type="text" value={t.title} onChange={e => set({ title: e.target.value })} /></div>
              <div className="field wide"><label htmlFor={'tr_s_' + i}>Summary</label><textarea id={'tr_s_' + i} value={t.summary || ''} onChange={e => set({ summary: e.target.value })} /></div>
              <div className="field"><label htmlFor={'tr_l_' + i}>Link</label><input id={'tr_l_' + i} type="url" value={t.link || ''} onChange={e => set({ link: e.target.value })} /></div>
              <div className="field"><label htmlFor={'tr_c_' + i}>Contact</label><input id={'tr_c_' + i} type="text" value={t.contact || ''} onChange={e => set({ contact: e.target.value })} /></div>
              <NumField id={'tr_m_' + i} label="Refresh every (months)" value={t.refreshMonths} onChange={v => set({ refreshMonths: v })} />
              <div className="field"><label htmlFor={'tr_v_' + i}>Course version</label><input id={'tr_v_' + i} type="text" value={t.version || ''} onChange={e => set({ version: e.target.value })} /></div>
            </div>
            <label className="small"><input type="checkbox" checked={!!t.requiredToSubmit} onChange={e => set({ requiredToSubmit: e.target.checked })} /> Must be current before a person can submit a use case</label>
          </section>
        );
      })}
    </div>
  );
}

function ReadinessTab(p: TabProps) {
  const { draft, info } = p;
  return (
    <section className="card">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2>Data readiness checks</h2>
        <button className="btn" onClick={() => p.open({ kind: 'readiness', isNew: true, item: { text: '', enabled: true } })}>Add a check</button>
      </div>
      <div style={{ maxWidth: 360 }}><NumField id="minReady" label="Checks that must be met to pass triage" value={draft.minReady} onChange={v => p.put('minReady', v)} /></div>
      <div className="tablewrap"><table>
        <thead><tr><th>Check</th><th>Answered</th><th></th></tr></thead>
        <tbody>
          {draft.readiness.map((r: Dict, i: number) => (
            <tr key={r.id} className={r.enabled === false ? 'off' : undefined}>
              <td>{r.text}{r.enabled === false && <> <span className="chip">Disabled</span></>}</td>
              <td className="small">{info.readiness[r.id]?.used ? `${info.readiness[r.id].used} cases` : '-'}</td>
              <td><RowButtons k="readiness" i={i} item={r} block={info.readiness[r.id]?.deleteBlock} p={p} onEdit={() => p.open({ kind: 'readiness', isNew: false, item: r })} /></td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </section>
  );
}

function DeadlinesTab(p: TabProps) {
  const { draft, L, put } = p;
  const tiers: string[] = L.tiers;
  const setIn = (k: string, a: string, b: string | null, v: unknown) =>
    put(k, b === null ? { ...draft[k], [a]: v } : { ...draft[k], [a]: { ...draft[k][a], [b]: v } });
  const cell = (id: string, value: any, onChange: (v: any) => void, label: string) =>
    <td><input id={id} type="number" min={0} className="num" aria-label={label} value={value ?? ''} onChange={e => onChange(num(e.target.value))} /></td>;
  const perTier = (k: string, label: string) => (
    <tr key={k}><th scope="row">{label}</th>{tiers.map(t => cell(k + '_' + t, draft[k][t], v => setIn(k, t, null, v), label + ', ' + L.tierLabels[t]))}</tr>
  );
  return (
    <div className="stack">
      <section className="card"><h2>Working days allowed at each stage</h2>
        <div className="tablewrap"><table>
          <thead><tr><th>Stage</th>{tiers.map(t => <th key={t}>{L.tierLabels[t]}</th>)}</tr></thead>
          <tbody>{Object.keys(draft.deadlines).map(st => (
            <tr key={st}><th scope="row">{STAGE_NAMES[st] || st}</th>
              {tiers.map(t => cell('dl_' + st + '_' + t, draft.deadlines[st][t], v => setIn('deadlines', st, t, v), (STAGE_NAMES[st] || st) + ', ' + L.tierLabels[t]))}</tr>
          ))}</tbody>
        </table></div></section>
      <section className="card"><h2>Pilot and production review</h2>
        <div className="tablewrap"><table>
          <thead><tr><th>Days</th>{tiers.map(t => <th key={t}>{L.tierLabels[t]}</th>)}</tr></thead>
          <tbody>
            {perTier('pilotDays', 'Pilot length')}
            {perTier('reviewCadenceDays', 'Production review cycle (default)')}
            {perTier('reviewMaxDays', 'Production review cycle (most allowed)')}
          </tbody>
        </table></div></section>
      <section className="card"><h2>Quorums</h2>
        <p className="small muted">How many panel reviewers must agree for each tier, and how many executives must decide.</p>
        <div className="formgrid">
          {Object.keys(draft.quorum).map(t => <NumField key={t} id={'q_' + t} label={'Panel, ' + L.tierLabels[t]} value={draft.quorum[t]} onChange={v => setIn('quorum', t, null, v)} />)}
          <NumField id="execQuorum" label="Executive review" value={draft.execQuorum} onChange={v => put('execQuorum', v)} />
        </div></section>
    </div>
  );
}

function GoalsTab(p: TabProps) {
  const { draft, L, put } = p;
  const set = (id: string, patch: Dict) => put('goals', { ...draft.goals, [id]: { ...draft.goals[id], ...patch } });
  return (
    <section className="card"><h2>Goals shown on the dashboard</h2>
      <div className="tablewrap"><table>
        <thead><tr><th>Goal</th><th>Shown</th><th>Target</th><th>Better when</th></tr></thead>
        <tbody>{L.goalDefs.map((g: Dict) => {
          const cur = draft.goals[g.id] || {};
          return (
            <tr key={g.id}>
              <td>{g.label}</td>
              <td><input type="checkbox" aria-label={'Show ' + g.label} checked={!!cur.on} onChange={e => set(g.id, { on: e.target.checked })} /></td>
              <td><input type="number" className="num" min={g.min} max={g.max} aria-label={'Target for ' + g.label} value={cur.value ?? ''} onChange={e => set(g.id, { value: num(e.target.value) })} /> <span className="small muted">{g.unit}</span></td>
              <td className="small">{g.better}</td>
            </tr>
          );
        })}</tbody>
      </table></div>
    </section>
  );
}

function VersionsTab({ versions, live, onLoad }: { versions: Dict[]; live: number; onLoad: (r: Dict) => void }) {
  const { toast } = useApp();
  const load = async (n: number) => {
    try { onLoad((await get<{ rules: Dict }>('/rules/versions/' + n)).rules); toast(`Version ${n} loaded into the draft. Save to make it live again.`); }
    catch (e: any) { toast(e.message, true); }
  };
  return (
    <section className="card"><h2>Saved versions</h2>
      <div className="tablewrap"><table>
        <thead><tr><th>Version</th><th>Saved</th><th>Why</th><th>What changed</th><th>Cases scored</th><th></th></tr></thead>
        <tbody>{versions.map(v => (
          <tr key={v.n}>
            <td><b>v{v.n}</b>{v.n === live && <> <span className="chip ok">Live</span></>}</td>
            <td className="small">{fdatetime(v.at)}<div className="muted">{v.byName}</div></td>
            <td className="small">{v.reason}</td>
            <td className="small"><ul>{v.summary.slice(0, 4).map((s: string, i: number) => <li key={i}>{s}</li>)}{v.summary.length > 4 && <li>and {v.summary.length - 4} more</li>}</ul></td>
            <td className="small">{v.casesScored}</td>
            <td>{v.n !== live && <button className="btn" onClick={() => load(v.n)}>Load into draft</button>}</td>
          </tr>
        ))}</tbody>
      </table></div>
    </section>
  );
}

function AdvancedTab({ draft, defaults, setDraft }: { draft: Dict; defaults: Dict; setDraft: (d: Dict) => void }) {
  const { toast } = useApp();
  const shown = useMemo(() => JSON.stringify(draft, null, 2), [draft]);
  const [text, setText] = useState(shown);
  const [err, setErr] = useState('');
  useEffect(() => { setText(shown); }, [shown]);
  const apply = () => {
    try { setDraft(JSON.parse(text)); setErr(''); toast('JSON applied to the draft.'); }
    catch (e: any) { setErr('This is not valid JSON: ' + e.message); }
  };
  return (
    <section className="card stack" style={{ gap: 8 }}>
      <h2>The draft as JSON</h2>
      <p className="small muted">For copying rules between environments. The same checks run on save, so rules that do not pass them cannot be saved.</p>
      <textarea aria-label="Rules as JSON" className="mono jsonbox" value={text} onChange={e => setText(e.target.value)} spellCheck={false} />
      <div className="row">
        <button className="btn primary" onClick={apply} disabled={text === shown}>Apply JSON to the draft</button>
        <button className="btn" onClick={() => { setDraft(copy(defaults)); toast('The default rules are now in the draft.'); }}>Start from the default rules</button>
        {err && <span className="err" role="alert" style={{ color: 'var(--bad)' }}>{err}</span>}
      </div>
    </section>
  );
}

/** The last step: the API's check (errors block, warnings need a tick), what changed, and the reason. */
function SaveDialog({ check, draft, onSaved, onClose }: { check: Check; draft: Dict; onSaved: (n: number) => void; onClose: () => void }) {
  const [c, setC] = useState(check);
  const [reason, setReason] = useState('');
  const [accept, setAccept] = useState(false);
  const [err, setErr] = useState('');
  const save = async () => {
    setErr('');
    try {
      const r = await post<Dict>('/rules/save', { draft, reason, acceptWarnings: accept });
      if (r.saved) onSaved(r.version);
      else setC({ ...c, ...r } as Check);   // the server's own check found something; show it
    } catch (e: any) { setErr(e.message); }
  };
  const blocked = c.errors.length > 0;
  return (
    <div className="modalbg" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Save rules">
        <div className="phead"><h2>Save as version {c.nextVersion}</h2><button className="pclose" onClick={onClose} aria-label="Close">&times;</button></div>
        <div className="pbody stack" style={{ gap: 10 }}>
          {blocked && <div className="callout bad"><b>Fix these first</b><ul className="small">{c.errors.map((x, i) => <li key={i}>{x}</li>)}</ul></div>}
          {!blocked && c.warnings.length > 0 && <div className="callout warn"><b>Check these before saving</b>
            <ul className="small">{c.warnings.map((x, i) => <li key={i}>{x}</li>)}</ul>
            <label className="small"><input type="checkbox" checked={accept} onChange={e => setAccept(e.target.checked)} /> I have read these and want to save anyway</label></div>}
          <div><b className="small">What changes</b><ul className="small">{(c.changes.length ? c.changes : ['No setting changed.']).map((x, i) => <li key={i}>{x}</li>)}</ul></div>
          {!blocked && <div className="field"><label htmlFor="save_reason">Why are the rules changing? (one reason covers the whole save)</label>
            <textarea id="save_reason" value={reason} onChange={e => setReason(e.target.value)} /></div>}
        </div>
        <div className="pfoot">
          {!blocked && <button className="btn primary" onClick={save} disabled={!reason.trim() || (c.warnings.length > 0 && !accept)}>Save version {c.nextVersion}</button>}
          <button className="btn ghost" onClick={onClose}>{blocked ? 'Back to the draft' : 'Cancel'}</button>
          {err && <span className="err" role="alert">{err}</span>}
        </div>
      </div>
    </div>
  );
}
