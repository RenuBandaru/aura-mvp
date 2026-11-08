// The pop-up editors on the Rules page: one question, rule, control, readiness check or consult trigger.
//
// Each editor works on a private copy of the item. "Apply to draft" sends that copy to the API
// (POST /api/rules/item), which checks it the way build 27's applyEdit did (a name is given, every
// condition has a source and a ticked answer, a new item gets a unique id) and returns the new draft.
// So the editor never decides whether an item is valid; it only shows the API's answer.

import { useState } from 'react';
import { post } from '../api';
import type { Dict } from '../types';

/** What can be edited, and where it goes. `area` and `index` are only for consult triggers. */
export interface EditTarget { kind: 'question' | 'rule' | 'control' | 'readiness' | 'trigger'; item: Dict; isNew: boolean; area?: number; index?: number }

/** Something a condition can test (a question or a fact about the case) and its answers. From /api/rules/inspect. */
export interface Source { src: string; label: string; group: string; values: { id: string; label: string }[] }

interface Props {
  target: EditTarget; draft: Dict; info: Dict; labels: Dict;
  onApplied: (draft: Dict) => void; onClose: () => void;
}

/** Copy a value deeply, so editing the copy never changes the draft until the API accepts it. */
const copy = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

export function RuleItemEditor({ target, draft, info, labels, onApplied, onClose }: Props) {
  const [item, setItem] = useState<Dict>(() => copy(target.item));
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: unknown) => setItem(x => ({ ...x, [k]: v }));

  const apply = async () => {
    setBusy(true); setErr('');
    try {
      const r = await post<{ draft: Dict }>('/rules/item', { draft, kind: target.kind, item, isNew: target.isNew, area: target.area, index: target.index });
      onApplied(r.draft);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  const k = target.kind;
  const title = (target.isNew ? 'New ' : 'Edit ') + (k === 'rule' ? String(labels.ruleKinds[item.kind]).toLowerCase() + ' rule'
    : k === 'readiness' ? 'data readiness check' : k === 'trigger' ? 'consult trigger' : k);

  return (
    <div className="modalbg" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="modal wide" role="dialog" aria-modal="true" aria-label={title}>
        <div className="phead"><h2>{title}</h2><button className="pclose" onClick={onClose} aria-label="Close">&times;</button></div>
        <div className="pbody">
          {k === 'question' && <QuestionFields q={item} set={set} qi={info.questions?.[item.id]} isNew={target.isNew} sources={info.sources} />}
          {k === 'rule' && <RuleFields r={item} set={set} draft={draft} labels={labels} sources={info.sources} isNew={target.isNew} />}
          {k === 'control' && <ControlFields c={item} set={set} sources={info.sources} />}
          {k === 'readiness' && <div className="field"><label htmlFor="ed_rd">Check</label><input id="ed_rd" type="text" value={item.text || ''} onChange={e => set('text', e.target.value)} /></div>}
          {k === 'trigger' && <TriggerFields t={item} set={set} sources={info.sources} />}
        </div>
        <div className="pfoot">
          <button className="btn primary" onClick={apply} disabled={busy}>Apply to draft</button>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          {err && <span className="err" role="alert">{err}</span>}
          <span className="small muted" style={{ flexBasis: '100%' }}>Applying changes the draft only. Use Save rules at the top to make them live.</span>
        </div>
      </div>
    </div>
  );
}

type Setter = (k: string, v: unknown) => void;

function QuestionFields({ q, set, qi, isNew, sources }: { q: Dict; set: Setter; qi?: Dict; isNew: boolean; sources: Source[] }) {
  const locked = !isNew && qi?.locked;   // the API says whether the answer type may still change
  const options: Dict[] = q.options || [];
  const nextOptId = () => 'opt' + (Math.max(0, ...options.map(o => Number(String(o.id).replace(/\D/g, '')) || 0)) + 1);
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="field"><label htmlFor="ed_q_text">Question wording (neutral, so the submitter has no reason to hide the true answer)</label>
        <textarea id="ed_q_text" value={q.text || ''} onChange={e => set('text', e.target.value)} /></div>
      <div className="formgrid">
        <div className="field"><label htmlFor="ed_q_short">Short label (used in explanations)</label>
          <input id="ed_q_short" type="text" value={q.short || ''} onChange={e => set('short', e.target.value)} /></div>
        <div className="field"><label htmlFor="ed_q_type">Answer type</label>
          <select id="ed_q_type" value={q.type} disabled={locked} onChange={e => set('type', e.target.value)}>
            <option value="yesno">Yes or no</option><option value="single">Pick one</option><option value="multi">Pick any that apply</option>
          </select>
          {locked && <span className="muted small">Locked: this question is used by rules or has been answered.</span>}</div>
      </div>
      {q.type !== 'yesno' && <div className="field"><span className="lab">Answer options</span>
        {options.map((o, i) => {
          const why = qi?.options?.[o.id];   // "Used by a rule" or "Chosen on 3 cases": then it cannot be removed
          return <div key={o.id} className="row" style={{ flexWrap: 'nowrap', marginBottom: 4 }}>
            <input type="text" style={{ flex: 1 }} aria-label={'Answer ' + (i + 1)} value={o.label}
              onChange={e => set('options', options.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
            {why ? <span className="muted small" style={{ whiteSpace: 'nowrap' }}>{why}</span>
              : <button className="btn danger" onClick={() => set('options', options.filter((_, j) => j !== i))}>Remove</button>}
          </div>;
        })}
        <div><button className="btn" onClick={() => set('options', [...options, { id: nextOptId(), label: '' }])}>Add an answer</button></div>
      </div>}
      <label className="checks"><span style={{ display: 'flex', gap: 8 }}><input type="checkbox" checked={!!q.allowUnknown} onChange={e => set('allowUnknown', e.target.checked)} />
        Offer a "Not known" answer (rules can treat it as unsafe)</span></label>
      <div className="field"><span className="lab">Ask this only when (optional; blank means always asked)</span>
        <TermsEditor terms={q.showWhen || []} onChange={v => set('showWhen', v)} sources={sources} /></div>
      {!isNew && qi && <p className="small muted">Used by {qi.rules.length} rule{qi.rules.length === 1 ? '' : 's'}{qi.rules.length ? ': ' + qi.rules.join('; ') : ''}. Answered on {qi.answered} case{qi.answered === 1 ? '' : 's'}.</p>}
    </div>
  );
}

function RuleFields({ r, set, draft, labels, sources, isNew }: { r: Dict; set: Setter; draft: Dict; labels: Dict; sources: Source[]; isNew: boolean }) {
  const k = r.kind;
  const help: Dict = { guardrail: 'sends the case back at triage; no one can waive it', condition: 'case proceeds, must be confirmed later',
    require: 'makes a control required or recommended', override: 'sets a minimum tier', points: 'adds risk points' };
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="formgrid">
        <div className="field"><label htmlFor="ed_r_label">Name</label><input id="ed_r_label" type="text" value={r.label || ''} onChange={e => set('label', e.target.value)} /></div>
        <div className="field"><label htmlFor="ed_r_ref">Source rule ID (optional, for traceability)</label>
          <input id="ed_r_ref" type="text" placeholder="for example BR-07" value={r.ref || ''} onChange={e => set('ref', e.target.value)} /></div>
      </div>
      {isNew && <div className="field"><label htmlFor="ed_r_kind">What the rule does</label>
        <select id="ed_r_kind" value={k} onChange={e => set('kind', e.target.value)}>
          {labels.kindOrder.map((x: string) => <option key={x} value={x}>{labels.ruleKinds[x]} ({help[x]})</option>)}
        </select></div>}
      <div className="field"><span className="lab">When (all of these must hold)</span>
        <TermsEditor terms={r.when || []} onChange={v => set('when', v)} sources={sources} />
        <p className="small muted" style={{ marginTop: 4 }}>All conditions must be true together. For "either/or", use an "any of" group or make two rules.</p></div>
      {(k === 'guardrail' || k === 'condition') && <div className="field"><label htmlFor="ed_r_msg">{k === 'guardrail' ? 'What the submitter is told when this guardrail applies' : 'What must be confirmed'}</label>
        <input id="ed_r_msg" type="text" value={r.message || ''} onChange={e => set('message', e.target.value)} /></div>}
      {k === 'condition' && <div className="field"><label htmlFor="ed_r_by">Confirm before</label>
        <select id="ed_r_by" value={r.clearBy === 'pilot' ? 'pilot' : 'production'} onChange={e => set('clearBy', e.target.value)}><option value="pilot">Pilot</option><option value="production">Production</option></select></div>}
      {k === 'require' && <div className="formgrid">
        <div className="field"><label htmlFor="ed_r_ctl">Control</label>
          <select id="ed_r_ctl" value={r.control || ''} onChange={e => set('control', e.target.value)}><option value="">Choose...</option>
            {draft.controls.map((c: Dict) => <option key={c.id} value={c.id}>{c.text}</option>)}</select></div>
        <div className="field"><label htmlFor="ed_r_lvl">The submitter must claim it, or it is only suggested</label>
          <select id="ed_r_lvl" value={r.level === 'recommended' ? 'recommended' : 'required'} onChange={e => set('level', e.target.value)}>
            <option value="required">Required (the case cannot be submitted without it)</option><option value="recommended">Recommended (shown, optional)</option></select></div>
      </div>}
      {k === 'override' && <div className="field"><label htmlFor="ed_r_tier">Raise the tier to at least</label>
        <select id="ed_r_tier" value={r.minTier || 'high'} onChange={e => set('minTier', e.target.value)}>
          {labels.tiers.map((t: string) => <option key={t} value={t}>{labels.tierLabels[t]}</option>)}</select></div>}
      {k === 'points' && <div className="field"><label htmlFor="ed_r_pts">Risk points added</label>
        <input id="ed_r_pts" type="number" min={0} value={r.points ?? 1} onChange={e => set('points', e.target.value)} /></div>}
    </div>
  );
}

function ControlFields({ c, set, sources }: { c: Dict; set: Setter; sources: Source[] }) {
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="formgrid">
        <div className="field wide"><label htmlFor="ed_c_text">Control</label><input id="ed_c_text" type="text" value={c.text || ''} onChange={e => set('text', e.target.value)} /></div>
        <div className="field wide"><label htmlFor="ed_c_short">Short label (shown in tables)</label><input id="ed_c_short" type="text" value={c.short || ''} onChange={e => set('short', e.target.value)} /></div>
        <div className="field"><label htmlFor="ed_c_credit">Risk points it takes off</label><input id="ed_c_credit" type="number" min={0} value={c.credit ?? 0} onChange={e => set('credit', e.target.value)} /></div>
        <div className="field"><label htmlFor="ed_c_attest">Does someone have to confirm it?</label>
          <select id="ed_c_attest" value={c.attest === 'required' ? 'required' : 'optional'} onChange={e => set('attest', e.target.value)}>
            <option value="optional">Optional: the submitter may offer a confirmation</option>
            <option value="required">Required: a named person must be asked to confirm (evidence also counts as support)</option></select></div>
      </div>
      <div className="field"><span className="lab">This control applies only when (optional; blank means it applies to every use case)</span>
        <TermsEditor terms={c.applies || []} onChange={v => set('applies', v)} sources={sources} /></div>
      <p className="small muted">Whether the control is required is set by the "Required control" rules.</p>
    </div>
  );
}

