// The use case form, while the submitter (or the owner signing off) can still edit it. Port of build
// 27's ucFormHtml, in the same six sections. As you type, the form is sent to the API's preview
// endpoint, and the engine answers which questions and controls apply and what is still missing, so
// the rules stay in one place.

import { useEffect, useRef, useState } from 'react';
import { post } from '../api';
import { useApp } from '../state';
import type { Dict } from '../types';
import { MeasuresEditor, toRows } from './MeasuresEditor';
import { TEMPLATE_FIELDS } from './CaseSections';

const SECTIONS: [string, string][] = [['about', 'The idea'], ['details', 'Template details'], ['cost', 'Cost'], ['measures', 'KPIs'], ['risk', 'Risk'], ['ready', 'Data'], ['controls', 'Controls']];
const OWNER_ROLES = ['submitter', 'stakeholder', 'exec'];

/** What the editor holds: the case form, with KPIs as editable text rows. */
export type DraftForm = Dict;
export const draftFrom = (form: Dict): DraftForm => ({ ...form, measures: toRows(form.measures), answers: { ...(form.answers || {}) },
  readiness: { ...(form.readiness || {}) }, template: { ...(form.template || {}) }, controls: [...(form.controls || [])], attesters: { ...(form.attesters || {}) }, evidence: { ...(form.evidence || {}) } });

/** The current answer as the token the inputs use: yes/no questions store true and false. */
const token = (q: Dict, a: unknown) => (q.type === 'yesno' ? (a === true ? 'yes' : a === false ? 'no' : a) : a);
const fromToken = (q: Dict, t: string) => (q.type === 'yesno' ? (t === 'yes' ? true : t === 'no' ? false : t) : t);

