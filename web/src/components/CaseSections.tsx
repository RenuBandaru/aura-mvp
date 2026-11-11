// The read-only sections of a case page, one component per tab. Ports of build 27's ucViewHtml,
// assessHtml, attestCard, consultHtml, decisionsHtml and activityHtml (simplified layouts).

import { go, useApp } from '../state';
import type { CaseDetail, Dict } from '../types';
import { fdate, fdatetime, money } from '../format';
import { measuresText } from './MeasuresEditor';

const STATUS_CLS: Record<string, string> = { confirmed: 'ok', evidence: 'ok', declined: 'bad', neither: 'warn' };

/** A label and value grid that skips empty values. */
const KV = ({ rows }: { rows: [string, React.ReactNode][] }) => (
  <div className="kv">{rows.filter(([, v]) => v !== '' && v != null && v !== false).flatMap(([k, v]) => [<div key={k + 'k'}>{k}</div>, <div key={k + 'v'}>{v}</div>])}</div>
);

export function UseCaseView({ d }: { d: CaseDetail }) {
  const { boot, name } = useApp();
  const c = d.case, f = c.form || {};
  const R = boot.rules;
  const label = (opts: { id: string; label: string }[], id: string) => opts.find(o => o.id === id)?.label || id;
  if (c.stage === 'suggestion') return <div className="card"><h2>The idea</h2><p style={{ whiteSpace: 'pre-wrap' }}>{c.idea}</p></div>;
  const answers = (R.questions || []).filter((q: Dict) => f.answers && q.id in f.answers).map((q: Dict) => {
    const a = f.answers[q.id], opts = boot.questionOptions[q.id] || [];
    const t = Array.isArray(a) ? a : [q.type === 'yesno' ? (a === true ? 'yes' : a === false ? 'no' : a) : a];
    return [q.short || q.text, t.map(x => opts.find(o => o.id === x)?.label || String(x)).join(', ')] as [string, string];
  });
  return (
    <div className="stack">
      <div className="card"><h2>About the idea</h2><KV rows={[
        ['Type', label(R.ucTypes || [], f.ucType)], ['Problem', f.problem], ['Proposed solution', f.solution], ['Business case', f.businessCase],
        ['Success metric', f.successMetric], ['Data required', f.dataRequired], ['Process', f.process], ['Users', f.users],
        ['Owner', name(f.ownerId) || f.owner], ['Sponsor', f.sponsor], ['Reach', label(boot.scopeOpts, f.scope)], ['Autonomy', label(boot.autonomyOpts, f.autonomy)],
        ['Alternatives', f.alternatives], ['Cost of doing nothing', f.costOfNothing]]} /></div>
      <div className="card"><h2>Cost and value</h2><KV rows={[
        ['Value per year', money(f.valueUSD)], ['One-time cost', money(f.costUSD)],
        ['Running cost', f.ongoingCostUSD !== '' && f.ongoingCostUSD != null ? money(f.ongoingCostUSD) + ' ' + (boot.ongoingBasis[f.ongoingBasis] || '') : ''],
        ['Budget source', f.budgetSource], ['Three-year return', d.roi?.cost ? `${money(d.roi.net)} net (${Math.round(d.roi.roi * 100)}%)` : '']]} />
        {d.budgetFlag && <p className="callout warn" style={{ marginTop: 8 }}>Running cost is ${d.budgetFlag.amount} per user per month, above the ${d.budgetFlag.limit} limit.</p>}</div>
      <div className="card"><h2>KPIs</h2>{(f.measures || []).length ? <p>{measuresText(f.measures)}</p> : <p className="muted">No KPIs yet.</p>}</div>
      {answers.length > 0 && <div className="card"><h2>Risk answers</h2><KV rows={answers} /></div>}
    </div>
  );
}

