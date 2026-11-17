// The read-only sections of a case page, one component per tab. Ports of build 27's ucViewHtml, roiHtml,
// dataCard, assessHtml, scoreBars, riskCards, attestCard, termsHtml, measuresCard, reviewStatusHtml,
// consultHtml, decisionsHtml, reviewHistoryHtml, briefingHtml and activityHtml.
//
// Anything that needs the rules engine (readiness, missing answers, review status, KPI results) is
// worked out by the API and arrives on CaseDetail; these components only lay it out.

import { get } from '../api';
import { go, useApp } from '../state';
import type { CaseDetail, Dict } from '../types';
import { DAY, fdate, fdateShort, fdatetime, ago, money, nowMs } from '../format';
import { measuresText } from './MeasuresEditor';

const ALERT = '⚠';
const isBlank = (v: unknown) => v === '' || v == null || (typeof v === 'string' && !v.trim());
const NP = () => <span className="muted">Not provided</span>;
const seesInternal = (role: string) => ['lead', 'panel', 'exec', 'auditor', 'admin'].includes(role);

/** A definition list row that says "Not provided" when the value is blank. */
const D = ({ l, v }: { l: string; v: unknown }) => <><dt>{l}</dt><dd>{isBlank(v) ? <NP /> : String(v)}</dd></>;

const TierTag = ({ tier }: { tier?: string | null }) => {
  const { boot } = useApp();
  return tier ? <span className={'tier ' + tier}>{boot.tierLabels[tier]}</span> : <span className="chip">Not scored</span>;
};

// ---- Stage timer ----

/** "In Panel review: 23 of 10 days allowed, 13 overdue" with a bar. JavaScript stageBar. */
export function StageBar({ c }: { c: Dict }) {
  const { boot } = useApp();
  if (c.stage === 'closed' || !c.stageSince) return null;
  const spent = Math.max(0, Math.floor((nowMs() - c.stageSince) / DAY)), nm = boot.stageLabels[c.stage];
  if (!c.dueAt || c.dueAt <= c.stageSince) return <div className="stagebar"><div className="small muted">In {nm}: <b>{spent}</b> day{spent === 1 ? '' : 's'}</div></div>;
  const allowed = Math.max(1, Math.round((c.dueAt - c.stageSince) / DAY)), over = Math.max(0, spent - allowed);
  return (
    <div className="stagebar" role="img" aria-label={`${spent} days in ${nm}, ${allowed} allowed${over ? ', ' + over + ' overdue' : ''}`}>
      <div className="small">In {nm}: <b>{spent}</b> of {allowed} days allowed{over ? <> <b className="late">{over} overdue</b></> : null}</div>
      <div className="tbar"><i className="used" style={{ flex: `${Math.min(spent, allowed)} 1 0` }} />
        {over ? <i className="over" style={{ flex: `${over} 1 0` }} /> : <i className="left" style={{ flex: `${allowed - spent} 1 0` }} />}</div>
    </div>
  );
}

// ---- Use case tab ----

const ROI_WHY: Record<string, string> = {
  per_user: 'not shown: the ongoing cost is quoted per user, and the number of users is not known.',
  no_value: 'not shown: no annual value has been entered.',
  no_cost: 'not shown: one-time and ongoing costs are not both entered.',
};

/** Cost and value over three years as two bars, or why it cannot be worked out. JavaScript roiHtml. */
export function RoiChart({ f, r }: { f: Dict; r: Dict }) {
  const { boot } = useApp();
  const one = isBlank(f.costUSD) ? null : Number(f.costUSD), og = isBlank(f.ongoingCostUSD) ? null : Number(f.ongoingCostUSD), v = Number(f.valueUSD) > 0 ? Number(f.valueUSD) : null;
  const C1 = '#4f5f6e', C2 = '#97a4b0', CV = '#2e8b57';
  const sw = (c: string) => <i className="sw" style={{ background: c }} />;
  if (r.reason) {
    const line = (l: string, val: React.ReactNode) => <div className="roirow"><span>{l}</span><b style={{ gridColumn: '2 / -1', textAlign: 'left' }}>{val}</b></div>;
    return (
      <div className="roi"><h3>Costs and value</h3>
        {line('One-time cost', one == null ? <NP /> : money(one))}
        {line('Ongoing cost', og == null ? <NP /> : money(og) + ' ' + (boot.ongoingBasis[f.ongoingBasis] || ''))}
        {line('Value', v == null ? <NP /> : money(v) + ' a year')}
        <p className="small muted" style={{ marginTop: 8 }}>3-year return {ROI_WHY[r.reason]}</p></div>
    );
  }
  const mx = Math.max(r.cost, r.value, 1), w = (x: number) => Math.max(0.5, x / mx * 100);
  return (
    <div className="roi"><h3>Costs and value over 3 years</h3>
      <div className="roirow"><span>Cost</span>
        <div className="rbar" role="img" aria-label={`Cost over 3 years ${money(r.cost)}: one-time ${money(one)}, ongoing ${money((og || 0) * 3)}`}>
          <i style={{ width: w(one || 0) + '%', background: C1 }} title={'One-time ' + money(one)} /><i style={{ width: w((og || 0) * 3) + '%', background: C2 }} title={'Ongoing ' + money((og || 0) * 3)} /></div>
        <b>{money(r.cost)}</b></div>
      <div className="roikey small muted">{sw(C1)}One-time {money(one)} {sw(C2)}Ongoing {money(og)} a year, {money((og || 0) * 3)} over 3 years</div>
      <div className="roirow"><span>Value</span><div className="rbar" role="img" aria-label={`Value over 3 years ${money(r.value)}`}><i style={{ width: w(r.value) + '%', background: CV }} /></div><b>{money(r.value)}</b></div>
      <div className="roikey small muted">{sw(CV)}{money(v)} a year, {money(r.value)} over 3 years</div>
      <p className="roisum"><b className={r.net < 0 ? 'neg' : 'pos'}>{r.roi == null ? 'Net ' + money(r.net) : (r.roi >= 0 ? '+' : '') + Math.round(r.roi * 100) + '% ROI'}</b>{' '}
        <span className="muted small">net {money(r.net)} after three years</span></p>
    </div>
  );
}

