// Case page redesign pieces (docs/design/case-page-redesign.md). Display only: every value comes from
// the API (views.holding_view, readiness_view, independence_view, tier_sensitivity, support rows' proof).

import { useApp } from '../state';
import type { CaseDetail, Dict } from '../types';

const PROOF: Record<string, [string, string]> = { file: ['File attached', 'ok'], note: ['Note only', 'warn'], none: ['None yet', ''] };

/** How a claimed control is backed, named apart from its confirmation status (change 3). */
export const ProofChip = ({ proof }: { proof?: string }) => {
  const [label, cls] = PROOF[proof || 'none'] || PROOF.none;
  return <span className={'chip ' + cls}>{label}</span>;
};

/** Who the decision is waiting on, grouped by job (change 4). */
export function HoldingPanel({ d }: { d: CaseDetail }) {
  const { name } = useApp();
  const h = d.holding;
  if (!h) return null;
  const experts = h.answer.filter((a: Dict) => a.kind === 'sme');
  const stakeholders = h.answer.filter((a: Dict) => a.kind !== 'sme');
  return (
    <div className="card holding">
      <h2>What is holding the decision</h2>
      <div className="holdgrid">
        <div className="holdcol"><h3>Answer (experts)</h3>
          {experts.length ? experts.map((a: Dict) => <div key={a.personId} className="holdrow">
            <div><b>{name(a.personId)}</b><div className="small muted">{a.title}{a.holds ? ' · holds the decision' : ''}</div></div>
            <span className={'chip ' + (a.status === 'responded' ? 'ok' : a.holds ? 'bad' : '')}>{a.status === 'responded' ? 'Answered' : a.holds ? 'Waiting · holds' : 'Waiting · no hold'}</span>
          </div>) : <p className="small muted">No experts asked yet.</p>}
          {stakeholders.length > 0 && <p className="small muted">Stakeholders asked: {stakeholders.map((a: Dict) => name(a.personId)).join(', ')} (never hold the decision).</p>}
        </div>
        <div className="holdcol"><h3>Decide{h.need ? ` (${h.need} needed)` : ''}</h3>
          {h.decide.length ? h.decide.map((v: Dict) => <div key={v.personId} className="holdrow">
            <b>{name(v.personId)}</b>
            <span className={'chip ' + (v.firm ? 'ok' : v.dec ? 'warn' : '')}>{v.dec ? `${v.label}, ${v.firm ? 'firm' : 'leaning'}` : 'Not yet'}</span>
          </div>) : <p className="small muted">The governance lead decides at vetting.</p>}
          {h.firmBlocked.length > 0 && <p className="small" style={{ color: 'var(--bad)' }}>Firm decisions wait: {h.firmBlocked.join(' ')}</p>}
        </div>
        <div className="holdcol"><h3>Confirm (controls)</h3>
          {h.confirm.length ? h.confirm.map((x: Dict) => <div key={x.personId} className="holdrow">
            <div><b>{name(x.personId)}</b><div className="small muted">{x.controls.join(' · ')}</div></div>
            <span className="chip warn">{x.controls.length} to confirm</span>
          </div>) : <p className="small muted">No confirmations pending.</p>}
          <p className="small muted">Unconfirmed controls become open items to accept.</p>
        </div>
      </div>
    </div>
  );
}

/** The "Ready to decide?" checklist for panel reviewers (change 8). */
export function ReadinessCard({ d }: { d: CaseDetail }) {
  const items = d.readiness;
  if (!items) return null;
  const done = items.filter((i: Dict) => i.ok).length;
  return (
    <div className="card"><h2>Ready to decide?</h2>
      <div className="progress" aria-label={`${done} of ${items.length} done`}><i style={{ width: `${(done / items.length) * 100}%` }} /></div>
      <ul className="checklist">{items.map((i: Dict) => <li key={i.label} className={i.ok ? 'ok' : ''}>
        <span className="box" aria-hidden="true">{i.ok ? '✓' : ''}</span>
        <div>{i.label}{!i.ok && i.detail && <div className="small muted">{i.detail}</div>}</div>
      </li>)}</ul>
    </div>
  );
}

/** Conflict-of-duty check for the people reviewing or advising on this case (change 9). */
export function IndependenceCheck({ d }: { d: CaseDetail }) {
  const { name } = useApp();
  const ind = d.independence;
  if (!ind || !ind.checked) return null;
  return (
    <div className="card"><h2>Independence check</h2>
      {ind.issues.length ? <ul style={{ margin: 0, paddingLeft: 18 }}>{ind.issues.map((x: Dict) => <li key={x.personId}><b>{name(x.personId)}</b>: {x.reason}</li>)}</ul>
        : <p className="small pos">No reviewer or expert on this case is its submitter, owner or adviser ({ind.checked} checked).</p>}
    </div>
  );
}

/** What would change the tier: less autonomy or a narrower reach (change 11). Information, not advice. */
export function TierSensitivity({ d }: { d: CaseDetail }) {
  const { boot } = useApp();
  if (!d.sensitivity?.length) return null;
  return (
    <div className="card"><h2>What would change the tier</h2>
      <p className="small muted" style={{ marginBottom: 6 }}>For discussion with the sponsor and reviewers. Only the tier routes the case; this is not a recommendation.</p>
      <ul style={{ margin: 0, paddingLeft: 18 }}>{d.sensitivity.map((x: Dict) => <li key={x.change}>{x.change}: <b>{x.score} points</b> <span className={'tier ' + x.tier}>{boot.tierLabels[x.tier]}</span></li>)}</ul>
    </div>
  );
}