function TriggerFields({ t, set, sources }: { t: Dict; set: Setter; sources: Source[] }) {
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="formgrid">
        <div className="field wide"><label htmlFor="ed_t_label">What this trigger means (shown to the lead as the reason)</label>
          <input id="ed_t_label" type="text" value={t.label || ''} onChange={e => set('label', e.target.value)} /></div>
        <div className="field"><label htmlFor="ed_t_level">When it matches</label>
          <select id="ed_t_level" value={t.level === 'required' ? 'required' : 'recommended'} onChange={e => set('level', e.target.value)}>
            <option value="recommended">Suggest the consult (recommended)</option><option value="required">Require the consult (holds the decision)</option></select></div>
      </div>
      <div className="field"><span className="lab">All of these must hold (use an "any of" group for alternatives)</span>
        <TermsEditor terms={t.when || []} onChange={v => set('when', v)} sources={sources} /></div>
    </div>
  );
}

/**
 * A list of conditions. Each is either {src, in} ("this question's answer is one of these") or an
 * "any of" group {any: [...]} where one alternative is enough. JavaScript termsEditor and termRow.
 */
export function TermsEditor({ terms, onChange, sources, nested }: { terms: Dict[]; onChange: (t: Dict[]) => void; sources: Source[]; nested?: boolean }) {
  const put = (i: number, t: Dict) => onChange(terms.map((x, j) => (j === i ? t : x)));
  const drop = (i: number) => onChange(terms.filter((_, j) => j !== i));
  const groups = [...new Set(sources.map(s => s.group))];
  return (
    <div className="stack" style={{ gap: 6 }}>
      {terms.map((t, i) => t.any ? (
        <div key={i} className="term" style={{ borderLeft: '3px solid var(--brand)', paddingLeft: 8 }}>
          <div className="row" style={{ flexWrap: 'nowrap' }}><span className="muted small" style={{ width: 40 }}>{i ? 'and' : 'When'}</span>
            <b className="small">any one of these holds</b><button className="btn ghost" onClick={() => drop(i)}>Remove group</button></div>
          <TermsEditor terms={t.any} onChange={v => put(i, { any: v })} sources={sources} nested />
        </div>
      ) : (
        <div key={i} className="term">
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <span className="muted small" style={{ width: 40 }}>{nested ? (i ? 'or' : '') : i ? 'and' : 'When'}</span>
            {/* Changing what is tested clears the ticked answers, because they belonged to the old source. */}
            <select value={t.src || ''} aria-label={`Condition ${i + 1} source`} onChange={e => put(i, { src: e.target.value, in: [] })} style={{ flex: 1, padding: '6px 8px', borderRadius: 6 }}>
              <option value="">Choose...</option>
              {groups.map(g => <optgroup key={g} label={g}>{sources.filter(s => s.group === g).map(s => <option key={s.src} value={s.src}>{s.label}</option>)}</optgroup>)}
            </select>
            <button className="btn ghost" onClick={() => drop(i)} aria-label="Remove condition">Remove</button>
          </div>
          <div className="row" style={{ marginLeft: 48, gap: '4px 14px' }}>
            {(sources.find(s => s.src === t.src)?.values || []).map(o => (
              <label key={o.id} className="small"><input type="checkbox" checked={(t.in || []).includes(o.id)}
                onChange={e => put(i, { ...t, in: e.target.checked ? [...(t.in || []), o.id] : (t.in || []).filter((x: string) => x !== o.id) })} /> {o.label}</label>
            ))}
            {!t.src && <span className="muted small">Pick a source first.</span>}
          </div>
        </div>
      ))}
      <div className="row">
        <button className="btn" onClick={() => onChange([...terms, { src: '', in: [] }])}>{nested ? 'Add another option' : 'Add a condition'}</button>
        {!nested && <button className="btn" onClick={() => onChange([...terms, { any: [{ src: '', in: [] }, { src: '', in: [] }] }])}>Add an "any of" group</button>}
      </div>
    </div>
  );
}
