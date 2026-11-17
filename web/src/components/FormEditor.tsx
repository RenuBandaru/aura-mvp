// The use case form, while the submitter (or the owner signing off) can still edit it. Port of build
// 27's ucFormHtml, in the same six sections. As you type, the form is sent to the API's preview
// endpoint, and the engine answers which questions and controls apply and what is still missing, so
// the rules stay in one place.

import { useEffect, useRef, useState } from 'react';
import { post } from '../api';
import { useApp } from '../state';
import type { Dict } from '../types';
import { MeasuresEditor, toRows } from './MeasuresEditor';
import { money } from '../format';

const SECTIONS: [string, string][] = [['about', 'The idea'], ['cost', 'Cost'], ['measures', 'KPIs'], ['risk', 'Risk'], ['ready', 'Data'], ['controls', 'Controls']];
/** Full section names, for tooltips and the Next buttons. JavaScript FTAB_FULL. */
const FULL: Record<string, string> = { about: 'About the idea', cost: 'Cost and budget', measures: 'KPIs (key performance indicators)', risk: 'Risk questions', ready: 'Data readiness', controls: 'Controls' };
const OWNER_ROLES = ['submitter', 'stakeholder', 'exec'];

/** What the editor holds: the case form, with KPIs as editable text rows. */
export type DraftForm = Dict;
export const draftFrom = (form: Dict): DraftForm => ({ ...form, measures: toRows(form.measures), answers: { ...(form.answers || {}) },
  readiness: { ...(form.readiness || {}) }, controls: [...(form.controls || [])], attesters: { ...(form.attesters || {}) }, evidence: { ...(form.evidence || {}) } });

/** The current answer as the token the inputs use: yes/no questions store true and false. */
const token = (q: Dict, a: unknown) => (q.type === 'yesno' ? (a === true ? 'yes' : a === false ? 'no' : a) : a);
const fromToken = (q: Dict, t: string) => (q.type === 'yesno' ? (t === 'yes' ? true : t === 'no' ? false : t) : t);

