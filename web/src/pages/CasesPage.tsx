// All use cases, newest first, with search, stage and tier filters, CSV export and a New suggestion button.
// Port of build 27's vCases.

import { useState } from 'react';
import { downloadCsv, get } from '../api';
import { go, useApp } from '../state';
import type { CaseRow } from '../types';
import { CaseTable, PageHead, useLoad } from '../components/bits';

export function CasesPage() {
  const { me, version, boot, name, toast } = useApp();
  const { data, error } = useLoad(() => get<CaseRow[]>('/cases'), [me.id, version]);
  const [q, setQ] = useState('');
  const [stage, setStage] = useState('all');
  const [tier, setTier] = useState('all');
  if (error) return <div className="callout bad">{error}</div>;
  const byNum = (x: CaseRow) => Number(x.id.slice(3)) || 0;
  const rows = [...(data || [])].sort((a, b) => byNum(b) - byNum(a))
    .filter(r => (stage === 'all' || r.stage === stage) && (tier === 'all' || r.tier === tier)
      && (!q || (r.id + ' ' + r.title + ' ' + name(r.submitterId)).toLowerCase().includes(q.toLowerCase())));
  const canCreate = !['admin', 'auditor'].includes(me.role);
  return (
    <>
      <PageHead title="Use cases" sub={data ? `${data.length} in the system` : ''}>
        <button className="btn" onClick={() => downloadCsv('/cases/export').catch(e => toast(e.message, true))}>Export CSV</button>
        {canCreate && <button className="btn accent" onClick={() => go('new')}>New suggestion</button>}
      </PageHead>
      <div className="filters">
        <input type="search" placeholder="Search by title, ID or submitter" value={q} onChange={e => setQ(e.target.value)} aria-label="Search use cases" />
        <select value={stage} onChange={e => setStage(e.target.value)} aria-label="Stage">
          <option value="all">All stages</option>
          {boot.stages.map(s => <option key={s} value={s}>{boot.stageLabels[s]}</option>)}
        </select>
        <select value={tier} onChange={e => setTier(e.target.value)} aria-label="Tier">
          <option value="all">All tiers</option>
          {Object.entries(boot.tierLabels).map(([t, l]) => <option key={t} value={t}>{l}</option>)}
        </select>
      </div>
      {!data ? <p className="muted">Loading...</p> : rows.length ? <CaseTable rows={rows} onOpen={id => go('case', id)} /> : <div className="empty">No use cases match these filters.</div>}
    </>
  );
}