export function UseCaseView({ d }: { d: CaseDetail }) {
  const { boot, name } = useApp();
  const c = d.case, f = c.form || {};
  if (c.stage === 'suggestion') return <div className="card"><h2>Use case details</h2><p style={{ whiteSpace: 'pre-wrap' }}>{c.idea}</p>
    <p className="muted small" style={{ marginTop: 6 }}>This is still a suggestion. An adoption adviser or the submitter develops it into a use case.</p></div>;
  const type = (boot.rules.ucTypes || []).find((t: Dict) => t.id === f.ucType);
  const early = c.stage === 'use_case';
  const last = (c.production?.biasReviews || []).slice(-1)[0];
  return (
    <>
      <div className="card"><div className="dhead"><h2>Use case details</h2><StageBar c={c} /></div>
        <p className="byline small"><span className="muted">Submitted by</span> <b>{name(c.submitterId)}</b> · <span className="muted">Logged</span> <b>{fdateShort(c.createdAt)}</b>
          {c.toolId && <> · AI tool <a href={'#/tools/' + c.toolId}>{c.toolId}</a></>}</p>
        <dl className="dl">
          <dt>Type of AI use case</dt><dd>{type ? <span className="muted">{type.label}</span> : <NP />}</dd>
          <D l="Problem" v={f.problem} /><D l="Proposed solution" v={f.solution} /><D l="Process" v={f.process} /><D l="Users" v={f.users} />
          <dt>Owner</dt><dd>{f.owner || (f.ownerId && name(f.ownerId)) || <NP />}{c.ownerAccepted ? <span className="muted small"> (signed off)</span>
            : c.signoff?.status === 'requested' ? <span className="muted small"> (awaiting sign-off)</span> : null}</dd>
          <D l="Sponsor" v={f.sponsor} />
          {(c.ipAcks || []).length > 0 && <><dt>IP acknowledgment</dt><dd>{c.ipAcks.map((a: Dict) => name(a.by) + ' on ' + fdateShort(a.at)).join('; ')}</dd></>}
          {last && <><dt>Latest model bias review</dt><dd>{BIAS[last.level] || last.level} <span className="muted small">{fdateShort(last.at)}</span></dd></>}
        </dl>
      </div>
      <div className="card"><h2>Business value</h2>
        <dl className="dl"><D l="Business case" v={f.businessCase} /><D l="Alternatives considered" v={f.alternatives} /><D l="If not approved" v={f.costOfNothing} /></dl>
        <RoiChart f={f} r={d.roi} />
        {d.budgetFlag && <p className="callout warn" style={{ marginTop: 8 }}>Running cost is {money(d.budgetFlag.amount)} per user per month, above the {money(d.budgetFlag.limit)} limit.</p>}
        <dl className="dl" style={{ marginTop: 12 }}><D l="Budget" v={f.budgetSource} /><D l="Success metric" v={f.successMetric} /></dl>
        {early && ((f.measures || []).length ? <KpiCard d={d} embed /> : <dl className="dl" style={{ marginTop: 6 }}><D l="Proposed KPIs" v={measuresText(f.measures)} /></dl>)}
      </div>
    </>
  );
}
const BIAS: Record<string, string> = { none: 'Not reviewed this period', informal: 'Informal check', structured: 'Structured test', audit: 'Independent audit', na: 'Not applicable: does not affect individuals' };

// ---- Data tab ----

const ReadyBoxes = ({ st }: { st: CaseDetail['ready'] }) => (
  <span className="rdmini" aria-label={`${st.count} of ${st.of} data readiness checks met`}>{Array.from({ length: st.of }, (_, i) => <i key={i} className={i < st.count ? 'on' : ''} />)}</span>
);
const Miss = ({ gate }: { gate?: boolean }) => <span className={'miss' + (gate ? ' gate' : '')}>{ALERT} {gate ? 'Missing guardrail' : 'Missing'}</span>;

/** Data required and the readiness checks as Yes / No / Not known boxes. JavaScript dataCard. */
export function DataTab({ d }: { d: CaseDetail }) {
  const c = d.case, f = c.form || {}, st = d.ready;
  if (c.stage === 'suggestion') return null;
  const meaning = st.ok ? `Feasible means enough readiness checks are met for the data to support the work. The rules need at least ${st.need}.`
    : `Not yet feasible: the rules need at least ${st.need} checks met, so triage flags the case until more are answered Yes.`;
  return (
    <div className="card"><h2>Data</h2>
      <dl className="dl"><D l="Data required" v={f.dataRequired} /></dl>
      <h3 style={{ marginTop: 12 }}>Data readiness</h3>
      <div className="rdsum"><ReadyBoxes st={st} /><b className={st.ok ? 'pos' : 'neg'}>{st.ok ? 'Feasible' : 'Not yet feasible'}</b>
        <span className="small muted">{st.count} of {st.of} checks met. {meaning}</span></div>
      <div>{d.answerRows.readiness.length ? d.answerRows.readiness.map(r => (
        <div key={r.id} className="rdrow"><span className={'rdbox ' + (r.value === true ? 'yes' : r.value === false ? 'no' : 'unk')}>
          {r.value === true ? 'Yes' : r.value === false ? 'No' : r.value === 'unknown' ? 'Not known' : '?'}</span>
          <span>{r.text}{r.miss && <> <Miss /></>}</span></div>)) : <span className="muted">No checks.</span>}</div>
    </div>
  );
}

// ---- Assessment tab ----

const RISK_COL = ['#2a6fa8', '#4f8fc2', '#7aaed6', '#a4c6e2', '#5a7fa0', '#8db4d1'];
const CTL_COL = ['#2e8b57', '#4aa56f', '#6fbd8b', '#96d2ab', '#3f7f5a', '#7fc79a'];
const WHY_HELD: Record<string, string> = { declined: 'confirmation declined', pending: 'waiting for confirmation', 'no attester': 'no confirmer named' };