export function Assessment({ d }: { d: CaseDetail }) {
  const { boot } = useApp();
  const s = d.scoring, c = d.case;
  if (!s) return <p className="muted">Not assessed yet. A use case is scored when it is submitted for triage.</p>;
  return (
    <div className="stack">
      <div className="card"><h2>Risk score</h2>
        <KV rows={[['Inherent risk', <b key="i">{s.inherent} points</b>], ['Tier', <span key="t" className={'tier ' + s.tier}>{boot.tierLabels[s.tier]}</span>],
          ['Remaining risk, proven controls only', d.support?.net != null ? `${d.support.net} points (${boot.tierLabels[d.support.netTier] || d.support.netTier})` : ''],
          ['If every claimed control is proven', `${s.residual} points (${boot.tierLabels[s.residualTier] || s.residualTier}), with ${s.controlCredit} points of control credit`],
          ['Conditions to clear', (s.conditions || []).map((x: Dict) => x.label || x.text).join('; ')],
          ['Raised by', (s.overrides || []).filter((o: Dict) => o.raised).map((o: Dict) => o.label).join(', ')]]} />
        <h3 style={{ margin: '12px 0 6px' }}>Why</h3>
        <ul style={{ margin: 0, paddingLeft: 18 }}>{(s.explain || []).map((e: Dict, i: number) => <li key={i}>{e.label}: <b>{e.points > 0 ? '+' : ''}{e.points}</b></li>)}</ul>
        {(s.inapplicable || []).length > 0 && <p className="small muted" style={{ marginTop: 8 }}>Claimed controls that no longer apply earn no credit: {s.inapplicable.join(', ')}.</p>}
      </div>
      {c.triage && <div className="card"><h2>Triage</h2>
        {(c.triage.flags || []).length ? <ul style={{ margin: 0, paddingLeft: 18 }}>{c.triage.flags.map((fl: Dict) => <li key={fl.id}>{fl.text}{fl.blocker ? <span className="chip bad" style={{ marginLeft: 6 }}>Guardrail</span> : null}</li>)}</ul>
          : <p className="muted">No flags.</p>}<p className="small muted" style={{ marginTop: 6 }}>Triaged {fdate(c.triage.at)}.</p></div>}
    </div>
  );
}

export function ControlsEvidence({ d, onRemoveEvidence }: { d: CaseDetail; onRemoveEvidence?: (evidenceId: string) => void }) {
  const { boot, name } = useApp();
  const c = d.case, rows = d.support?.rows || [];
  const removable = new Set(d.actions.filter(a => a.id === 'remove_evidence').map(a => a.evidenceId));
  return (
    <div className="stack">
      <div className="card"><h2>Claimed controls</h2>
        {d.support?.net != null && <p className="small" style={{ marginBottom: 8 }}>Counting only confirmed or evidenced controls, the remaining risk is <b>{d.support.net}</b> ({boot.tierLabels[d.support.netTier] || d.support.netTier}).</p>}
        {rows.length ? <div className="tablewrap"><table><thead><tr><th>Control</th><th>Status</th><th>Confirmer</th><th>Credit</th></tr></thead><tbody>
          {rows.map((r: Dict) => <tr key={r.id}><td>{r.text}{r.na && <span className="chip" style={{ marginLeft: 6 }}>Does not apply</span>}{r.required && <span className="chip warn" style={{ marginLeft: 6 }}>Required</span>}</td>
            <td><span className={'chip ' + (STATUS_CLS[r.status] || '')}>{boot.ctlStatus[r.status]}</span>{r.pending && <div className="small muted">Waiting on {name(r.asked)}</div>}</td>
            <td className="small">{r.asked ? name(r.asked) : <span className="muted">None</span>}</td><td>{r.credit}</td></tr>)}
        </tbody></table></div> : <p className="muted">No controls claimed.</p>}
      </div>
      <div className="card"><h2>Evidence</h2>
        {(c.evidenceItems || []).length ? <ul style={{ margin: 0, paddingLeft: 18 }}>{c.evidenceItems.map((e: Dict) => <li key={e.id}>
          <b>{(boot.rules.controls.find((k: Dict) => k.id === e.controlId) || {}).short || e.controlId}</b>:{' '}
          {e.kind === 'link' ? <a href={e.url} target="_blank" rel="noreferrer">{e.name}</a> : <a href={'/api/files/' + e.fileId} onClick={ev => { ev.preventDefault(); openFile(e.fileId); }}>{e.name}</a>}
          <span className="muted small"> added by {name(e.by)}, {fdate(e.at)}{e.note ? '. ' + e.note : ''}</span>
          {removable.has(e.id) && onRemoveEvidence && <button className="btn ghost small" onClick={() => onRemoveEvidence(e.id)}>Remove</button>}
        </li>)}</ul> : <p className="muted">No evidence yet.</p>}
      </div>
    </div>
  );
}

