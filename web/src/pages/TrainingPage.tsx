// Training: the courses that apply to me, marking one done, and (for the governance lead, auditor and
// demo admin) who has completed what. Port of build 27's vTraining.
//
// The API decides everything here: which courses apply, each one's state, who may mark or remind.
// This page shows the answer and sends the two button presses back.

import { get, post } from '../api';
import { useApp } from '../state';
import type { TrainingCard, TrainingPageData, TrainingState } from '../types';
import { PageHead, useLoad } from '../components/bits';
import { fdate } from '../format';

/** The colored chip for a state. JavaScript trainChip. */
const CHIP: Record<TrainingState, [string, string]> = {
  current: ['ok', 'Current'], soon: ['warn', 'Due soon'], due: ['bad', 'Not completed'], overdue: ['bad', 'Overdue'],
};
export const StateChip = ({ state }: { state: TrainingState }) => <span className={'chip ' + CHIP[state][0]}>{CHIP[state][1]}</span>;

export function TrainingPage() {
  const { me, version, changed, toast } = useApp();
  const { data, error } = useLoad(() => get<TrainingPageData>('/training'), [me.id, version]);

  // Both buttons follow the same pattern as every change in the app: ask the API, then call
  // changed() so this page, the menu badge and anything else showing training reloads.
  const complete = async (t: TrainingCard) => {
    try { await post('/training/' + t.id + '/complete'); toast('Training recorded.'); changed(); }
    catch (e: any) { toast(e.message, true); }
  };
  const remind = async () => {
    try {
      const r = await post<{ peopleReminded: number }>('/training/remind');
      toast(r.peopleReminded ? `Reminders queued for ${r.peopleReminded} ${r.peopleReminded === 1 ? 'person' : 'people'}.` : 'Nobody has training due.');
      changed();
    } catch (e: any) { toast(e.message, true); }
  };

  if (error) return <div className="callout bad">{error}</div>;
  if (!data) return <p className="muted">Loading...</p>;
  return (
    <>
      <PageHead title="Training" sub="Completion is recorded here by you. A training marked required must be current before you can submit a use case." />
      <div className="stack">
        {data.mine.length === 0 && <div className="empty">No training applies to you.</div>}
        {data.mine.map(t => <Course key={t.id} t={t} canMark={data.canMark} onComplete={() => complete(t)} />)}

        {data.matrix && (
          <div className="card">
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
              <h2>Who has completed what</h2>
              {data.canRemind && <button className="btn" onClick={remind}>Send reminders for due or overdue training</button>}
            </div>
            <div className="tablewrap">
              <table>
                <thead><tr><th>Person</th><th>Business unit</th>{data.matrix.trainings.map(t => <th key={t.id}>{t.title}</th>)}</tr></thead>
                <tbody>
                  {data.matrix.rows.map(r => (
                    <tr key={r.id}>
                      <td>{r.name}<div className="muted small">{r.title}</div></td>
                      <td className="small">{r.unit}</td>
                      {data.matrix!.trainings.map(t => {
                        const st = r.states[t.id];
                        // null means the course does not apply to this person's role
                        return <td key={t.id}>{st ? <StateChip state={st} /> : <span className="muted">-</span>}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

/** One course card. Kept as its own component so the page above stays readable. */
function Course({ t, canMark, onComplete }: { t: TrainingCard; canMark: boolean; onComplete: () => void }) {
  const stuck = t.contact && (t.state === 'due' || t.state === 'overdue');
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <b>{t.title}</b>
        <span className="row">{t.requiredToSubmit && <span className="chip">Required to submit</span>}<StateChip state={t.state} /></span>
      </div>
      {t.summary && <p className="small" style={{ margin: '6px 0' }}>{t.summary}</p>}
      <p className="muted small">
        {t.completedAt
          ? `Completed ${fdate(t.completedAt)} (version ${t.completedVersion}). Valid until ${fdate(t.validUntil)}. Refreshed every ${t.refreshMonths} months.`
          : `Not completed yet. Refreshed every ${t.refreshMonths} months.`}
      </p>
      <div className="row" style={{ marginTop: 8 }}>
        {/* rel="noopener noreferrer" stops the opened page from controlling this one */}
        {t.link && <a className="btn" href={t.link} target="_blank" rel="noopener noreferrer">Open the training</a>}
        {canMark && t.state !== 'current' && <button className="btn primary" onClick={onComplete}>I completed this</button>}
      </div>
      {stuck && <p className="small" style={{ marginTop: 8 }}>Blocked or stuck? Contact {t.contact}.</p>}
    </div>
  );
}
