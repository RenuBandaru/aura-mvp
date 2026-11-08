// The Audit log: every action and decision on every case, who took it and why. Port of build 27's vAudit.
//
// The API does the real work (merging every case's trail, hiding reviewer notes, filtering, checking
// the hash chain). This page only keeps track of the filters the person picked and shows the answers.

import { useEffect, useState } from 'react';
import { downloadCsv, get, post } from '../api';
import { go, useApp } from '../state';
import type { AuditCheck, AuditPage as AuditPageData } from '../types';
import { PageHead, useLoad } from '../components/bits';
import { fdatetime } from '../format';

/** `caseId` comes from the address #/audit/UC-1012, used by the case page's "See in audit log" link. */
export function AuditPage({ caseId }: { caseId?: string }) {
  const { me, version, boot, toast } = useApp();

  // The filters. `who` is '' (everyone), 'auto', a case id or a person id, exactly what the API takes.
  const [who, setWho] = useState(caseId || '');
  const [typed, setTyped] = useState('');   // what is in the search box right now
  const [q, setQ] = useState('');           // what we last searched for (see the effect below)
  const [check, setCheck] = useState<AuditCheck | null>(null);

  // useState only reads caseId the first time. If the address changes while this page is open
  // (a case link, or the Audit log menu item), copy the new value into the filter.
  useEffect(() => { setWho(caseId || ''); }, [caseId]);

  // Wait until typing pauses for 300 ms before asking the API, instead of one request per key press.
  useEffect(() => {
    const t = window.setTimeout(() => setQ(typed.trim()), 300);
    return () => window.clearTimeout(t);
  }, [typed]);

  // Ask the API again whenever the person acting, the data (version) or a filter changes.
  const query = new URLSearchParams({ ...(who && { who }), ...(q && { q }) }).toString();
  const { data, error } = useLoad(() => get<AuditPageData>('/audit' + (query ? '?' + query : '')), [me.id, version, query]);

  // A check is a snapshot: once the data changes (another action, a reset), it no longer applies.
  useEffect(() => { setCheck(null); }, [version]);

  const verify = async () => {
    try { setCheck(await post<AuditCheck>('/audit/verify')); } catch (e: any) { toast(e.message, true); }
  };

  const exportCsv = async () => {
    try { await downloadCsv('/audit/export'); } catch (e: any) { toast(e.message, true); }
  };

  const people = boot.people.filter(p => p.role !== 'admin');
  return (
    <>
      <PageHead title="Audit log" sub="Every action and decision, who took it and why.">
        <button className="btn" onClick={verify}>Verify audit trail</button>
        <button className="btn" onClick={exportCsv}>Export CSV</button>
      </PageHead>

      {check && <CheckResult check={check} />}

      <div className="row" style={{ marginBottom: 12 }}>
        <input type="search" placeholder="Search the log" value={typed} onChange={e => setTyped(e.target.value)} aria-label="Search the log"
          style={{ padding: '7px 9px', border: '1px solid var(--line-2)', borderRadius: 6, minWidth: 240 }} />
        <select value={who} onChange={e => setWho(e.target.value)} aria-label="Actor" style={{ padding: '7px 9px', borderRadius: 6 }}>
          <option value="">All actors</option>
          <option value="auto">Automated only</option>
          {who.startsWith('UC-') && <option value={who}>Case {who}</option>}
          {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {error ? <div className="callout bad">{error}</div>
        : !data ? <p className="muted">Loading...</p>
        : data.entries.length === 0 ? <div className="empty">No entries match.</div>
        : <>
          <div className="tablewrap">
            <table>
              <thead><tr><th>When</th><th>Case</th><th>Actor</th><th>Action</th><th>Detail</th><th>Rules</th><th>Seal</th></tr></thead>
              <tbody>
                {data.entries.map(e => (
                  // A hash is unique to its entry, so it makes a good React key.
                  <tr key={e.hash || e.caseId + e.ts} className="click" onClick={() => go('case', e.caseId)}>
                    <td className="small" style={{ whiteSpace: 'nowrap' }}>{fdatetime(e.ts)}</td>
                    <td className="mono" style={{ whiteSpace: 'nowrap' }}>{e.caseId}</td>
                    <td>{e.auto ? <span className="chip">Automated</span> : e.actorName}</td>
                    <td>{e.action}</td>
                    <td className="muted small">{e.note}</td>
                    <td className="small">{e.rv ? 'v' + e.rv : ''}</td>
                    <td className="mono muted" title={e.hash}>{(e.hash || '').slice(0, 8)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.total > data.entries.length &&
            <p className="muted small" style={{ marginTop: 8 }}>Showing the latest {data.entries.length} of {data.total.toLocaleString('en-US')}. Export for the rest.</p>}
        </>}
    </>
  );
}

/** The green or red box after "Verify audit trail". JavaScript auditCheckBox. */
function CheckResult({ check }: { check: AuditCheck }) {
  const bad = check.results.filter(r => !r.ok);
  const entries = check.results.reduce((n, r) => n + r.entries, 0);
  const when = fdatetime(check.at);
  if (bad.length) {
    return (
      <div className="callout bad" style={{ marginBottom: 12 }}>
        <b>The audit trail does not check out</b>
        {bad.map(r => <span key={r.id}>{r.id}: entry {r.brokenAt} of {r.entries}. {r.reason}</span>)}
        <span className="muted small">Checked {check.results.length} cases at {when}. Reset to sample data restores a clean trail.</span>
      </div>
    );
  }
  return (
    <div className="callout ok" style={{ marginBottom: 12 }}>
      <b>Audit trail intact</b>
      <span>{entries} entries across {check.results.length} cases checked at {when}. Every entry matches its hash and the one before it, and every decision points at a real entry.</span>
    </div>
  );
}
