// The Dashboard: where cases are, how long they wait and how they end. Port of build 27's vDash.
//
// The API works out every number (GET /api/dashboard). This file only draws them: a gauge, four big
// figures with their goals, bar charts made of plain <div>s sized by percentage, and a few lists.

import { useState } from 'react';
import { downloadCsv, get } from '../api';
import { go, useApp } from '../state';
import type { DashboardData, Goal } from '../types';
import { PageHead, TierChip, useLoad } from '../components/bits';
import { ago } from '../format';

const TIER_ORDER: [string, string][] = [['low', 'Low'], ['moderate', 'Moderate'], ['high', 'High'], ['critical', 'Critical'], ['none', 'Not scored']];
const pct = (n: number, of: number) => (of ? (n / of) * 100 : 0) + '%';

export function DashboardPage() {
  const { me, version, toast } = useApp();
  const [exDays, setExDays] = useState(180);          // the period for "Exceptions accepted at approval"
  const [exOpen, setExOpen] = useState<string | null>(null); // which exceptions bar is opened
  const { data, error } = useLoad(() => get<DashboardData>('/dashboard?exDays=' + exDays), [me.id, version, exDays]);

  const save = (path: string) => downloadCsv(path).catch((e: any) => toast(e.message, true));

  if (error) return <div className="callout bad">{error}</div>;
  if (!data) return <p className="muted">Loading...</p>;
  const k = data.kpis;
  const maxStage = Math.max(1, ...data.pipeline.map(s => s.total));
  const maxBack = Math.max(1, ...data.sentBackAt.map(s => s.count));
  const rejectedTotal = data.rejected.reduce((n, r) => n + r.count, 0);

  return (
    <>
      <PageHead title="Dashboard" sub="Where cases are, how long they wait and how they end.">
        <button className="btn" onClick={() => save('/cases/export')}>Export cases CSV</button>
        <button className="btn" onClick={() => save('/audit/export')}>Export audit CSV</button>
      </PageHead>

      <div className="stack">
        <div className="kpihead">
          <Gauge open={k.open} inReview={k.inReview} overdue={k.overdue} alerts={k.alerts} />
          <div className="kpi3">
            <BigFigure icon="cal" value={k.avgDays.value ?? '-'} unit="days" label="Average time to a final outcome" goal={k.avgDays.goal} />
            <BigFigure icon="check" value={k.reachProd.pct} unit="%" label="Reaching production" goal={k.reachProd.goal} />
            <BigFigure icon="back" value={k.sentBack.pct} unit="%" label="Sent back at least once" goal={k.sentBack.goal} />
            <BigFigure icon="coin" value={k.value.text} unit="a year" label="Estimated value in pilot and production" goal={k.value.goal} />
          </div>
        </div>

        {data.training && (
          <div className="card"><h2>Training completion</h2>
            <div className="tablewrap"><table>
              <thead><tr><th>Training</th><th>Current</th><th>Due soon</th><th>Not done or overdue</th></tr></thead>
              <tbody>{data.training.map(t => (
                <tr key={t.id} className="click" onClick={() => go('training')}>
                  <td>{t.title} {t.requiredToSubmit && <span className="chip">Required to submit</span>}</td>
                  <td>{t.ok} of {t.applies}</td><td>{t.soon}</td><td>{t.notDone}</td>
                </tr>))}
              </tbody>
            </table></div>
          </div>
        )}

        <div className="card">
          <h2>Production alerts <span className={'chip ' + (data.alerts.length ? 'bad' : 'ok')}>{data.alerts.length}</span></h2>
          {data.alerts.length ? <>
            <div className="tablewrap"><table><tbody>{data.alerts.map(a => (
              <tr key={a.id} className="click" onClick={() => go('case', a.id)}>
                <td><div className="title">{a.title}</div><div className="muted small">{a.id}, {a.stageLabel}</div></td>
                <td>{a.items.map(i => <div key={i} className="small">⚠ {i}</div>)}</td>
                <td><TierChip tier={a.tier} label={a.tierLabel} /></td>
              </tr>))}
            </tbody></table></div>
            <p className="small muted" style={{ marginTop: 6 }}>Every alert is flagged on its case and waits in the governance lead's queue. Nothing is stopped automatically.</p>
          </> : <p className="muted">No stop limits passed and no approvals expired.</p>}
        </div>

        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2>Exceptions accepted at approval</h2>
            <select value={exDays} onChange={e => { setExDays(Number(e.target.value)); setExOpen(null); }} aria-label="Time period" style={{ padding: '6px 8px', borderRadius: 6 }}>
              {data.exceptions.periods.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <p className="muted small" style={{ margin: '2px 0 8px' }}>Open items that approvers accepted as they were, by the control or expert type behind them. Select a bar to list the cases.</p>
          {data.exceptions.rows.length ? (() => {
            const mx = Math.max(1, ...data.exceptions.rows.map(r => r.total));
            const used = data.exceptions.kinds.filter(([kind]) => data.exceptions.rows.some(r => r.kinds[kind]));
            const open = data.exceptions.rows.find(r => r.head === exOpen);
            return <>
              <div className="bars">{data.exceptions.rows.map(r => (
                // A <button> rather than a clickable <div>, so it works with the keyboard too.
                <button key={r.head} type="button" className={'bar exbar' + (r.head === exOpen ? ' on' : '')} aria-pressed={r.head === exOpen}
                  onClick={() => setExOpen(r.head === exOpen ? null : r.head)}>
                  <span>{r.head}</span>
                  <div className="track">{data.exceptions.kinds.map(([kind, label]) => r.kinds[kind]
                    ? <span key={kind} className={'seg exk-' + kind} style={{ width: pct(r.kinds[kind], mx) }} title={`${r.kinds[kind]} ${label}`} /> : null)}</div>
                  <span className="n">{r.total}</span>
                </button>))}
              </div>
              <div className="legend">{used.map(([kind, label]) => <span key={kind}><i className={'exk-' + kind} />{label}</span>)}</div>
              {open && <><h3 style={{ marginTop: 12 }}>{open.head}</h3>
                <div className="tablewrap"><table><tbody>{open.cases.map(c => (
                  <tr key={c.id} className="click" onClick={() => go('case', c.id)}>
                    <td><div className="title">{c.title}</div><div className="muted small">{c.id}</div></td>
                    <td><TierChip tier={c.tier} label={c.tierLabel} /></td><td className="small">{c.stageLabel}</td>
                  </tr>))}
                </tbody></table></div></>}
            </>;
          })() : <p className="muted">No exceptions accepted in this period.</p>}
        </div>

        <div className="grid2">
          <div className="card"><h2>Pipeline by stage</h2>
            <div className="bars">{data.pipeline.map(s => (
              <div key={s.stage} className="bar"><span>{s.label}</span>
                <div className="track">{TIER_ORDER.map(([t, label]) => s.tiers[t]
                  ? <span key={t} className={'seg ' + t} style={{ width: pct(s.tiers[t], maxStage) }} title={`${s.tiers[t]} ${label}`} /> : null)}</div>
                <span className="n">{s.total}</span>
              </div>))}
            </div>
            <div className="legend">{TIER_ORDER.map(([t, label]) => <span key={t}><i className={'seg ' + t} />{label}</span>)}</div>
          </div>

          <div className="card"><h2>Where cases get sent back</h2>
            {data.sentBackAt.length ? <div className="bars">{data.sentBackAt.map(s => (
              <div key={s.label} className="bar"><span>{s.label}</span>
                <div className="track"><span className="seg moderate" style={{ width: pct(s.count, maxBack) }} /></div>
                <span className="n">{s.count}</span>
              </div>))}
            </div> : <p className="muted">Nothing sent back yet.</p>}
            <h3 style={{ marginTop: 16 }}>Rejected cases</h3>
            <p className="muted small" style={{ marginTop: 4 }}>
              {rejectedTotal ? data.rejected.map(r => `${r.count} rejected at ${r.label}`).join(', ')
                + (rejectedTotal === 1 ? '. This case left the process and can be returned to the suggestion box by its submitter.'
                  : '. These left the process and can be returned to the suggestion box by their submitters.') : 'None.'}
            </p>
          </div>
        </div>

        <div className="grid2">
          <div className="card"><h2>Most overdue</h2>
            {data.mostOverdue.length ? <>
              <div className="tablewrap"><table><tbody>{data.mostOverdue.map(c => (
                <tr key={c.id} className="click" onClick={() => go('case', c.id)}>
                  <td><div className="title">{c.title}</div><div className="muted small">{c.stageLabel}</div></td>
                  <td><span className="chip bad">{c.daysOverdue}d overdue</span></td>
                </tr>))}
              </tbody></table></div>
              <p className="small muted" style={{ marginTop: 6 }}>Any stage, ranked by days past the due date.</p>
            </> : <p className="muted">Nothing is overdue.</p>}
          </div>

          <div className="card"><h2>Recent activity</h2>
            <div>{data.recent.map(a => (
              <div key={a.hash || a.caseId + a.ts} className="tl">
                <div className="when">{ago(a.ts) === 'today' ? 'today' : ago(a.ts) + ' ago'}</div>
                <div><div className="what">{a.action}</div><div className="note">{a.caseTitle}, {a.actorName}</div></div>
              </div>))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/** The half-circle gauge: open cases, and how many of them are in review or pilot. JavaScript gaugeCard. */
function Gauge({ open, inReview, overdue, alerts }: { open: number; inReview: number; overdue: DashboardData['kpis']['overdue']; alerts: number }) {
  // The arc is a half circle of radius 80, so its length is pi * 80. Drawing only the first part of it
  // (stroke-dasharray "filled total") shows the in-review share without any chart library.
  const L = Math.PI * 80, filled = open ? (inReview / open) * L : 0;
  return (
    <div className="card gauge"><h2>Open cases</h2>
      <svg viewBox="0 0 200 112" role="img" aria-label={`${open} open cases, ${inReview} of them in review or pilot`}>
        <path d="M20 100 A80 80 0 0 1 180 100" fill="none" stroke="var(--tint)" strokeWidth="24" />
        {inReview > 0 && <path d="M20 100 A80 80 0 0 1 180 100" fill="none" stroke="var(--brand)" strokeWidth="24" strokeDasharray={`${filled.toFixed(2)} ${L.toFixed(2)}`} />}
        <text x="100" y="92" textAnchor="middle" className="gnum">{open}</text>
        <text x="100" y="109" textAnchor="middle" className="glab">open cases</text>
      </svg>
      <div className="glegend">
        <span><i style={{ background: 'var(--brand)' }} />{inReview} in review or pilot</span>
        <span><i style={{ background: 'var(--tint)' }} />{open - inReview} not yet in review</span>
      </div>
      <div className="kpirow2">
        <div className={'kpi' + (overdue.count ? ' alert' : '')}>
          <div className={'v' + goalClass(overdue.goal)}>{overdue.pct}<small>%</small></div>
          <div className="l">Overdue ({overdue.count} of {open} open)</div>
          {overdue.goal && <div className="goal">Goal: {overdue.goal.text}</div>}
        </div>
        <div className={'kpi' + (alerts ? ' alert' : '')}><div className="v">{alerts}</div><div className="l">Production alerts</div></div>
      </div>
    </div>
  );
}

/** Green when a figure meets its goal, red when it does not, plain when there is no goal or no data. */
const goalClass = (g: Goal | null) => (!g || g.met === null ? '' : g.met ? ' ok' : ' bad');

const ICONS: Record<string, JSX.Element> = {
  cal: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /><circle cx="12" cy="15.5" r="2.6" /></>,
  check: <><circle cx="12" cy="12" r="9" /><path d="M8 12.5l3 3 5-6" /></>,
  coin: <><circle cx="12" cy="12" r="9" /><path d="M14.8 9.2c-.4-1-1.4-1.6-2.8-1.6-1.6 0-2.7.8-2.7 2 0 3 5.6 1.4 5.6 4.3 0 1.2-1.2 2.1-2.9 2.1-1.5 0-2.6-.7-3-1.8M12 6.5v1.1M12 16.4v1.1" /></>,
  back: <><path d="M9 14L4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></>,
};

function BigFigure({ icon, value, unit, label, goal }: { icon: string; value: string | number; unit: string; label: string; goal: Goal | null }) {
  return (
    <div className="kpi big">
      <span className="ico" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{ICONS[icon]}</svg>
      </span>
      <div>
        <div className={'v' + goalClass(goal)}>{value}<small>{unit}</small></div>
        <div className="l">{label}</div>
        {goal && <div className="goal">Goal: {goal.text}</div>}
      </div>
    </div>
  );
}
