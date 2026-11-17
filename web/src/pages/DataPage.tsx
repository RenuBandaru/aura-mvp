// Data and demo (demo admin only): imports and backups, and the demo controls (reset to the sample data,
// the demo clock, audit tamper), with recent admin events and how data is stored. Build 27's vData. Every check on an imported file happens in the API;
// a file with any bad row changes nothing, and the rows to fix are listed here.

import { useState } from 'react';
import { downloadCsv, get, post, readText, saveText } from '../api';
import { useApp } from '../state';
import { fdatetime } from '../format';
import { PageHead, useLoad } from '../components/bits';

interface AdminInfo { clockOffsetMs: number; adminLog: { at: number; by: string; what: string }[]; storage: 'file' | 'memory'; sampleCases: number }
interface ImportResult { applied: boolean; errors?: string[]; moreErrors?: number; added?: number; updated?: number; removed?: number; ruleGaps?: string[]; ids?: string[]; skippedColumns?: string[] }

export function DataPage() {
  const { me, toast, changed, reloadBoot, boot, version, name } = useApp();
  const admin = me.role === 'admin';
  const { data: info, reload } = useLoad(() => get<AdminInfo>('/admin/info'), [me.id, version]);
  const [peopleFile, setPeopleFile] = useState<File | null>(null);
  const [mode, setMode] = useState('merge');
  const [casesFile, setCasesFile] = useState<File | null>(null);
  const [fallback, setFallback] = useState('');
  const [backupFile, setBackupFile] = useState<File | null>(null);
  const [result, setResult] = useState<{ what: string; r: ImportResult } | null>(null);

  const run = async (path: string, done: (r: any) => string, body: unknown = {}) => {
    try { const r = await post(path, body); toast(done(r)); changed(); reloadBoot(); reload(); } catch (e: any) { toast(e.message, true); }
  };
  const fail = (e: any) => toast(e.message, true);

  const importPeople = async () => {
    if (!peopleFile) return;
    try {
      const r = await post<ImportResult>('/admin/people/import', { csv: await readText(peopleFile), mode });
      setResult({ what: 'people', r });
      if (r.applied) { toast(`People imported: ${r.added} added, ${r.updated} updated${r.removed ? `, ${r.removed} removed` : ''}.`); reloadBoot(); changed(); reload(); }
    } catch (e: any) { fail(e); }
  };
  const importCases = async () => {
    if (!casesFile) return;
    try {
      const r = await post<ImportResult>('/admin/cases/import', { csv: await readText(casesFile), defaultSubmitter: fallback || undefined });
      setResult({ what: 'use cases', r });
      if (r.applied) { toast(`${r.added} use case(s) logged as suggestions.`); changed(); reload(); }
    } catch (e: any) { fail(e); }
  };
  const backup = async () => {
    try { const { filename, json } = await get<{ filename: string; json: string }>('/admin/backup'); saveText(filename, json, 'application/json'); } catch (e: any) { fail(e); }
  };
  const restore = async () => {
    if (!backupFile || !window.confirm('Replace ALL data with this backup? Make a backup of the current data first if you may need it.')) return;
    run('/admin/restore', r => `Backup restored: ${r.cases} use case(s), ${r.people} people.`, { data: await readText(backupFile) });
  };
  const days = Math.round((info?.clockOffsetMs || 0) / 86400000);
  const submitters = boot.people.filter(p => !['admin', 'auditor'].includes(p.role));

  return (
    <>
      <PageHead title="Data and demo" sub="Load your own people and use cases, keep backups, and run the demo controls." />
      <div className="stack" style={{ maxWidth: 820 }}>
        {!admin && <div className="callout warn">Switch "Viewing as" to the Demo admin to import, back up or reset data.</div>}

        <div className="card"><h2>1. Import people</h2>
          <p className="muted" style={{ marginBottom: 10 }}>A CSV with the columns Name, Email, Role, Business unit and Title or area. People are matched by email, then name: existing people are updated, new ones added. Everyone appears in "Viewing as". You can also add people one at a time on the <a href="#/people">People</a> page.</p>
          <div className="row">
            <button className="btn" disabled={!admin} onClick={() => downloadCsv('/admin/people/template').catch(fail)}>Download template</button>
            <button className="btn" disabled={!admin} onClick={() => downloadCsv('/admin/people/export').catch(fail)}>Export current people</button>
          </div>
          <div className="field" style={{ marginTop: 10 }}><label htmlFor="imp_people">People CSV file</label>
            <input id="imp_people" type="file" accept=".csv,text/csv" disabled={!admin} onChange={e => setPeopleFile(e.target.files?.[0] || null)} /></div>
          <div className="field"><span className="lab">What to do with people not in the file</span>
            <label className="small"><input type="radio" name="imp_mode" checked={mode === 'merge'} onChange={() => setMode('merge')} /> Keep them</label>
            <label className="small"><input type="radio" name="imp_mode" checked={mode === 'replace'} onChange={() => setMode('replace')} /> Remove them (the Demo admin always stays; anyone named on a use case must stay)</label>
          </div>
          <button className="btn primary" disabled={!admin || !peopleFile} onClick={importPeople}>Import people</button>
        </div>

        <div className="card"><h2>2. Import use cases</h2>
          <p className="muted" style={{ marginBottom: 10 }}>A CSV with a Title column. Every other column is optional: ID, Description, Submitter email and Business unit, and any of the use case form's fields, such as Owner email, Problem to solve, costs, value and a KPI. The template lists them all. Each row is logged as a new suggestion from its submitter, with those fields filled in, and their adviser is told. An ID such as UC-03 is kept. To give a use case more KPIs, add a row under it with only the KPI columns filled. Risk answers, data readiness and controls are answered later in the form.</p>
          <button className="btn" disabled={!admin} onClick={() => downloadCsv('/admin/cases/template').catch(fail)}>Download template</button>
          <div className="grid2" style={{ marginTop: 10 }}>
            <div className="field"><label htmlFor="imp_cases">Use case CSV file</label>
              <input id="imp_cases" type="file" accept=".csv,text/csv" disabled={!admin} onChange={e => setCasesFile(e.target.files?.[0] || null)} /></div>
            <div className="field"><label htmlFor="imp_fallback">Log rows with no submitter as</label>
              <select id="imp_fallback" value={fallback} disabled={!admin} onChange={e => setFallback(e.target.value)}>
                <option value="">Nobody (such rows are refused)</option>
                {submitters.map(p => <option key={p.id} value={p.id}>{p.name}, {p.roleLabel}</option>)}</select></div>
          </div>
          <button className="btn primary" disabled={!admin || !casesFile} onClick={importCases}>Import use cases</button>
        </div>

        {result && <div className={'callout ' + (result.r.applied ? 'ok' : 'bad')} role="status">
          {result.r.applied
            ? <b>Imported {result.what}.{result.r.ids ? ' New: ' + result.r.ids.join(', ') + '.' : ''}</b>
            : <><b>Nothing was imported. Fix these rows in the file and try again:</b>
              <ul style={{ margin: '4px 0 0 18px' }}>{(result.r.errors || []).map(e => <li key={e}>{e}</li>)}</ul>
              {!!result.r.moreErrors && <span>And {result.r.moreErrors} more.</span>}</>}
          {!!result.r.skippedColumns?.length && <div className="small">These columns were not recognized, so {result.r.applied ? 'their values were not imported' : 'they will be skipped'}: {result.r.skippedColumns.join(', ')}. Check the heading spelling against the template.</div>}
          {result.r.applied && !!result.r.ruleGaps?.length && <><b>Next, update the rules:</b>
            <ul style={{ margin: '4px 0 0 18px' }}>{result.r.ruleGaps.map(g => <li key={g}>{g}</li>)}</ul></>}
        </div>}

        <div className="card"><h2>Remove sample use cases and tools</h2>
          <p className="muted" style={{ marginBottom: 10 }}>Deletes every use case, AI tool and uploaded file, so only your imported ones remain. People, rules and training records stay. Back up first.</p>
          <button className="btn danger" disabled={!admin} onClick={() => window.confirm('Delete every use case and AI tool?') && run('/admin/clear', r => `${r.removed} use case(s) removed.`)}>Remove use cases and tools</button>
        </div>

        <div className="card"><h2>Backup</h2>
          <p className="muted" style={{ marginBottom: 10 }}>Everything (people, use cases, tools, rules and versions) as one file. Keep it somewhere approved for this data, such as BWC OneDrive, and never in GitHub.</p>
          <div className="row">
            <button className="btn" disabled={!admin} onClick={backup}>Download backup</button>
            <input type="file" aria-label="Backup file to restore" accept=".json,application/json" disabled={!admin} onChange={e => setBackupFile(e.target.files?.[0] || null)} />
            <button className="btn danger" disabled={!admin || !backupFile} onClick={restore}>Restore backup</button>
          </div>
        </div>

        <div className="card"><h2>Reset to sample data</h2>
          <p className="muted" style={{ marginBottom: 10 }}>Throws away every change, including imported people and use cases, and rebuilds the sample people and {info?.sampleCases ?? 18} sample use cases as of now, with the demo clock back at today. Download a backup first if you need your data.</p>
          <button className="btn danger" disabled={!admin} onClick={() => window.confirm('Reset ALL data, including imported people and use cases, to the samples?') && run('/admin/reset', () => 'Sample data restored.')}>Reset to sample data</button>
        </div>
        <div className="card"><h2>Tamper with the audit trail</h2>
          <p className="muted" style={{ marginBottom: 10 }}>Edits one old audit entry directly in the saved data, the way someone with database access might, without going through the engine. Then open the Audit log and press Verify audit trail to see the hash chain catch it. Demo admin only. Use it only on the sample data, never once real use cases are loaded, then reset.</p>
          <button className="btn danger" disabled={!admin} onClick={() => run('/admin/tamper', r => `Entry ${r.entry} on ${r.caseId} was altered. Open the Audit log and run Verify audit trail.`)}>Alter one audit entry</button>
        </div>
        <div className="card"><h2>Demo clock</h2>
          <p className="muted" style={{ marginBottom: 10 }}>Moves time forward for everyone, to show overdue items and reminders without waiting. Currently {days} day{days === 1 ? '' : 's'} ahead. Due dates on real cases move too, so reset the clock when the demo is over.</p>
          <div className="row">{[1, 3, 7].map(n => <button key={n} className="btn" disabled={!admin} onClick={() => run('/admin/clock', () => 'Demo clock moved.', { days: n })}>+{n} day{n > 1 ? 's' : ''}</button>)}
            <button className="btn ghost" disabled={!admin || !days} onClick={() => run('/admin/clock', () => 'Demo clock reset.', { days: 0 })}>Reset clock</button></div>
        </div>
        <div className="card"><h2>Admin events</h2>
          {info?.adminLog.length ? info.adminLog.map((x, i) => <div key={i} className="tl"><div className="when">{fdatetime(x.at)}</div>
            <div><div className="what">{x.what}</div><div className="note">{name(x.by)}</div></div></div>)
            : <p className="muted">No imports, restores or resets yet.</p>}
        </div>
        <div className="card"><h2>Storage</h2>
          <p>{info?.storage === 'file' ? 'Saved to a file on the server. Everyone with access sees the same data, and changes are kept when the server restarts.'
            : 'Kept in memory on the server. Everyone with access sees the same data, but changes are lost when the server restarts.'}</p>
        </div>
      </div>
    </>
  );
}
