// Draws one field of an action dialog and keeps its value. Port of build 27's fieldHtml and readFields.
//
// The engine's actions_for describes every input an action needs (see types.ts, Field). Values live in
// one flat object, keyed exactly as the engine's perform expects them, so the dialog can send that
// object as the action's input without translating anything.

import type { Dict, Field } from '../types';
import { useApp } from '../state';
import { fdate } from '../format';
import { MeasuresEditor, MeasureRow, toRows } from './MeasuresEditor';

export type Values = Dict;

/** The starting values for a dialog, from each field's default. */
export function initialValues(fields: Field[]): Values {
  const v: Values = {};
  for (const f of fields) {
    switch (f.type) {
      case 'support': case 'note': case 'panelnotes': break;
      case 'overrides':
        for (const t of f.threads || []) {
          const saved = (f.saved || {})[t.slug] || {};
          v['ov_' + t.slug] = saved.reason || '';
          v['ovc_' + t.slug] = !!saved.on;
        }
        break;
      case 'measures': v[f.name] = toRows(f.value); break;
      case 'checks': v[f.name] = [...(f.value || [])]; break;
      case 'stkblock': v[f.name] = [...(f.value || [])]; v.question = f.qValue || ''; break;
      case 'smetable': {
        const opts = f.options || [];
        v[f.name] = opts.filter(o => (f.value || []).includes(o.v) || o.asked).map(o => o.v);
        v.reqSmes = opts.filter(o => o.forced || (f.reqValue || []).includes(o.v)).map(o => o.v);
        v.questions = Object.fromEntries(opts.filter(o => !o.asked).map(o => [o.v, o.qDefault || '']));
        break;
      }
      default: v[f.name] = f.value == null ? '' : f.value;
    }
  }
  return v;
}

/** The input to send: smetable "hold" ticks only count for experts who are being asked. */
export function inputFrom(fields: Field[], v: Values): Values {
  const out = { ...v };
  if (fields.some(f => f.type === 'smetable')) out.reqSmes = (v.reqSmes || []).filter((x: string) => (v.smes || []).includes(x));
  return out;
}

const toggle = (list: string[], x: string, on: boolean) => (on ? [...new Set([...list, x])] : list.filter(y => y !== x));