/** Two stacked bars: the inherent score split by what raised it, and the remaining risk with the credit each control took off. JavaScript scoreBars. */
export function ScoreBars({ d }: { d: CaseDetail }) {
  const { boot } = useApp();
  const c = d.case, s = c.scoring, R = boot.rules, f = c.form || {};
  const wd: Dict = {}; (s.withheld || []).forEach((w: Dict) => { wd[w.id] = w.why; });
  const claimed = (f.controls || []).map((id: string) => R.controls.find((k: Dict) => k.id === id)).filter(Boolean) as Dict[];
  const earned = claimed.filter(k => !wd[k.id]), held = claimed.filter(k => wd[k.id]);
  const stOf: Dict = {}; (d.support?.rows || []).forEach((r: Dict) => { stOf[r.id] = r.status; });
  const unsup = (id: string) => stOf[id] === 'neither';
  const risk = (s.explain || []).map((e: Dict, i: number) => ({ label: e.label, pts: e.points, col: RISK_COL[i % RISK_COL.length] }));
  let left = s.inherent - s.residual;
  const ctl = [...earned].sort((a, b) => (unsup(b.id) ? 1 : 0) - (unsup(a.id) ? 1 : 0)).map((k, i) => {
    const use = Math.min(k.credit, Math.max(left, 0)); left -= use;
    return { id: k.id, label: k.text, pts: k.credit, use, uns: unsup(k.id), col: unsup(k.id) ? '#d98e04' : CTL_COL[i % CTL_COL.length] };
  });
  const seg = (key: string, grow: number, col: string, title: string) => <i key={key} className="seg" style={{ flex: `${grow} 1 0`, background: col }} title={title} />;
  const key = (k: string, col: string, label: string, val: string, extra?: React.ReactNode) =>
    <span key={k} className="k"><i className="sw" style={{ background: col }} /><span>{label}{extra}</span><b>{val}</b></span>;
  const raisedByLead = c.vetting?.raisedTo && TIERS.indexOf(c.tier) > TIERS.indexOf(s.tier);
  const sv = d.support;
  return (
    <div className="sbars">
      <div className="brow"><div className="bhead"><div className="muted small">Inherent risk</div><div className="big">{s.inherent}</div><TierTag tier={c.tier} />
        {raisedByLead && <div className="muted small">Includes manual tier increase</div>}</div>
        <div className="sbar" role="img" aria-label={`Inherent risk ${s.inherent} points, made up of ${risk.length} parts`}>
          {risk.length ? risk.map((r: Dict, i: number) => seg('r' + i, r.pts, r.col, r.label + ': +' + r.pts)) : <i className="seg" style={{ flex: '1 1 0', background: 'var(--line)' }} />}</div></div>
      <div className="slegend">{risk.length ? risk.map((r: Dict, i: number) => key('rk' + i, r.col, r.label, '+' + r.pts)) : <span className="muted small">No risk points scored.</span>}</div>
      <div className="brow"><div className="bhead"><div className="muted small">After controls</div><div className="big">{s.residual}</div><TierTag tier={s.residualTier} /></div>
        <div className="sbar" role="img" aria-label={`Residual risk ${s.residual} points after controls took off ${s.inherent - s.residual}`}>
          {seg('rem', s.residual, '#6b7a89', 'Remaining risk: ' + s.residual)}
          {ctl.filter(x => x.use > 0 && x.uns).map(x => seg('u' + x.id, x.use, x.col, x.label + ': -' + x.pts + ' (unsupported)'))}
          {ctl.filter(x => x.use > 0 && !x.uns).map(x => seg('c' + x.id, x.use, x.col, x.label + ': -' + x.pts))}
          {s.inherent === 0 && <i className="seg" style={{ flex: '1 1 0', background: 'var(--line)' }} />}</div></div>
      <div className="slegend">{key('remk', '#6b7a89', 'Remaining risk', String(s.residual))}
        {ctl.map(x => key('ck' + x.id, x.col, x.label, '-' + x.pts, <>{x.uns && <span className="muted small"> unsupported: no confirmation or evidence</span>}
          {x.use < x.pts && <span className="muted small"> (only {x.use} left to remove)</span>}</>))}
        {held.map(k => <span key={'h' + k.id} className="k"><i className="sw dashed" /><span>{k.text} <span className="muted small">not counted: {WHY_HELD[wd[k.id]] || wd[k.id]}</span></span><b>-{k.credit}</b></span>)}
        {!claimed.length && <span className="muted small">No controls claimed.</span>}</div>
      {(sv?.rows || []).some((r: Dict) => r.status === 'neither') && <div className="brow"><div className="bhead"><div className="muted small">Supported only</div><div className="big">{sv.net}</div><TierTag tier={sv.netTier} /></div>
        <span className="small muted">Counts only controls that are confirmed or have evidence. The amber items above are claimed but not yet backed.</span></div>}
      <p className="small muted" style={{ marginTop: 6 }}>Thresholds on the scores: low up to {R.tiers.lowMax}, moderate up to {R.tiers.moderateMax}, high up to {R.tiers.highMax}.
        Tier comes from the inherent score. Controls change only the remaining risk. Supporting details are on the Controls and evidence tab.</p>
    </div>
  );
}
const TIERS = ['low', 'moderate', 'high', 'critical'];

