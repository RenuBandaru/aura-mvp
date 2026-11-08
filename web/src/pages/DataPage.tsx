// Demo controls: run the reminder sweep (governance lead), reset to the sample data and the audit
// tamper demo (demo admin).

import { post } from '../api';
import { useApp } from '../state';
import { PageHead } from '../components/bits';

export function DataPage() {
  const { me, toast, changed } = useApp();
  const run = async (path: string, done: (r: any) => string) => {
    try { const r = await post(path); toast(done(r)); changed(); } catch (e: any) { toast(e.message, true); }
  };
  return (
    <>
      <PageHead title="Data and demo" sub="All data here is invented sample data." />
      <div className="stack" style={{ maxWidth: 760 }}>
        <div className="card"><h2>Reminder sweep</h2>
          <p className="muted" style={{ marginBottom: 10 }}>Sends the reminders that are due on cases under review, as the daily automated job would.</p>
          <button className="btn" disabled={!['lead', 'admin'].includes(me.role)} onClick={() => run('/admin/sweep', r => r.casesReminded ? `Reminders queued on ${r.casesReminded} case(s).` : 'No reminders were due.')}>Run reminder sweep</button>
        </div>
        <div className="card"><h2>Reset sample data</h2>
          <p className="muted" style={{ marginBottom: 10 }}>Throws away every change and rebuilds the 18 sample use cases as of now. Demo admin only.</p>
          <button className="btn danger" disabled={me.role !== 'admin'} onClick={() => window.confirm('Reset all data to the samples?') && run('/admin/reset', () => 'Sample data restored.')}>Reset to sample data</button>
          {me.role !== 'admin' && <p className="small muted" style={{ marginTop: 6 }}>Switch "Viewing as" to Demo admin to reset.</p>}
        </div>
        <div className="card"><h2>Tamper with the audit trail</h2>
          <p className="muted" style={{ marginBottom: 10 }}>Edits one old audit entry directly in the saved data, the way someone with database access might, without going through the engine. Then open the Audit log and press Verify audit trail to see the hash chain catch it. Demo admin only; reset to sample data afterwards.</p>
          <button className="btn danger" disabled={me.role !== 'admin'} onClick={() => run('/admin/tamper', r => `Entry ${r.entry} on ${r.caseId} was altered. Open the Audit log and run Verify audit trail.`)}>Alter one audit entry</button>
        </div>
      </div>
    </>
  );
}