export function FieldView({ f, v, set, need }: { f: Field; v: Values; set: (k: string, val: unknown) => void; need?: boolean }) {
  const { boot } = useApp();
  const id = 'af_' + f.name;
  const cls = 'field' + (need ? ' need' : '');
  const chipOf = (st: string) => 'chip ' + (st === 'declined' ? 'bad' : st === 'neither' ? 'warn' : 'ok');
  const inner = (() => {
    switch (f.type) {
      case 'hidden': return null;
      case 'note': return <p className="small muted">{f.label}</p>;
      case 'textarea': return <div className={cls}><label htmlFor={id}>{f.label}</label><textarea id={id} value={v[f.name] ?? ''} onChange={e => set(f.name, e.target.value)} /></div>;
      case 'number': return <div className={cls}><label htmlFor={id}>{f.label}</label><input id={id} type="number" step={f.measure ? 'any' : undefined} min={f.measure ? undefined : 1} value={v[f.name] ?? ''} onChange={e => set(f.name, e.target.value === '' ? '' : Number(e.target.value))} /></div>;
      case 'select': {
        const opts = f.options || [];
        return <div className={cls}><label htmlFor={id}>{f.label}</label>
          <select id={id} value={v[f.name] ?? ''} onChange={e => set(f.name, e.target.value)}>
            {!opts.some(o => o.v === '') && <option value="">Choose...</option>}
            {opts.map(o => <option key={o.v} value={o.v} disabled={o.disabled}>{o.l}</option>)}
          </select></div>;
      }
      case 'checks': return <div className={cls}><span className="lab">{f.label}</span><div className="checks">
        {(f.options || []).map(o => <label key={o.v}><input type="checkbox" checked={(v[f.name] || []).includes(o.v)} disabled={o.disabled}
          onChange={e => set(f.name, toggle(v[f.name] || [], o.v, e.target.checked))} /> {o.l}</label>)}</div></div>;
      case 'measures': return <div className={cls + ' wide'}><span className="lab">{f.label}</span>
        <MeasuresEditor idPrefix={id + '_'} rows={v[f.name] as MeasureRow[]} onChange={r => set(f.name, r)} />
        {f.proposed?.length ? <div className="propbox"><span className="lab small">The submitter's proposal (for comparison only; edit the KPIs above)</span><KpiCompact ms={f.proposed} /></div> : null}</div>;
      case 'stkblock': return <div className={cls}><span className="lab">{f.label}</span><div className="checks">
        {(f.options || []).map(o => <label key={o.v}><input type="checkbox" checked={o.disabled || (v[f.name] || []).includes(o.v)} disabled={o.disabled}
          onChange={e => set(f.name, toggle(v[f.name] || [], o.v, e.target.checked))} /> {o.l}{o.disabled ? ' (already asked)' : ''}</label>)}</div>
        <label className="small" htmlFor="af_question" style={{ marginTop: 6 }}>Message to the stakeholders you tick</label>
        <textarea id="af_question" value={v.question ?? ''} onChange={e => set('question', e.target.value)} /></div>;
      case 'smetable': return <div className={cls}><span className="lab">{f.label}</span><table className="smetab">
        <thead><tr><th>Ask</th><th>Area and question</th><th>Type</th><th>Hold the decision?</th></tr></thead>
        <tbody>{(f.options || []).map(o => {
          const asking = (v.smes || []).includes(o.v);
          return <tr key={o.v}>
            <td><input type="checkbox" className="askcb" aria-label={'Ask ' + o.l} checked={asking} disabled={o.disabled || o.asked} onChange={e => set('smes', toggle(v.smes || [], o.v, e.target.checked))} /></td>
            <td>{o.l}{o.asked && <> <span className="chip">{o.responded ? 'Responded' : String(o.askedNote || '').charAt(0).toUpperCase() + String(o.askedNote || '').slice(1)}</span></>}
              {o.blocked && <div className="small" style={{ color: '#b3261e' }}><b>Not available:</b> {o.blocked} Assign this area to someone else under Rules, Consult areas.</div>}
              {o.why && <div className="small muted">{o.why}</div>}
              {o.asked ? <div className="small muted">Question sent: {o.askedQ}</div>
                : <div className="qbox"><label className="small" htmlFor={'af_sq_' + o.v}>Question for {String(o.l).replace(/ \(([^()]*)\)$/, ', answered by $1')}</label>
                  <textarea id={'af_sq_' + o.v} value={(v.questions || {})[o.v] ?? ''} onChange={e => set('questions', { ...(v.questions || {}), [o.v]: e.target.value })} /></div>}</td>
            <td>{o.blocked ? <span className="chip bad">Conflict</span> : o.level === 'required' ? <span className="chip warn">Required</span> : o.level ? <span className="chip ok">Recommended</span> : <span className="muted small">Discretionary</span>}</td>
            <td>{o.forced ? <span className="small"><b>Always</b></span> : <label className="sw"><input type="checkbox" checked={(v.reqSmes || []).includes(o.v)} disabled={o.responded}
              onChange={e => set('reqSmes', toggle(v.reqSmes || [], o.v, e.target.checked))} /> <span className="small">Hold</span></label>}</td>
          </tr>;
        })}</tbody></table></div>;
      case 'overrides': {
        const threads = f.threads || [];
        if (!threads.length) return <div className="field wide"><p className="small pos"><b>All controls and consultations are cleared.</b> There are no risks to accept.</p></div>;
        const tag = (t: Dict) => t.kind === 'concern' ? (t.stance === 'serious' ? <span className="chip bad">Serious concern</span> : <span className="chip warn">Concerns</span>)
          : t.kind === 'declined' ? <span className="chip bad">Control declined</span> : <span className="chip warn">{RISK_KIND[t.kind]}</span>;
        return <div className="field wide"><h4 className="ovh">{threads.length} risk{threads.length === 1 ? '' : 's'} to accept</h4>
          <p className="small muted" style={{ margin: '0 0 6px' }}>To approve, accept each risk as is and give a reason for each one. Your reasons are saved with the draft and recorded with the decision. Leave a risk unticked to keep it open for the other reviewers.</p>
          <div className="tablewrap"><table className="ovt"><thead><tr><th>Accept</th><th>Risk</th><th>Reason</th></tr></thead><tbody>
            {threads.map((t: Dict) => <tr key={t.slug}>
              <td className="ovc"><input type="checkbox" id={'af_ovc_' + t.slug} aria-label={'Accept this concern: ' + t.label} checked={!!v['ovc_' + t.slug]} onChange={e => set('ovc_' + t.slug, e.target.checked)} /></td>
              <td><div className="rline">{tag(t)} <span className="rhead">{t.head || t.label}</span></div>
                {t.who ? <div><b>{t.who}</b>{t.detail && <>: <i>{t.detail}</i></>}</div> : <div className="muted small">{t.detail}</div>}</td>
              <td><textarea id={'af_ov_' + t.slug} aria-label={'Reason to override: ' + t.label} value={v['ov_' + t.slug] ?? ''} onChange={e => set('ov_' + t.slug, e.target.value)} /></td>
            </tr>)}</tbody></table></div></div>;
      }
      case 'support': {
        const rows: Dict[] = f.rows || [], threads: Dict[] = f.threads || [];
        if (!threads.length) return <div className="field wide">
          {f.net != null && <p className="riskline">Inherent risk is {f.inherent}. Counting only confirmed or evidenced controls, the remaining risk is <b className="riskbig">{f.net}</b>.</p>}
          {rows.length ? <div className="tablewrap"><table><thead><tr><th>Control</th><th>Status</th><th>Credit</th></tr></thead><tbody>
            {rows.map((r, i) => <tr key={i}><td>{r.text}</td><td><span className={chipOf(r.status)}>{boot.ctlStatus[r.status]}</span></td><td className="num">{r.status === 'declined' ? '0/' + r.credit : r.credit}</td></tr>)}</tbody></table></div>
            : <p className="muted small">No controls claimed.</p>}
          <p className="small muted">This list is read-only. Add evidence on the case before approving.</p></div>;
        return <div className="field wide supbox"><span className="lab">{f.label}</span>
          {rows.length ? <ul className="suplist">{rows.map((r, i) => <li key={i}><span className={chipOf(r.status)}>{boot.ctlStatus[r.status]}</span> {r.text} <span className="muted small">(credit {r.credit})</span></li>)}</ul>
            : <p className="muted small">No controls claimed.</p>}
          {threads.length ? <><p className="small" style={{ margin: '6px 0 2px' }}><b>{threads.length} open item{threads.length > 1 ? 's' : ''} to override:</b></p>
            <ul className="suplist">{threads.map((t, i) => <li key={i}><span className={'chip ' + (t.kind === 'concern' || t.kind === 'declined' ? 'bad' : 'warn')}>{RISK_KIND[t.kind]}</span> {t.label} <span className="muted small">{t.detail}</span></li>)}</ul></>
            : <p className="small pos">No open items.</p>}
          {f.net != null && <p className="small muted" style={{ marginTop: 6 }}>Inherent {f.inherent}. Counting only confirmed or evidenced controls the remaining risk is <b>{f.net}</b>.</p>}</div>;
      }
      case 'panelnotes': return <ReviewerNotes f={f} />;
      default: return <div className={cls}><label htmlFor={id}>{f.label}</label><input id={id} type="text" value={v[f.name] ?? ''} onChange={e => set(f.name, e.target.value)} /></div>;
    }
  })();
  if (f.sec) return <div className={'psec s-' + f.sec}><h4>{f.secTitle}</h4>{inner}</div>;
  return inner;
}

/** KPIs as a small table: the submitter's proposal beside the editable KPIs. Build 27's kpiCompact. */
export const KpiCompact = ({ ms }: { ms?: Dict[] }) => ms && ms.length ? <table className="kpic"><thead><tr><th>KPI</th><th>Better when</th><th className="num">Target</th><th className="num">Scale-up</th><th className="num">Stop limit</th></tr></thead>
  <tbody>{ms.map((m, i) => <tr key={i}><td>{m.name}</td><td>{m.dir === 'higher' ? 'Higher' : 'Lower'}</td><td className="num">{m.target}</td><td className="num">{m.scaleUp == null || m.scaleUp === '' ? '-' : m.scaleUp}</td><td className="num">{m.stop}</td></tr>)}</tbody></table>
  : <span className="muted small">None.</span>;

const RISK_KIND: Record<string, string> = { declined: 'Control declined', unsupported: 'Control unsupported', missing: 'Not claimed', concern: 'Concern', condition: 'Condition' };

const DEC_WORDS: Record<string, string> = { approve: 'Approve for pilot', waive: 'Approve and waive pilot', remediate: 'Remediate', reject: 'Reject',
  escalate: 'Send to executives', abstain: 'Abstain', await: 'Awaiting input' };
const DEC_CLS: Record<string, string> = { approve: 'ok', waive: 'ok', escalate: 'ok', reject: 'bad', remediate: 'warn', await: 'warn', abstain: '' };
const FIRMABLE = ['approve', 'waive', 'remediate', 'reject', 'escalate'];

/** The reviewers' decisions and notes. With othersOnly (the "Record my decision" pop-up) the person acting is left out,
 *  and it says so when no one else has voted or commented yet. labels are the decision words from the decision field. */
export function ReviewerNotes({ f, othersOnly, labels }: { f: Field; othersOnly?: boolean; labels?: Record<string, string> }) {
  const rows: Dict[] = (f.notes || []).filter((n: Dict) => !othersOnly || !n.me);
  const said = rows.filter(n => n.dec || n.text);
  const word = (d: string) => (labels || {})[d] || DEC_WORDS[d] || d;
  const chip = (n: Dict) => n.dec ? <span className={'chip ' + (DEC_CLS[n.dec] || '')}>{word(n.dec)}{FIRMABLE.includes(n.dec) ? (n.firm ? ', firm' : ', leaning') : ''}</span> : <span className="chip">No decision yet</span>;
  return (
    <div className="field wide">{othersOnly && <span className="lab">Other reviewers</span>}
      {f.rec && <div className="pnote"><div><b>Panel recommendation</b> <span className="muted small">{f.rec.by} · {fdate(f.rec.at)}</span> <span className="chip ok">Approve for pilot</span></div><div><i>{f.rec.text}</i></div></div>}
      {othersOnly && !said.length ? <p className="muted">No one else has voted yet.</p> : <>
        <p className="small muted" style={{ margin: '0 0 4px' }}>{othersOnly ? 'What the others have decided and written so far. ' : "Every reviewer's decision and note. "}Other reviewers, the governance lead, executives and the auditor can see these on the case. The submitter, owner and adviser see only the panel's summary and conditions.{othersOnly ? '' : ' The decision notes, conditions and KPIs entered here are recorded on the use case when it is decided.'}</p>
        <div className="pnotes">{rows.map((n: Dict, i: number) => <div key={i} className="pnote"><div><b>{n.by}</b>{n.me ? ' (you)' : ''} <span className="muted small">{n.role}{n.at ? ' · ' + fdate(n.at) : ''}</span> {chip(n)}</div>
          {n.text && <div style={{ whiteSpace: 'pre-wrap' }}>{n.text}</div>}</div>)}</div>
      </>}
    </div>
  );
}