/** Triage and scoring, then reach and autonomy, then every risk answer. JavaScript assessHtml and riskCards. */
export function Assessment({ d, editing }: { d: CaseDetail; editing?: boolean }) {
  const { boot } = useApp();
  const c = d.case, t = c.triage, s = c.scoring, f = c.form || {}, R = boot.rules, g = d.gapLists;
  const label = (opts: { id: string; label: string }[], id: string) => opts.find(o => o.id === id)?.label || id || 'Not provided';
  const pts = (n: number) => n ? <b>+{n}</b> : <span className="muted small">no points</span>;
  const items = t ? (t.reasons || []).map((r: string) => { const m = /^(Guardrail|Missing information|Data readiness): ?([\s\S]*)$/.exec(r); return m ? { k: m[1], text: m[2] } : { k: '', text: r }; })
    .filter((x: Dict) => x.k !== 'Data readiness') : [];
  const raised = s ? (s.overrides || []).filter((o: Dict) => o.raised) : [];
  return (
    <>
      {(t || s) ? <div className="card"><h2>Triage and scoring <span className="chip auto">Automated</span></h2>
        {t && <>
          <p>{t.result === 'pass' ? <><span className="chip ok">Triage passed</span> <span className="muted small">Guardrails clear.</span></> : <span className="chip bad">Sent back from triage</span>}</p>
          {items.length > 0 && <ul className="reasons">{items.map((x: Dict, i: number) => <li key={i}>{x.k && <><span className={'rpre ' + (x.k === 'Guardrail' ? 'gate' : 'miss')}>{x.k}</span> </>}{x.text}</li>)}</ul>}
          {t.ready && <div className="rdsum" style={{ margin: '8px 0 0' }}><span className="small muted">Data readiness</span><ReadyBoxes st={t.ready} />
            <b className={t.ready.ok ? 'pos' : 'neg'}>{t.ready.ok ? 'Feasible' : 'Not yet feasible'}</b>
            <span className="small muted">{t.ready.count} of {t.ready.of} checks met, {t.ready.need} needed</span></div>}
        </>}
        {s && <>
          <ScoreBars d={d} />
          {g.gates.length > 0 && <div className="callout bad" style={{ marginTop: 10 }}><b>{ALERT} Missing guardrail</b><span>{g.gates.join('; ')}: no answer is on file, so this gate was never applied to this case. The tier may be understated. The reviewer can send the case back or accept it.</span></div>}
          {g.other.length > 0 && <div className="callout warn" style={{ marginTop: 10 }}><b>{ALERT} Missing</b><span>{g.other.join('; ')}. Scoring ignores unanswered items, so the tier may be understated. The reviewer decides whether to send the case back or whether it matters.</span></div>}
          {g.newStops.length > 0 && <div className="callout bad" style={{ marginTop: 10 }}><b>{ALERT} A guardrail now applies</b><span>{g.newStops.join('; ')}. The rules changed after this case passed triage. Nothing was sent back automatically. The reviewer decides.</span></div>}
          {(s.conditions || []).length > 0 && <><h3 style={{ marginTop: 12 }}>Conditions to clear</h3><ul className="small" style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            {s.conditions.map((x: Dict, i: number) => <li key={i}>{x.text} <span className="muted">Confirm before {x.clearBy === 'pilot' ? 'pilot' : 'production'}.</span></li>)}</ul></>}
          <p className="small muted" style={{ marginTop: 8 }}>Scored under rules v{s.rv || '?'}.{s.rv && s.rv !== d.rulesVersion ? ` The current rules are v${d.rulesVersion}. This case has not been re-scored under them.` : ''}</p>
          <p className="small" style={{ marginTop: 8 }}>{raised.length ? `Minimum tier rules raised the tier from ${boot.tierLabels[s.baseTier]} to ${boot.tierLabels[s.tier]}: ${raised.map((o: Dict) => o.label).join('; ')}.`
            : (s.overrides || []).length ? 'Minimum tier rules were triggered but did not change the tier.' : 'No minimum tier rules applied.'}
            {c.vetting?.raisedTo ? ` The governance lead then raised it to ${boot.tierLabels[c.vetting.raisedTo]}.` : ''}</p>
        </>}
      </div> : <p className="muted">Not assessed yet. A use case is scored when it is submitted for triage.</p>}
      {!editing && c.stage !== 'suggestion' && <>
        <div className="card"><h2>Reach and autonomy</h2><div className="anslist">
          <div className="ans"><span>Reach: who is affected</span><span>{label(boot.scopeOpts, f.scope)} {pts(R.scopePoints?.[f.scope] || 0)}</span></div>
          <div className="ans"><span>Autonomy: how much it acts on its own</span><span>{label(boot.autonomyOpts, f.autonomy)} {pts(R.autonomyPoints?.[f.autonomy] || 0)}</span></div></div></div>
        <div className="card"><h2>Risk answers</h2><div className="anslist">{d.answerRows.questions.length ? d.answerRows.questions.map(q => (
          <div key={q.id} className="ans"><span>{q.label}</span><span>{q.value ? <>{q.value}{q.off && <span className="muted small"> (question now disabled)</span>}</>
            : q.miss ? <Miss gate={q.miss === 'gate'} /> : <span className="muted">Not answered</span>}</span></div>)) : <span className="muted">No questions.</span>}</div></div>
      </>}
    </>
  );
}

// ---- Controls and evidence tab ----

/** Each claimed control: who confirms it, the confirmation, evidence with "+ Add", and the credit with Supported or Unsupported. JavaScript attestCard. */
export function ControlsEvidence({ d, onAddEvidence, onRemoveEvidence, onRemoveControl }: {
  d: CaseDetail; onAddEvidence?: (controlId: string) => void; onRemoveEvidence?: (evidenceId: string) => void; onRemoveControl?: (controlId: string) => void;
}) {
  const { boot, name } = useApp();
  const c = d.case, R = boot.rules, rows: Dict[] = d.support?.rows || [];
  if (!rows.length || c.stage === 'suggestion') return null;
  const canEv = d.actions.some(a => a.id === 'add_evidence'), canRm = d.actions.some(a => a.id === 'remove_control');
  const removable = new Set(d.actions.filter(a => a.id === 'remove_evidence').map(a => a.evidenceId));
  const attOf = (id: string) => (c.attestations || []).find((a: Dict) => a.controlId === id);
  const withheld = c.scoring ? (c.scoring.withheld || []).length : 0, unsupN = c.scoring ? rows.filter(r => r.status === 'neither').length : 0;
  return (
    <div className="card"><h2>Controls, confirmation and evidence</h2>
      <div className="tablewrap"><table><thead><tr><th>Control</th><th>Confirmer</th><th>Confirmation</th><th>Evidence</th><th className="num">Credit</th></tr></thead><tbody>
        {rows.map(r => {
          const k = R.controls.find((x: Dict) => x.id === r.id) || {}, at = attOf(r.id), req = k.attest === 'required', counted = !(at && at.status === 'declined'), st = r.status;
          return <tr key={r.id} className={r.na ? 'na' : undefined}>
            <td>{r.text}{r.na && <div className="small"><span className="chip">Does not apply to this case</span> <span className="muted">No credit. It counts again if the answer changes back.</span>
              {canRm && onRemoveControl && <> <button className="btn sm stop" onClick={() => onRemoveControl(r.id)}>Remove</button></>}</div>}
              {req && !r.na && <div className="small"><span className="reqnote">Required</span></div>}</td>
            <td>{at ? name(at.personId) : <span className="muted">Not named</span>}</td>
            <td>{at ? (at.status === 'confirmed' ? <span className="chip ok">Confirmed</span> : at.status === 'declined' ? <span className="chip bad">Confirmation declined</span>
              : <span className="chip warn">Awaiting {name(at.personId)}</span>) : req ? <span className="chip bad">No one named</span> : <span className="muted">-</span>}
              {at?.at && <div className="muted small">{fdateShort(at.at)}</div>}{at?.text && <div className="small">{at.text}</div>}</td>
            <td className="small">{at?.evidence && <div>{at.evidence}</div>}
              {(c.evidenceItems || []).filter((e: Dict) => e.controlId === r.id && !e.removed).map((e: Dict) => <div key={e.id} className="evi">
                {e.kind === 'link' ? <a href={e.url} target="_blank" rel="noopener noreferrer">{e.name}</a>
                  : <><a href={'/api/files/' + e.fileId} onClick={ev => { ev.preventDefault(); openFile(e.fileId); }}>{e.name}</a> <span className="muted">({kb(e.size)})</span></>}
                <div className="muted small">{name(e.by)}, {fdateShort(e.at)}{e.note ? '. ' + e.note : ''}
                  {removable.has(e.id) && onRemoveEvidence && <> <a href="#" onClick={ev => { ev.preventDefault(); onRemoveEvidence(e.id); }}>Remove</a></>}</div></div>)}
              {canEv && onAddEvidence && <div><button className="btn sm" onClick={() => onAddEvidence(r.id)} aria-label={'Add evidence for ' + r.text} title="Add evidence">+ Add</button></div>}</td>
            <td className="num">{c.scoring ? (!r.na && counted ? '+' + r.credit : '0/' + r.credit) : ''}
              {c.scoring && <div><span className={'chip ' + (st === 'confirmed' || st === 'evidence' ? 'ok' : st === 'declined' ? 'bad' : 'warn')}>
                {st === 'confirmed' || st === 'evidence' ? 'Supported' : st === 'declined' ? 'Declined' : 'Unsupported'}</span></div>}</td>
          </tr>;
        })}
      </tbody></table></div>
      <p className="small muted" style={{ marginTop: 6 }}>
        {withheld ? `Credit is withheld on ${withheld} declined control${withheld > 1 ? 's' : ''}, so the remaining risk of ${c.scoring.residual} is higher. ` : ''}
        {unsupN ? `${unsupN} claimed control${unsupN > 1 ? 's have' : ' has'} neither a confirmation nor evidence. They earn credit, but the approver will see them as open items. ` : ''}
        {c.scoring ? '' : 'Confirmation requests can go out before submission. '}
        A confirmer can respond at any time before approval. If they have not by the time of panel or executive review, it simply shows as pending. A claimed control earns its credit right away.
        A declined confirmation, where the confirmer actively disputes the control, removes the credit. A control with no confirmation and no evidence is flagged to the approver, who can approve anyway with a reason.
        Approval is never held up waiting for a confirmation.</p>
    </div>
  );
}
const kb = (n: number) => (n >= 1024 ? Math.round(n / 1024) + ' KB' : n + ' bytes');

