// Draws one field of an action dialog and keeps its value. Port of build 27's fieldHtml and readFields.
//
// The engine's actions_for describes every input an action needs (see types.ts, Field). Values live in
// one flat object, keyed exactly as the engine's perform expects them, so the dialog can send that
// object as the action's input without translating anything.

import type { Dict, Field } from '../types';
import { useApp } from '../state';
import { fdate } from '../format';
import { MeasuresEditor, MeasureRow, toRows, measuresText } from './MeasuresEditor';

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

const STATUS_CLS: Record<string, string> = { declined: 'bad', neither: 'warn' };
const toggle = (list: string[], x: string, on: boolean) => (on ? [...new Set([...list, x])] : list.filter(y => y !== x));

export function FieldView({ f, v, set, need }: { f: Field; v: Values; set: (k: string, val: unknown) => void; need?: boolean }) {
  const { boot } = useApp();
  const id = 'af_' + f.name;
  const cls = 'field' + (need ? ' need' : '');
  const inner = (() => {
    switch (f.type) {
      case 'hidden': return null;
      case 'note': return <p className="small muted" style={{ marginBottom: 8 }}>{f.label}</p>;
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
      case 'measures': return <div className={cls}><span className="lab">{f.label}</span>
        <MeasuresEditor idPrefix={id + '_'} rows={v[f.name] as MeasureRow[]} onChange={r => set(f.name, r)} />
        {f.proposed?.length ? <p className="small muted" style={{ marginTop: 6 }}><b>The submitter's proposal, for comparison:</b> {measuresText(f.proposed)}</p> : null}</div>;
      case 'stkblock': return <div className={cls}><span className="lab">{f.label}</span><div className="checks">
        {(f.options || []).map(o => <label key={o.v}><input type="checkbox" checked={o.disabled || (v[f.name] || []).includes(o.v)} disabled={o.disabled}
          onChange={e => set(f.name, toggle(v[f.name] || [], o.v, e.target.checked))} /> {o.l}{o.disabled ? ' (already asked)' : ''}</label>)}</div>
        <label className="small" htmlFor="af_question" style={{ marginTop: 6 }}>Message to the stakeholders you tick</label>
        <textarea id="af_question" value={v.question ?? ''} onChange={e => set('question', e.target.value)} /></div>;
      case 'smetable': return <div className={cls}><span className="lab">{f.label}</span><div className="tablewrap"><table>
        <thead><tr><th>Ask</th><th>Area and question</th><th>Type</th><th>Hold the decision?</th></tr></thead>
        <tbody>{(f.options || []).map(o => {
          const asking = (v.smes || []).includes(o.v);
          return <tr key={o.v}>
            <td><input type="checkbox" aria-label={'Ask ' + o.l} checked={asking} disabled={o.disabled || o.asked} onChange={e => set('smes', toggle(v.smes || [], o.v, e.target.checked))} /></td>
            <td>{o.l} {o.asked && <span className="chip">{o.responded ? 'Responded' : o.askedNote}</span>}
              {o.blocked && <div className="small" style={{ color: 'var(--bad)' }}><b>Not available:</b> {o.blocked}</div>}
              {o.why && <div className="small muted">{o.why}</div>}
              {o.asked ? <div className="small muted">Question sent: {o.askedQ}</div>
                : <textarea aria-label={'Question for ' + o.l} value={(v.questions || {})[o.v] ?? ''} onChange={e => set('questions', { ...(v.questions || {}), [o.v]: e.target.value })} style={{ width: '100%', marginTop: 4 }} />}</td>
            <td>{o.blocked ? <span className="chip bad">Conflict</span> : o.level === 'required' ? <span className="chip warn">Required</span> : o.level ? <span className="chip ok">Recommended</span> : <span className="muted small">Discretionary</span>}</td>
            <td>{o.forced ? <b className="small">Always</b> : <label className="small"><input type="checkbox" checked={(v.reqSmes || []).includes(o.v)} disabled={o.responded}
              onChange={e => set('reqSmes', toggle(v.reqSmes || [], o.v, e.target.checked))} /> Hold</label>}</td>
          </tr>;
        })}</tbody></table></div></div>;
      case 'overrides': {
        const threads = f.threads || [];
        if (!threads.length) return <p className="small pos" style={{ marginBottom: 8 }}><b>All controls and consultations are cleared.</b> There are no risks to accept.</p>;
        return <div className="field"><h4>{threads.length} risk{threads.length === 1 ? '' : 's'} to accept</h4>
          <p className="small muted">To approve, accept each risk as is and give a reason for each one. Leave a risk unticked to keep it open for the other reviewers.</p>
          <div className="tablewrap"><table><thead><tr><th>Accept</th><th>Risk</th><th>Reason</th></tr></thead><tbody>
            {threads.map((t: Dict) => <tr key={t.slug}>
              <td><input type="checkbox" aria-label={'Accept: ' + t.label} checked={!!v['ovc_' + t.slug]} onChange={e => set('ovc_' + t.slug, e.target.checked)} /></td>
              <td><span className={'chip ' + (t.kind === 'declined' || t.stance === 'serious' ? 'bad' : 'warn')}>{RISK_KIND[t.kind] || t.kind}</span> <b>{t.head || t.label}</b>
                <div className="small">{t.who ? <><b>{t.who}</b>{t.detail ? ': ' : ''}<i>{t.detail}</i></> : <span className="muted">{t.detail}</span>}</div></td>
              <td><textarea aria-label={'Reason to accept: ' + t.label} value={v['ov_' + t.slug] ?? ''} onChange={e => set('ov_' + t.slug, e.target.value)} style={{ width: '100%' }} /></td>
            </tr>)}</tbody></table></div></div>;
      }
      case 'support': return <div className="field"><span className="lab">{f.label}</span>
        {f.net != null && <p className="small">Inherent risk is {f.inherent}. Counting only confirmed or evidenced controls, the remaining risk is <b>{f.net}</b>.</p>}
        {(f.rows || []).length ? <ul style={{ margin: '4px 0', paddingLeft: 18 }}>{f.rows.map((r: Dict) => <li key={r.id}><span className={'chip ' + (STATUS_CLS[r.status] || 'ok')}>{boot.ctlStatus[r.status]}</span> {r.text} <span className="muted small">(credit {r.credit}){r.na ? ', does not apply' : ''}</span></li>)}</ul>
          : <p className="muted small">No controls claimed.</p>}</div>;
      case 'panelnotes': return <div className="field"><span className="lab">{f.label}</span>
        {f.rec && <div className="pnote"><b>Panel recommendation</b> <span className="muted small">{f.rec.by}, {fdate(f.rec.at)}</span><div><i>{f.rec.text}</i></div></div>}
        <p className="small muted">Every reviewer's decision and note. They also appear on the case under Reviews, so they are not private.</p>
        {(f.notes || []).map((n: Dict, i: number) => <div key={i} className="pnote"><b>{n.by}</b>{n.me ? ' (you)' : ''} <span className="muted small">{n.role}{n.at ? ', ' + fdate(n.at) : ''}</span>{' '}
          {n.dec ? <span className="chip">{n.dec}{n.firm ? ', firm' : ', leaning'}</span> : <span className="muted small">No decision yet</span>}{n.text && <div>{n.text}</div>}</div>)}</div>;
      default: return <div className={cls}><label htmlFor={id}>{f.label}</label><input id={id} type="text" value={v[f.name] ?? ''} onChange={e => set(f.name, e.target.value)} /></div>;
    }
  })();
  if (f.sec) return <div className="card" style={{ marginBottom: 10 }}><h3 style={{ marginBottom: 8 }}>{f.secTitle}</h3>{inner}</div>;
  return inner;
}

const RISK_KIND: Record<string, string> = { declined: 'Control declined', unsupported: 'Control unsupported', missing: 'Not claimed', concern: 'Concern', condition: 'Condition' };