export function FormEditor({ caseId, form, setForm, onPreview, unitId, accepting, returned, jump }: {
  caseId: string; form: DraftForm; setForm: (f: DraftForm) => void; onPreview: (p: Dict | null) => void;
  /** The case's business unit, shown until the form names one. */
  unitId?: string;
  /** The owner is signing off, so the owner cannot be changed. */
  accepting?: boolean;
  returned?: boolean;
  /** Show this section; n changes each time the page asks, so asking twice works. */
  jump?: { k: string; n: number };
}) {
  const { boot, me, name } = useApp();
  const R = boot.rules;
  const [sec, setSec] = useState('about');
  const [preview, setPreview] = useState<Dict | null>(null);
  const timer = useRef<number>();
  useEffect(() => { if (jump) setSec(s => (s === 'all' ? 'all' : jump.k)); }, [jump]);

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
  const gapFields = new Set<string>(preview?.submitGaps?.fields || []);
  const need = (k: string) => boot.formFields.some(x => x.k === k && gapFields.has(x.label));
  const Help = ({ t }: { t?: React.ReactNode }) => t ? <span className="help">{t}</span> : null;
  const T = (k: string, label: string, area = false, wide = false, help?: React.ReactNode, placeholder?: string) => (
    <div className={'field' + (wide ? ' wide' : '') + (need(k) ? ' need' : '')}><label htmlFor={'uf_' + k}>{label}</label>
      {area ? <textarea id={'uf_' + k} value={form[k] ?? ''} placeholder={placeholder} onChange={e => set(k, e.target.value)} />
        : <input id={'uf_' + k} type="text" value={form[k] ?? ''} placeholder={placeholder} onChange={e => set(k, e.target.value)} />}<Help t={help} /></div>
  );
  const S = (k: string, label: string, opts: { id: string; label: string }[], wide = false, help?: React.ReactNode, choose = true) => (
    <div className={'field' + (wide ? ' wide' : '') + (need(k) ? ' need' : '')}><label htmlFor={'uf_' + k}>{label}</label>
      <select id={'uf_' + k} value={form[k] ?? ''} onChange={e => set(k, e.target.value)}>
        {choose && <option value="">Choose...</option>}{opts.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}</select><Help t={help} /></div>
  );
  const N = (k: string, label: string, help?: React.ReactNode) => (
    <div className={'field' + (need(k) ? ' need' : '')}><label htmlFor={'uf_' + k}>{label}</label><input id={'uf_' + k} type="number" min={0} step="any" value={form[k] ?? ''} onChange={e => set(k, e.target.value)} /><Help t={help} /></div>
  );

  const shownQ = new Set(preview?.questionsShown || []);
  const needs: Dict = preview?.controlNeeds || {};
  const gaps = preview?.submitGaps;
  const owners = boot.people.filter(p => OWNER_ROLES.includes(p.role));
  const confirmers = boot.people.filter(p => !['admin', 'auditor', 'lead', 'panel', 'exec'].includes(p.role));
  const controls = (R.controls || []).filter((k: Dict) => k.enabled !== false && (needs[k.id] || form.controls.includes(k.id)))
    .sort((a: Dict, b: Dict) => Number(needs[b.id]?.level === 'required') - Number(needs[a.id]?.level === 'required'));

  // What is still to answer in each section, for the badges on the section tabs (the API's tabGaps).
  const left: Record<string, number> = preview?.sectionGaps || { about: 0, cost: 0, measures: 0, risk: 0, ready: 0, controls: 0 };
  const total = SECTIONS.reduce((a, [k]) => a + left[k], 0), doneN = SECTIONS.filter(([k]) => !left[k]).length;
  const all = sec === 'all';
  const show = (k: string) => all || sec === k;
  const go = (k: string) => { setSec(k); window.scrollTo({ top: 0 }); };
  /** Back and Next buttons under each section. JavaScript fnav. */
  const Nav = ({ k }: { k: string }) => {
    if (all) return null;
    const i = SECTIONS.findIndex(x => x[0] === k), prev = SECTIONS[i - 1], next = SECTIONS[i + 1];
    return <div className="fnav">{prev ? <button type="button" className="btn" onClick={() => go(prev[0])}>&larr; {FULL[prev[0]]}</button> : <span />}
      {next ? <button type="button" className="btn" onClick={() => go(next[0])}>Next: {FULL[next[0]]} &rarr;</button> : <span />}</div>;
  };
  const ownerId = form.ownerId || '';
  const ownerHint = ownerId === me.id ? 'You own this use case, so submitting sends it straight to triage.'
    : (name(ownerId) || 'The owner') + ' will be asked to sign off first. They can edit the draft, accept (which submits it) or decline with a reason. The review clock starts only at submission.';
  const naCtl = form.controls.filter((id: string) => !needs[id]).map((id: string) => R.controls.find((k: Dict) => k.id === id)).filter(Boolean);

  return (
    <div className="card">
      <h2>Use case details <span className="chip">{accepting ? 'You are the owner: edit, then accept or decline' : returned ? 'Returned, please update' : 'Editable'}</span></h2>
      <div className="tabs" role="tablist" aria-label="Form sections">
        {SECTIONS.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={k === sec} title={FULL[k]} onClick={() => setSec(k)}>{l}
          {preview && <span className={'n ' + (left[k] ? 'bad' : 'ok')} title={left[k] ? left[k] + ' still to answer' : 'Complete'}>{left[k] ? left[k] : '\u2713'}</span>}</button>)}
      </div>
      <div className="fprow"><span className="muted small" aria-live="polite">{preview ? (total ? `${doneN} of ${SECTIONS.length} sections complete. ${total} answer${total > 1 ? 's' : ''} still needed before you can submit.`
        : 'All sections complete. You can submit for triage.') : ''}</span>
        <button type="button" className="btn ghost sm" aria-pressed={all} onClick={() => setSec(all ? 'about' : 'all')}>{all ? 'Show one section at a time' : 'Show all on one page'}</button></div>

      {show('about') && <div className="fallsec"><div className="formgrid">
        {T('problem', 'Problem to solve', true, true)}
        {T('solution', 'Proposed solution: what will be built or bought, how it works, what data it uses, who uses it and what it can do on its own', true, true)}
        {T('businessCase', 'Business case', true)}{T('successMetric', 'Success metric, in words', true)}
        {T('dataRequired', 'Data required', false, true)}
        {S('ucType', 'Type of AI use case', R.ucTypes || [], true, 'This decides which questions you see.')}
        {T('process', 'Affected process or department')}
        <div className="field"><label htmlFor="uf_unitId">Business unit</label>
          <select id="uf_unitId" value={form.unitId || unitId || ''} onChange={e => set('unitId', e.target.value)}>
            {(R.units || []).map((u: Dict) => <option key={u.id} value={u.id}>{u.label}</option>)}</select><Help t="Decides your adoption adviser." /></div>
        {T('users', 'Who will use it')}
        <div className={'field' + (need('ownerId') || need('owner') ? ' need' : '')}><label htmlFor="uf_ownerId">Owner (accountable, usually holds the budget)</label>
          <select id="uf_ownerId" value={ownerId} disabled={accepting} onChange={e => set('ownerId', e.target.value)}>
            {owners.map(p => <option key={p.id} value={p.id}>{p.name}, {p.title}</option>)}</select><Help t={ownerHint} /></div>
        <div className={'field' + (need('sponsor') ? ' need' : '')}><label htmlFor="uf_sponsor">Sponsor</label>
          <input id="uf_sponsor" type="text" list="sponsorlist" autoComplete="off" value={form.sponsor ?? ''} placeholder="Start typing a name" onChange={e => set('sponsor', e.target.value)} />
          <datalist id="sponsorlist">{boot.people.filter(p => p.role !== 'admin').map(p => <option key={p.id} value={p.name}>{p.title}</option>)}</datalist>
          <Help t="Pick from the list or type a name that is not in it." /></div>
        {N('valueUSD', 'Estimated annual value (USD)')}
      </div><Nav k="about" /></div>}

      {show('cost') && <div className="fallsec"><h3 style={{ margin: '0 0 4px' }}>Cost and budget</h3>
        <p className="muted small" style={{ marginBottom: 6 }}>This is where the adoption adviser and the owner get involved. Zero is a valid answer, but it must be entered. Include token and subscription costs in the ongoing cost.</p>
        <div className="formgrid">
        {N('costUSD', 'One-time cost (USD)')}{N('ongoingCostUSD', 'Ongoing cost (USD)')}
        <div className="field"><label htmlFor="uf_ongoingBasis">The ongoing cost is</label>
          <select id="uf_ongoingBasis" value={form.ongoingBasis || 'total_year'} onChange={e => set('ongoingBasis', e.target.value)}>
            <option value="total_year">A total, per year</option><option value="per_user_month">Per user, per month</option></select>
          <Help t="A high per-user cost gets extra budget scrutiny from reviewers. It never stops the case." /></div>
        {T('budgetSource', 'Whose budget pays for it?', false, false, 'If the cost comes out of the IT budget, the owner should be IT.')}
        {T('alternatives', 'Alternatives considered, including doing it another way (optional)', true, true)}
        {T('costOfNothing', 'Cost and risk of carrying on as is if this is not approved (optional)', true, true)}
        {preview?.budgetFlag && <p className="callout warn wide">The ongoing cost is {money(preview.budgetFlag.amount)} per user per month, above the {money(preview.budgetFlag.limit)} limit, so the budget gets extra scrutiny.</p>}
      </div><Nav k="cost" /></div>}

      {show('measures') && <div className="fallsec"><h3 style={{ margin: '0 0 4px' }}>KPIs: how will we know it works, and when should we stop?</h3>
        <p className="small muted" style={{ marginBottom: 8 }}>Propose up to four KPIs (key performance indicators). The approver can edit them. Each needs a target and a stop limit: if the result passes the stop limit, the case is flagged automatically.</p>
        <MeasuresEditor idPrefix="uf_" rows={form.measures} onChange={r => set('measures', r)} /><Nav k="measures" /></div>}

      {show('risk') && <div className="fallsec"><h3 style={{ margin: '0 0 4px' }}>Reach and autonomy</h3>
        <div className="formgrid">{S('scope', 'Reach', boot.scopeOpts, false, undefined, false)}{S('autonomy', 'How much does it act on its own?', boot.autonomyOpts, false, undefined, false)}</div>
        <h3 style={{ margin: '14px 0 4px' }}>Risk questions</h3>{(R.questions || []).filter((q: Dict) => q.enabled !== false && shownQ.has(q.id)).map((q: Dict) => {
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
      })}<Nav k="risk" /></div>}

      {show('ready') && <div className="fallsec"><h3 style={{ margin: '0 0 4px' }}>Data readiness: is it feasible?</h3>{(R.readiness || []).filter((r: Dict) => r.enabled !== false).map((r: Dict) => {
        const cur = form.readiness[r.id];
        const missing = gaps?.readiness.some((x: Dict) => x.id === r.id);
        return <div key={r.id} className={'qa' + (missing ? ' need' : '')}><span>{r.text}</span><span className="yn">
          {[['yes', true, 'Yes'], ['no', false, 'No'], ['unknown', 'unknown', 'Not known']].map(([k, val, l]) =>
            <label key={String(k)}><input type="radio" name={'rd_' + r.id} checked={cur === val} onChange={() => setIn('readiness', r.id, val)} /> {String(l)}</label>)}
        </span></div>;
      })}<Nav k="ready" /></div>}

      {show('controls') && <div className="fallsec"><h3 style={{ margin: '0 0 6px' }}>Controls in place or planned</h3>
        {naCtl.length > 0 && <div className="callout warn" style={{ marginBottom: 8 }}><b>{naCtl.length === 1 ? 'A control you claimed no longer applies' : naCtl.length + ' controls you claimed no longer apply'} to your answers</b>
          <span className="small">{naCtl.map((k: Dict) => k.short || k.text).join('; ')}. They earn no credit now, but nothing is lost: if you change the answer back they count again, with their evidence and confirmations. You can leave them, or untick them to remove them. A confirmer who was asked will be told their input is no longer needed for that control.</span></div>}
        <p className="small muted" style={{ marginBottom: 8 }}>Your answers decide which controls are <b>required</b> for this use case. Claim each required control before you submit. If you cannot back a claim, work with the owner, the adoption adviser, or the governance lead before you submit. Recommended controls are optional. Controls marked "Needs confirmation" need a named person to confirm them. Evidence you attach also counts as support. On other controls, name a confirmer too: it strengthens your request. Approval is never held up waiting for one.</p>
        {controls.map((k: Dict) => {
          const picked = form.controls.includes(k.id), nd = needs[k.id];
          return <div key={k.id} className={'ctl' + (picked && !nd ? ' na' : '')}>
            <label className="row" style={{ alignItems: 'flex-start' }}><input type="checkbox" checked={picked}
              onChange={e => set('controls', e.target.checked ? [...form.controls, k.id] : form.controls.filter((x: string) => x !== k.id))} />
              <span>{k.text} {nd?.level === 'required' && <span className="chip bad">Required</span>}{nd?.level === 'recommended' && <span className="chip">Recommended</span>}
                {picked && !nd && <span className="chip">Does not apply to your answers</span>}
                {k.attest === 'required' && <span className="chip warn">Needs confirmation</span>}</span></label>
            {picked && <div className="formgrid" style={{ marginTop: 8 }}>
              <div className="field"><label>{k.attest === 'required' ? 'Who can confirm this? (required)' : 'Offer a confirmation (optional)'}</label>
                <select value={form.attesters[k.id] || ''} onChange={e => setIn('attesters', k.id, e.target.value || undefined)}>
                  <option value="">{k.attest === 'required' ? 'Choose a person...' : 'No one'}</option>
                  {confirmers.map(p => <option key={p.id} value={p.id}>{p.name}, {p.title}</option>)}</select></div>
              <div className="field"><label>Evidence: a link or reference</label>
                <input type="text" value={form.evidence[k.id] || ''} placeholder="For example: test report TR-1234" onChange={e => setIn('evidence', k.id, e.target.value || undefined)} /></div>
            </div>}
            {nd?.reasons?.length > 0 && <div className="small muted" style={{ marginTop: 4 }}>because: {nd.reasons.filter((r: Dict) => r.level === nd.level).map((r: Dict) => r.label).join('; ')}</div>}
          </div>;
        })}
        <Nav k="controls" />
      </div>}
    </div>
  );
}