async function openFile(fileId: string) {
  const f = await get<Dict>('/files/' + fileId);
  const w = window.open();
  if (w) w.document.write(`<iframe src="${f.data}" style="border:0;width:100%;height:100%"></iframe>`);
}

// ---- Approved terms tab ----

const KpiTable = ({ ms }: { ms: Dict[] }) => (
  <div className="tablewrap"><table><thead><tr><th>KPI</th><th>Better when</th><th className="num">Target</th><th className="num">Scale-up</th><th className="num">Stop limit</th></tr></thead>
    <tbody>{ms.map((m, i) => <tr key={i}><td>{m.name}</td><td>{m.dir === 'higher' ? 'Higher' : 'Lower'}</td><td className="num">{m.target}</td>
      <td className="num">{m.scaleUp == null || m.scaleUp === '' ? '-' : m.scaleUp}</td><td className="num">{m.stop}</td></tr>)}</tbody></table></div>
);

/** The KPIs with their latest result and status, the approved boundaries, and the results recorded. JavaScript measuresCard. */
const kpiShown = (d: CaseDetail, embed?: boolean) => {
  const c = d.case, a = c.acceptance;
  if (!a && !(c.form?.measures || []).length && !c.priorAcceptance) return false;
  return !(!embed && !a && !c.scoring && !c.priorAcceptance);
};