export function FormEditor({ caseId, form, setForm, onPreview }: {
  caseId: string; form: DraftForm; setForm: (f: DraftForm) => void; onPreview: (p: Dict | null) => void;
}) {
  const { boot } = useApp();
  const R = boot.rules;
  const [sec, setSec] = useState('about');
  const [preview, setPreview] = useState<Dict | null>(null);
  const timer = useRef<number>();

  useEffect(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      post<Dict>(`/cases/${caseId}/preview`, { form }).then(p => { setPreview(p); onPreview(p); }).catch(() => undefined);
    }, 250);
    return () => window.clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, caseId]);

  const set = (k: string, v: unknown) => setForm({ ...form, [k]: v });
  const setIn = (k: string, id: string, v: unknown) => {
    const next = { ...(form[k] || {}) };
    if (v === undefined || v === '') delete next[id]; else next[id] = v;
    setForm({ ...form, [k]: next });
  };
  const T = (k: string, label: string, area = false, wide = false) => (
    <div className={'field' + (wide ? ' wide' : '')}><label htmlFor={'uf_' + k}>{label}</label>
      {area ? <textarea id={'uf_' + k} value={form[k] ?? ''} onChange={e => set(k, e.target.value)} />
        : <input id={'uf_' + k} type="text" value={form[k] ?? ''} onChange={e => set(k, e.target.value)} />}</div>
  );
  const S = (k: string, label: string, opts: { id: string; label: string }[], wide = false) => (
    <div className={'field' + (wide ? ' wide' : '')}><label htmlFor={'uf_' + k}>{label}</label>
      <select id={'uf_' + k} value={form[k] ?? ''} onChange={e => set(k, e.target.value)}>
        <option value="">Choose...</option>{opts.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}</select></div>
  );
  const N = (k: string, label: string) => (
    <div className="field"><label htmlFor={'uf_' + k}>{label}</label><input id={'uf_' + k} type="number" min={0} value={form[k] ?? ''} onChange={e => set(k, e.target.value)} /></div>
  );

  const shownQ = new Set(preview?.questionsShown || []);
  const needs: Dict = preview?.controlNeeds || {};
  const gaps = preview?.submitGaps;
  const owners = boot.people.filter(p => OWNER_ROLES.includes(p.role));
  const confirmers = boot.people.filter(p => !['admin', 'auditor', 'lead', 'panel', 'exec'].includes(p.role));
  const controls = (R.controls || []).filter((k: Dict) => k.enabled !== false && (needs[k.id] || form.controls.includes(k.id)));

  return (
    <div className="card">
      <h2>Use case details <span className="chip">Editable</span></h2>
      {gaps && (gaps.count ? <p className="small muted" style={{ marginBottom: 8 }}>{gaps.count} item{gaps.count === 1 ? '' : 's'} still to answer before you submit.</p>
        : <p className="small pos" style={{ marginBottom: 8 }}><b>Everything is answered.</b> You can submit for triage.</p>)}
      <div className="tabs" role="tablist" aria-label="Form sections">
        {SECTIONS.map(([k, l]) => <button key={k} role="tab" aria-selected={k === sec} onClick={() => setSec(k)}>{l}</button>)}
      </div>

      {sec === 'about' && <div className="formgrid">
        {S('ucType', 'Type of AI use case', R.ucTypes || [], true)}
        {T('problem', 'Problem to solve', true, true)}
        {T('solution', 'Proposed solution: what will be built or bought, how it works, what data it uses, who uses it and what it can do on its own', true, true)}
        {T('businessCase', 'Business case', true)}{T('successMetric', 'Success metric, in words', true)}
        {T('dataRequired', 'Data required', false, true)}{T('process', 'Business process affected')}{T('users', 'Who will use it')}
        <div className="field"><label htmlFor="uf_ownerId">Owner (accountable, usually holds the budget)</label>
          <select id="uf_ownerId" value={form.ownerId || ''} onChange={e => set('ownerId', e.target.value)}>
            {owners.map(p => <option key={p.id} value={p.id}>{p.name}, {p.title}</option>)}</select></div>
        {T('sponsor', 'Executive sponsor')}
        {S('scope', 'Who it reaches', boot.scopeOpts)}{S('autonomy', 'What it can do on its own', boot.autonomyOpts)}
        {N('valueUSD', 'Expected value per year (USD)')}
        {T('alternatives', 'Alternatives considered', true)}{T('costOfNothing', 'Cost of doing nothing', true)}
      </div>}

      {sec === 'details' && <div className="formgrid">
        <p className="small muted wide">Optional. These follow the client's use-case template; they are shown on the case page and do not change the score.</p>
        {TEMPLATE_FIELDS.map(([k, l]) => <div key={k} className="field wide"><label htmlFor={'uft_' + k}>{l}</label>
          <textarea id={'uft_' + k} value={(form.template || {})[k] ?? ''} onChange={e => setIn('template', k, e.target.value || undefined)} /></div>)}
      </div>}

      {sec === 'cost' && <div className="formgrid">
        {N('costUSD', 'One-time cost (USD)')}{N('ongoingCostUSD', 'Running cost (USD)')}
        <div className="field"><label htmlFor="uf_ongoingBasis">Running cost is</label>
          <select id="uf_ongoingBasis" value={form.ongoingBasis || 'total_year'} onChange={e => set('ongoingBasis', e.target.value)}>
            {Object.entries(boot.ongoingBasis).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
        {T('budgetSource', 'Budget source')}
        {preview?.budgetFlag && <p className="callout warn wide">The running cost is ${preview.budgetFlag.amount} per user per month, above the ${preview.budgetFlag.limit} limit, so the budget gets extra scrutiny.</p>}
      </div>}

      {sec === 'measures' && <div><p className="small muted" style={{ marginBottom: 8 }}>Each KPI needs a target and a stop limit: the value at which the use case is paused for review.</p>
        <MeasuresEditor idPrefix="uf_" rows={form.measures} onChange={r => set('measures', r)} /></div>}

      {sec === 'risk' && <div>{(R.questions || []).filter((q: Dict) => q.enabled !== false && shownQ.has(q.id)).map((q: Dict) => {
        const opts = boot.questionOptions[q.id] || [];
        const cur = token(q, form.answers[q.id]);
        const missing = gaps?.questions.some((x: Dict) => x.id === q.id);
        return <div key={q.id} className={'qa' + (missing ? ' need' : '')}><span>{q.text}</span><span className="yn">
          {q.type === 'multi' ? opts.map(o => <label key={o.id}><input type="checkbox" checked={(form.answers[q.id] || []).includes(o.id)}
            onChange={e => { const list = (form.answers[q.id] || []).filter((x: string) => x !== o.id); setIn('answers', q.id, e.target.checked ? [...list, o.id] : list.length ? list : undefined); }} /> {o.label}</label>)
            : q.type === 'single' ? <select aria-label={q.short || q.text} value={String(cur ?? '')} onChange={e => setIn('answers', q.id, e.target.value ? fromToken(q, e.target.value) : undefined)}>
              <option value="">Choose...</option>{opts.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}</select>
            : opts.map(o => <label key={o.id}><input type="radio" name={'qa_' + q.id} checked={cur === o.id} onChange={() => setIn('answers', q.id, fromToken(q, o.id))} /> {o.label}</label>)}
        </span></div>;
      })}</div>}

      {sec === 'ready' && <div>{(R.readiness || []).filter((r: Dict) => r.enabled !== false).map((r: Dict) => {
        const cur = form.readiness[r.id];
        const missing = gaps?.readiness.some((x: Dict) => x.id === r.id);
        return <div key={r.id} className={'qa' + (missing ? ' need' : '')}><span>{r.text}</span><span className="yn">
          {[['yes', true, 'Yes'], ['no', false, 'No'], ['unknown', 'unknown', 'Not known']].map(([k, val, l]) =>
            <label key={String(k)}><input type="radio" name={'rd_' + r.id} checked={cur === val} onChange={() => setIn('readiness', r.id, val)} /> {String(l)}</label>)}
        </span></div>;
      })}</div>}

      {sec === 'controls' && <div>
        <p className="small muted" style={{ marginBottom: 8 }}>The controls that apply to your answers. Claim the ones you will put in place. A named confirmer or evidence counts as support.</p>
        {controls.map((k: Dict) => {
          const picked = form.controls.includes(k.id), nd = needs[k.id];
          return <div key={k.id} className={'ctl' + (picked && !nd ? ' na' : '')}>
            <label className="row" style={{ alignItems: 'flex-start' }}><input type="checkbox" checked={picked}
              onChange={e => set('controls', e.target.checked ? [...form.controls, k.id] : form.controls.filter((x: string) => x !== k.id))} />
              <span>{k.text} {nd?.level === 'required' && <span className="chip bad">Required</span>}
                {picked && !nd && <span className="chip">Does not apply to your answers</span>}
                {k.attest === 'required' && <span className="chip warn">Needs confirmation</span>}</span></label>
            {picked && <div className="formgrid" style={{ marginTop: 8 }}>
              <div className="field"><label>{k.attest === 'required' ? 'Who can confirm this? (required)' : 'Offer a confirmation (optional)'}</label>
                <select value={form.attesters[k.id] || ''} onChange={e => setIn('attesters', k.id, e.target.value || undefined)}>
                  <option value="">{k.attest === 'required' ? 'Choose a person...' : 'No one'}</option>
                  {confirmers.map(p => <option key={p.id} value={p.id}>{p.name}, {p.title}</option>)}</select></div>
              <div className="field"><label>Evidence: a link or reference</label>
                <input type="text" value={form.evidence[k.id] || ''} onChange={e => setIn('evidence', k.id, e.target.value || undefined)} /></div>
            </div>}
          </div>;
        })}
      </div>}
    </div>
  );
}