async function openFile(fileId: string) {
  const { get } = await import('../api');
  const f = await get<Dict>('/files/' + fileId);
  const w = window.open();
  if (w) w.document.write(`<iframe src="${f.data}" style="border:0;width:100%;height:100%"></iframe>`);
}

export function Reviews({ d }: { d: CaseDetail }) {
  const { name, boot } = useApp();
  const title = (pid: string) => boot.people.find(p => p.id === pid)?.title || '';
  const c = d.case, rv = d.review;
  const decisions: [string, Dict | null][] = [['Vetting', c.vetting], ['Panel decision', c.panelDecision], ['Executive decision', c.execDecision]];
  return (
    <div className="stack">
      {rv && <div className="card"><h2>{c.stage === 'exec' ? 'Executive review' : 'Panel review'}</h2>
        <p className="small muted" style={{ marginBottom: 8 }}>Needs {rv.need} firm, agreeing reviewers.
          {rv.ready?.ok ? ' Ready to finalize.' : ''}{rv.deadlock ? ' The reviewers disagree, so this is a deadlock.' : ''}</p>
        {(rv.blockers?.pend || []).length > 0 && <p className="callout warn" style={{ marginBottom: 8 }}>Waiting on required experts: {rv.blockers.pend.map((k: Dict) => name(k.personId)).join(', ')}. Firm decisions wait until they respond.</p>}
        <div className="tablewrap"><table><thead><tr><th>Reviewer</th><th>Decision</th></tr></thead><tbody>
          {(rv.pool || []).map((pid: string) => { const v = rv.votes.find((x: Dict) => x.personId === pid);
            return <tr key={pid}><td>{name(pid)}</td><td>{v ? <>{v.label} <span className="muted small">{['approve', 'waive', 'remediate', 'reject', 'escalate', 'recommend'].includes(v.dec) ? (v.firm ? 'firm' : 'leaning') : ''}</span></> : <span className="muted">Not yet</span>}</td></tr>; })}
        </tbody></table></div></div>}
      <div className="card"><h2>Experts and stakeholders</h2>
        {(c.consults || []).length ? <div className="stack" style={{ gap: 8 }}>{c.consults.map((k: Dict) => <div key={k.id} className="pnote">
          <div className="row"><b>{name(k.personId)}</b><span className="chip">{k.kind === 'sme' ? (title(k.personId) || 'Expert') : 'Stakeholder'}</span>
            {k.required && <span className="chip warn">Holds the decision</span>}
            <span className={'chip ' + (k.status === 'responded' ? 'ok' : k.supersededBy ? '' : 'warn')}>{k.supersededBy ? 'Asked again' : k.status === 'responded' ? 'Responded' : 'Waiting'}</span>
            <span className="muted small">asked {fdate(k.requestedAt)}{k.dueAt ? ', due ' + fdate(k.dueAt) : ''}</span></div>
          <div className="small"><span className="muted">Question:</span> {k.question}</div>
          {k.response && <div className="small"><span className="muted">Response ({k.response.stance}):</span> {k.response.text || <span className="muted">Hidden from your role</span>}</div>}
        </div>)}</div> : <p className="muted">No one has been consulted.</p>}
      </div>
      <div className="card"><h2>Decisions</h2>
        {decisions.filter(([, x]) => x).length || c.pilot || c.production || c.closed ? <div className="stack" style={{ gap: 8 }}>
          {decisions.filter(([, x]) => x).map(([l, x]) => <div key={l} className="pnote"><b>{l}</b> <span className="muted small">{name(x!.by)}, {fdate(x!.at)}</span>
            {x!.decision && <span className="chip" style={{ marginLeft: 6 }}>{x!.decision}</span>}{(x!.rationale || x!.note) && <div className="small">{x!.rationale || x!.note}</div>}</div>)}
          {c.pilot && <div className="pnote"><b>Pilot</b> {c.pilot.waived ? <span className="chip">Waived</span> : <span className="muted small">started {fdate(c.pilot.startedAt)}, review due {fdate(c.pilot.reviewDueAt)}</span>}<div className="small">{c.pilot.scope}</div></div>}
          {c.production && <div className="pnote"><b>Production</b> <span className="muted small">since {fdate(c.production.since)}, next review {fdate(c.production.nextReviewAt)}</span><div className="small">{c.production.how}</div></div>}
          {c.closed && <div className="pnote"><b>Closed</b> <span className="muted small">{fdate(c.closed.at)}</span><div className="small">{c.closed.reason}</div></div>}
        </div> : <p className="muted">No decisions yet.</p>}
      </div>
      {c.acceptance && <div className="card"><h2>Approved terms</h2><KV rows={[['Scope', c.acceptance.scope], ['Conditions and limits', c.acceptance.limits],
        ['KPIs', measuresText(c.acceptance.measures)], ['Approved', `${name(c.acceptance.by)}, ${fdate(c.acceptance.at)}`],
        ['Valid until', fdate(c.acceptance.validUntil)]]} />
        {d.measures.length > 0 && <><h3 style={{ margin: '12px 0 6px' }}>Latest KPI results</h3><ul style={{ margin: 0, paddingLeft: 18 }}>
          {d.measures.map((b: Dict) => <li key={b.m.id}>{b.m.name}: <b>{b.value ?? 'no result yet'}</b> {b.state && <span className={'chip ' + (b.state === 'stop' ? 'bad' : b.state === 'short' ? 'warn' : 'ok')}>{MEAS_STATE[b.state] || b.state}</span>}</li>)}</ul></>}
      </div>}
    </div>
  );
}
const MEAS_STATE: Record<string, string> = { stop: 'Stop limit passed', scale: 'Scale-up target reached', met: 'Target met', short: 'Below target' }; // engine MEAS_STATE

export function Activity({ d }: { d: CaseDetail }) {
  const { name } = useApp();
  const audit = [...(d.case.audit || [])].reverse();
  return (
    <div className="card"><div className="row" style={{ justifyContent: 'space-between' }}><h2>Activity</h2>
        <button className="btn ghost" onClick={() => go('audit', d.case.id)}>See in audit log</button></div>
      <p className={'small ' + (d.auditCheck.ok ? 'pos' : '')} style={{ marginBottom: 10, color: d.auditCheck.ok ? undefined : 'var(--bad)' }}>
        {d.auditCheck.ok ? `Audit trail verified: all ${d.auditCheck.entries} entries are intact (each one is sealed with a hash of the one before).` : 'The audit trail does not verify. An entry was changed after it was recorded.'}</p>
      <ul className="timeline">{audit.map((e: Dict, i: number) => <li key={i}><div><b>{e.action}</b> <span className="muted small">{e.actor === 'system' ? 'System' : name(e.actor)}, {fdatetime(e.ts)}</span></div>
        {e.note && <div className="small">{e.note}</div>}</li>)}</ul>
    </div>
  );
}