export function KpiCard({ d, embed }: { d: CaseDetail; embed?: boolean }) {
  const { name } = useApp();
  const c = d.case, a = c.acceptance, k = d.kpis;
  if (!kpiShown(d, embed)) return null;
  const title = <>{a ? 'Approved KPIs and boundaries' : 'Proposed KPIs'} {!a && <span className="chip">Awaiting the approver</span>}</>;
  const body = <>
    <div className="tablewrap"><table><thead><tr><th>KPI</th><th>Direction</th><th className="num">Target</th><th className="num">Scale-up</th><th className="num">Stop limit</th><th className="num">Latest</th><th>Status</th></tr></thead><tbody>
      {k.rows.map((r, i) => <tr key={i}><td>{r.name}{r.edited && <> <span className="chip auto" title="The approver changed this from the submitter's proposal">Edited by approver</span></>}</td>
        <td>{r.dir} is better</td><td className="num">{r.target}</td><td className="num">{r.scaleUp == null ? '-' : r.scaleUp}</td><td className="num">{r.stop}</td>
        <td className="num">{r.value == null ? <span className="muted">No result yet</span> : r.value}</td>
        <td>{r.state && <span className={'chip ' + (r.state === 'stop' ? 'bad' : r.state === 'short' ? 'warn' : 'ok')}>{r.stateLabel}</span>}</td></tr>)}
    </tbody></table></div>
    {a ? <>
      <dl className="dl" style={{ marginTop: 10 }}>
        <dt>Production controls, conditions, and limits</dt><dd>{a.limits || 'Not set'}</dd>
        <dt>Scope approved</dt><dd>{a.scope}</dd>
        <dt>Valid until</dt><dd>{fdate(a.validUntil)} ({a.validDays} days from {fdate(a.at)}){d.row.acceptanceExpired && <> <span className="chip warn">Expired</span></>}</dd>
        <dt>Production review</dt><dd>Every {a.prodReviewDays} days</dd>
        <dt>Approved by</dt><dd>{name(a.by)}{a.rv && <span className="muted small"> · rules v{a.rv}</span>}</dd>
      </dl>
      {k.proposedDiffers && <details className="chg"><summary>Submitter's original proposal</summary>{k.proposed.length ? <KpiTable ms={k.proposed} /> : <p className="small">None.</p>}</details>}
    </> : <p className="muted small" style={{ marginTop: 8 }}>The approver sets the final KPIs, limits, validity and review frequency when they approve.</p>}
    {!a && c.priorAcceptance && <div className="callout" style={{ marginTop: 8 }}><b>Previously approved set, kept as the starting suggestion</b><KpiTable ms={c.priorAcceptance.measures || []} />
      <span>It is prefilled for the next approval, where the approver can change it.</span></div>}
    {k.history.length > 0 && <><h3 style={{ marginTop: 12 }}>KPI results recorded</h3><div>{k.history.map((x, i) => <div key={i} className="tl"><div className="when">{fdateShort(x.at)}</div>
      <div><div className="what">{name(x.by)}</div><div className="note">{x.text}</div></div></div>)}</div></>}
  </>;
  return embed ? <div className="subbox"><h3>{title}</h3>{body}</div> : <div className="card"><h2>{title}</h2>{body}</div>;
}

/** What was approved and how the case is running now. JavaScript termsHtml. */
export function TermsTab({ d }: { d: CaseDetail }) {
  const c = d.case;
  if (c.stage === 'suggestion' || c.stage === 'use_case') return null;
  const kpi = kpiShown(d);
  const pilot = c.pilot && !c.pilot.waived && c.pilot.scope, prod = c.production && c.stage === 'production';
  if (!kpi && !pilot && !c.pilot?.waived && !prod) return null;
  return (
    <>
      {kpi && <KpiCard d={d} />}
      {pilot && <div className="card"><h2>Pilot</h2><dl className="dl"><dt>Pilot scope and conditions</dt><dd>{c.pilot.scope}</dd>
        <dt>Review due</dt><dd>{fdateShort(c.pilot.reviewDueAt)} ({c.pilot.reviewDays} day clock set at approval)</dd><dt>Reworks</dt><dd>{c.pilot.reworks || 0}</dd></dl></div>}
      {c.pilot?.waived && <div className="callout"><b>Pilot waived</b><span>{c.pilot.waiverReason}</span></div>}
      {prod && <div className="card"><h2>In production</h2><dl className="dl"><dt>Went live</dt><dd>{fdateShort(c.production.since)}. {c.production.how}.</dd>
        <dt>Last review</dt><dd>{fdateShort(c.production.lastReviewAt)}, {c.production.reviews} logged since go-live</dd><dt>Next review</dt><dd>{fdateShort(c.production.nextReviewAt)}</dd></dl></div>}
    </>
  );
}
/** Whether the Approved terms tab has anything to show. */
export const hasTerms = (d: CaseDetail) => {
  const c = d.case;
  if (c.stage === 'suggestion' || c.stage === 'use_case') return false;
  return kpiShown(d) || !!((c.pilot && (c.pilot.waived || c.pilot.scope)) || (c.production && c.stage === 'production'));
};

/** Whether the Reviews and decisions tab has anything to show for this viewer. */
export const hasReviews = (d: CaseDetail, role: string) => {
  const c = d.case;
  return !!((d.review && seesInternal(role)) || (c.consults || []).length || (c.panelNotes || []).length || c.stage === 'panel'
    || (c.ownerAccepted && c.signoff?.status === 'accepted') || c.vetting || c.panelDecision || c.execDecision || (c.briefing && c.stage !== 'exec') || (d.rounds || []).length);
};

/** Whether the Assessment tab has anything to show. */
export const hasAssessment = (d: CaseDetail, editing: boolean) => !!(d.case.triage || d.case.scoring || (!editing && d.case.stage !== 'suggestion'));

// ---- Reviews and decisions tab ----

const DEC_CLS: Record<string, string> = { approve: 'ok', waive: 'ok', escalate: 'ok', reject: 'bad', remediate: 'warn', await: 'warn', abstain: '' };
const FIRMABLE = ['approve', 'waive', 'remediate', 'reject', 'escalate'];
const DecChip = ({ v, labels }: { v?: Dict | null; labels: Record<string, string> }) => v && v.dec
  ? <span className={'chip ' + (DEC_CLS[v.dec] || '')}>{labels[v.dec] || v.dec}{FIRMABLE.includes(v.dec) ? (v.firm ? ', firm' : ', leaning') : ''}</span>
  : <span className="chip">No decision yet</span>;

/** Who holds what, what blocks, and what happens next. JavaScript reviewStatusHtml. */
function ReviewStatus({ d }: { d: CaseDetail }) {
  const { me, name, person } = useApp();
  const c = d.case, rv = d.review;
  if (!rv || !seesInternal(me.role)) return null;
  const X = c.stage === 'exec';
  const waitNames = (ids: string[]) => ids.map(id => {
    const k = (c.consults || []).find((x: Dict) => x.id === id); if (k) return name(k.personId);
    const a = (c.attestations || []).find((x: Dict) => 'a:' + x.controlId === id); return a ? name(a.personId) : '';
  }).filter(Boolean).join(', ');
  return (
    <div className="card"><h2>Where the decision stands</h2>
      <p className="small" style={{ margin: '0 0 8px' }}><span className={'chip ' + rv.status.cls}>{rv.status.chip}</span> {rv.status.text}</p>
      {(rv.blockers?.texts || []).length > 0 && <div className="callout warn" style={{ marginBottom: 8 }}><b>Holding up firm decisions</b><span>{rv.blockers.texts.join(' ')}</span></div>}
      <div className="tablewrap"><table><thead><tr><th>{X ? 'Executive' : 'Reviewer'}</th><th>Decision</th><th>Note</th></tr></thead><tbody>
        {(rv.pool || []).map((pid: string) => {
          const v = rv.votes.find((x: Dict) => x.personId === pid), n = (c.panelNotes || []).find((m: Dict) => m.by === pid);
          return <tr key={pid}><td>{name(pid)}<div className="muted small">{person(pid)?.title}</div></td><td><DecChip v={v} labels={d.decLabels} /></td>
            <td className="small">{n?.text}{v?.dec === 'await' && <div className="muted">Waiting on the required inputs{waitNames(v.awaitIds || []) ? ' and ' + waitNames(v.awaitIds || []) : ''}.</div>}</td></tr>;
        })}
      </tbody></table></div>
    </div>
  );
}

const STANCE: Record<string, [string, string]> = { support: ['ok', 'No concerns'], concerns: ['warn', 'Concerns'], serious: ['bad', 'Serious concern'], pending: ['', 'Pending'] };

/** Experts and stakeholders asked, with their status, and the panel notes. JavaScript consultHtml. */
function Consultation({ d }: { d: CaseDetail }) {
  const { me, name, person } = useApp();
  const c = d.case, ks: Dict[] = c.consults || [], notes: Dict[] = c.panelNotes || [], internal = seesInternal(me.role);
  if (!ks.length && !notes.length && c.stage !== 'panel') return null;
  return (
    <div className="card"><h2>Consultation <span className="chip auto">Requests and reminders are automated</span></h2>
      {ks.length ? <><div className="tablewrap"><table><thead><tr><th>Who</th><th>Role</th><th>Status</th></tr></thead><tbody>
        {ks.map(k => <tr key={k.id}><td>{name(k.personId)}<div className="muted small">{person(k.personId)?.title}</div>
          {k.prevId && <span className="chip">Second look</span>}{k.supersededBy && <span className="chip">Earlier response</span>}</td>
          <td>{k.kind === 'sme' ? 'Expert' : 'Stakeholder'}</td>
          <td>{k.status === 'pending' ? <><span className={'chip ' + (k.dueAt && k.dueAt < nowMs() ? 'bad' : 'warn')}>{k.kind === 'sme' ? 'Response required' : 'No reply yet'}{k.dueAt ? ', due ' + fdateShort(k.dueAt) : ''}</span>
            {k.reminders ? <div className="muted small">{k.reminders} reminder{k.reminders > 1 ? 's' : ''} sent</div> : null}</>
            : (internal || k.personId === me.id) && k.response ? <><span className={'chip ' + (STANCE[k.response.stance] || ['', k.response.stance])[0]}>{(STANCE[k.response.stance] || ['', k.response.stance])[1]}</span>
              <div className="small">{k.response.text}</div></> : <span className="chip ok">Responded</span>}</td></tr>)}
      </tbody></table></div>
        <p className="small muted" style={{ marginTop: 6 }}>A required expert response blocks approval. Silence from a process stakeholder never blocks.</p></>
        : <p className="muted">No consults requested yet. The lead can consult experts and notify stakeholders.</p>}
      {!(['panel', 'exec'].includes(c.stage) && internal) && <><h3 style={{ marginTop: 14 }}>Panel notes</h3>
        {!internal ? <p className="muted small" style={{ marginTop: 4 }}>Individual reviewer notes and expert responses are internal. The panel decision and its conditions are shown on the case, with the panel's summary for you.</p>
          : notes.length ? notes.map((n, i) => <p key={i} className="small" style={{ marginTop: 6 }}><b>{name(n.by)}</b> <DecChip v={{ dec: n.lean, firm: n.firm }} labels={d.decLabels} /> {n.text}</p>)
            : <p className="muted small" style={{ marginTop: 4 }}>No reviewer notes yet.</p>}</>}
    </div>
  );
}

/** The one-page pack the executives decide from. JavaScript briefingHtml. */
export function Briefing({ c }: { c: Dict }) {
  if (!c.briefing) return null;
  const b = c.briefing.data;
  const head = <><h2>Executive briefing</h2><p className="small muted" style={{ margin: '0 0 8px' }}>Prepared {fdateShort(c.briefing.at)}. A one-page summary for the decision.</p></>;
  if (!b) return <div className="card">{head}<dl className="dl">{(c.briefing.lines || []).map((l: string, i: number) => {
    const m = /^([^:]{2,40}): ([\s\S]*)$/.exec(l); return <span key={i} style={{ display: 'contents' }}><dt>{m ? m[1] : ''}</dt><dd>{m ? m[2] : l}</dd></span>;
  })}</dl></div>;
  const usd = (n: unknown) => '$' + (Number(n) || 0).toLocaleString('en-US');
  const people = (xs: Dict[]) => <div className="expl">{xs.map((x, i) => <div key={i} className="exrow"><span className={'chip ' + (STANCE[x.stance] || ['', ''])[0]}>{(STANCE[x.stance] || ['', x.stance])[1]}</span>
    <div><b>{x.title}</b> <span className="muted small">{x.name}</span>{x.text && <div className="small"><i>{x.text}</i></div>}</div></div>)}</div>;
  return (
    <div className="card">{head}<dl className="dl">
      <dt>Use case</dt><dd>{b.title} ({b.id})</dd><dt>Proposed solution</dt><dd>{b.solution}</dd>
      <dt>Tier</dt><dd><span className="small">Inherent risk is <b>{b.inherent}</b> <TierTag tier={b.tier} />. {b.supportedN} of {b.claimedN} claimed control{b.claimedN === 1 ? '' : 's'} supported,
        leaving a remaining risk of <b>{b.net == null ? '-' : b.net}</b> {b.netTier && <TierTag tier={b.netTier} />} after supported controls.</span></dd>
      <dt>Financials</dt><dd>
        <div className="finl"><span>Annual value</span><b>{usd(b.valueUSD)}</b></div><div className="finl"><span>One-time cost</span><b>{usd(b.costUSD)}</b></div>
        <div className="finl"><span>Ongoing cost</span><span><b>{usd(b.ongoingUSD)}</b> <span className="muted small">{b.ongoingBasis}</span></span></div>
        <div className="finl"><span>Paid from</span><b>{b.budgetSource}</b></div>
        <div className="finl"><span>3-year ROI</span><span>{b.roiReason ? b.roiReason : <><b className={b.roiNet < 0 ? 'neg' : 'pos'}>{b.roiPct == null ? 'Net ' + usd(b.roiNet) : (b.roiPct >= 0 ? '+' : '') + Math.round(b.roiPct * 100) + '% ROI'}</b> <span className="muted small">net {usd(b.roiNet)} after three years</span></>}</span></div>
        {b.budgetNote && <div className="small neg">{b.budgetNote}</div>}</dd>
      <dt>Minimum tier rules triggered</dt><dd>{(b.minTier || []).length ? b.minTier.join('; ') : 'None'}</dd>
      <dt>Expert responses</dt><dd>{(b.experts || []).length ? people(b.experts) : 'None requested.'}</dd>
      {(b.stakeholders || []).length > 0 && <><dt>Process stakeholder feedback</dt><dd>{people(b.stakeholders)}</dd></>}
      <dt>{b.escalated ? 'Panel escalation' : 'Panel recommendation'}</dt><dd><div className="exrow">{b.escalated ? <span className="chip">Escalated for your decision</span> : <span className="chip ok">Approve for pilot</span>}
        <div>{b.panelRec && <div className="small"><i>{b.panelRec}</i></div>}</div></div></dd>
    </dl></div>
  );
}

const PANEL_DEC: Record<string, string> = { approve: 'Approved for pilot. ', 'approve-waive': 'Approved, pilot waived. ', recommend: 'Recommended approval to executives. ', escalate: 'Escalated to the executives. ' };
const EXEC_DEC: Record<string, string> = { approve: 'Approved for pilot', 'approve-waive': 'Approved, pilot waived', remediate: 'Sent back for remediation', reject: 'Rejected' };

/** Owner sign-off, vetting, panel and executive decisions with their explanations. JavaScript decisionsHtml. */
function Decisions({ d }: { d: CaseDetail }) {
  const { boot, name } = useApp();
  const c = d.case;
  const ov = (x: Dict) => {
    const who = [...new Set((x.contributors || []).map((y: Dict) => y.by))].map(id => name(id as string));
    return (who.length > 1 ? ' Draft prepared by: ' + who.join(', ') + '.' : '')
      + ((x.overrides || []).length ? ` Accepted ${x.overrides.length} risk${x.overrides.length > 1 ? 's' : ''} as is: ${x.overrides.map((o: Dict) => o.label + ' (' + o.reason + ')').join('; ')}.` : '');
  };
  const rows: [string, string, number, string, number?][] = [];
  if (c.ownerAccepted && c.signoff?.status === 'accepted') rows.push(['Owner sign-off', c.ownerAccepted.by, c.ownerAccepted.at, 'Accepted ownership and submitted for triage.']);
  if (c.vetting) rows.push(['Vetting', c.vetting.by, c.vetting.at, (c.vetting.raisedTo ? 'Raised tier to ' + boot.tierLabels[c.vetting.raisedTo] + '. ' : '') + (c.vetting.note || 'No note.'), c.vetting.rv]);
  if (c.panelDecision) { const p = c.panelDecision; rows.push(['Panel decision', p.by, p.at, (PANEL_DEC[p.decision] || '') + (p.rationale || '')
    + (p.how === 'deadlock' ? ' The reviewers disagreed, and ' + name(p.by) + ' broke the deadlock.' : p.how === 'quorum' ? ' Decided with fewer reviewers than the usual quorum, because the others abstained. The lead waived the quorum.' : '') + ov(p), p.rv]); }
  if (c.execDecision) { const x = c.execDecision; rows.push(['Executive decision', x.by, x.at, (EXEC_DEC[x.decision] || x.decision) + '. ' + (x.rationale || '')
    + (x.how === 'deadlock' ? ' A deadlock among the executives was broken by ' + name(x.by) + '.' : '') + ov(x), x.rv]); }
  return (
    <>
      {c.briefing && c.stage !== 'exec' && <Briefing c={c} />}
      {rows.length > 0 && <div className="card"><h2>Decisions and explanations</h2><div>{rows.map((r, i) => <div key={i} className="tl"><div className="when">{fdateShort(r[2])}</div>
        <div><div className="what">{r[0]}, {name(r[1])}{r[4] ? <span className="muted small"> · rules v{r[4]}</span> : null}</div><div className="note">{r[3]}</div></div></div>)}</div></div>}
    </>
  );
}

/** Earlier rounds of review. The submitter sees each round's outcome, never the individual reviewers. JavaScript reviewHistoryHtml. */
function ReviewHistory({ d }: { d: CaseDetail }) {
  const { name } = useApp();
  const rs = d.rounds || [];
  if (!rs.length) return null;
  const how = (h: string) => h === 'deadlock' ? ' (deadlock broken)' : h === 'quorum' ? ' (quorum waived)' : '';
  return (
    <div className="card"><details><summary><b>Review history</b> <span className="muted small">{rs.length} round{rs.length > 1 ? 's' : ''}</span></summary>
      {rs.map((r: Dict) => <div key={r.n} style={{ marginTop: 10 }}>
        <h3>Round {r.n}: {r.kind === 'exec' ? 'executives' : 'panel'}, {fdateShort(r.at)}</h3>
        <p className="small"><b>{r.outcome}{how(r.how)}</b>{r.summary ? ' · ' + r.summary : ''} <span className="muted">({name(r.by)})</span></p>
        {r.votes && <>
          <div className="tablewrap"><table><thead><tr><th>Who</th><th>Decision</th><th>Note</th></tr></thead><tbody>
            {r.votes.map((x: Dict, i: number) => { const n = (r.notes || []).find((m: Dict) => m.by === x.by);
              return <tr key={i}><td>{name(x.by)}</td><td><DecChip v={x} labels={d.decLabels} /></td><td className="small">{n?.text}</td></tr>; })}</tbody></table></div>
          {r.terms && <details style={{ marginTop: 6 }}><summary className="small">Terms as they stood</summary><dl className="dl">
            {r.terms.scope && <><dt>Pilot</dt><dd>{r.terms.scope} (review in {r.terms.days} days)</dd></>}
            {r.terms.waiver && <><dt>Pilot waiver</dt><dd>{r.terms.waiver}</dd></>}
            <dt>KPIs</dt><dd>{(r.terms.measures || []).join('\n') || 'None'}</dd><dt>Conditions</dt><dd>{r.terms.limits || 'None'}</dd>
            <dt>Valid / production review</dt><dd>{r.terms.validDays} days / every {r.terms.prodDays} days</dd>
            {(r.terms.overrides || []).length > 0 && <><dt>Accepted risks</dt><dd>{r.terms.overrides.join('\n')}</dd></>}</dl></details>}
          <p className="small muted">{(r.changed || []).length ? 'Compared with today, changed: ' + r.changed.join(', ') + '.' : 'The terms today match this round.'}</p>
        </>}
      </div>)}
    </details></div>
  );
}

export function Reviews({ d }: { d: CaseDetail }) {
  return <><ReviewStatus d={d} /><Consultation d={d} /><Decisions d={d} /><ReviewHistory d={d} /></>;
}

// ---- Activity tab ----

export function Activity({ d }: { d: CaseDetail }) {
  const { name } = useApp();
  const audit = [...(d.case.audit || [])].reverse();
  const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return 'your browser time zone'; } })();
  return (
    <div className="card"><h2>Activity log <span className="row">{d.auditCheck.ok
      ? <span className="chip ok" title="Each entry carries the hash of the one before it. Nothing has been changed, removed or reordered.">Audit chain intact ({d.auditCheck.entries})</span>
      : <span className="chip bad" title={d.auditCheck.reason}>{ALERT} Audit trail broken at entry {d.auditCheck.brokenAt}</span>}
      <a href="#" className="small" onClick={e => { e.preventDefault(); go('audit', d.case.id); }}>Open in audit log</a></span></h2>
      <div>{audit.map((e: Dict, i: number) => <div key={i} className="tl" style={{ gridTemplateColumns: '150px minmax(0, 1fr)' }}>
        <div className="when">{fdatetime(e.ts)}<br />{ago(e.ts)}{ago(e.ts) === 'today' ? '' : ' ago'}</div>
        <div><div className="what">{e.action} {e.auto && <span className="chip auto">Automated</span>}</div>
          <div className="note"><b style={{ color: 'var(--ink)' }}>{e.actor === 'system' ? 'System (automated)' : name(e.actor)}</b>
            {e.note && <span style={{ borderLeft: '2px solid var(--line-2)', marginLeft: 8, paddingLeft: 8 }}>{e.note}</span>}</div></div></div>)}</div>
      <p className="small muted" style={{ marginTop: 8 }}>Times are shown in {tz}, the time zone of this browser.</p>
    </div>
  );
}
