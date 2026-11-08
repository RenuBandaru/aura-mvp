// All use cases, with a search box and a stage filter. Port of build 27's vCases (simplified).

import { useState } from 'react';
import { get } from '../api';
import { go, useApp } from '../state';
import type { CaseRow } from '../types';
import { CaseTable, PageHead, useLoad } from '../components/bits';

export function CasesPage() {
  const { me, version, boot } = useApp();
  const { data, error } = useLoad(() => get<CaseRow[]>('/cases'), [me.id, version]);
  const [q, setQ] = useState('');
  const [stage, setStage] = useState('');
  if (error) return <div className="callout bad">{error}</div>;
  const rows = (data || []).filter(r => (!stage || r.stage === stage) && (!q || (r.id + ' ' + r.title).toLowerCase().includes(q.toLowerCase())));
  return (
    <>
      <PageHead title="Use cases" sub={data ? `${rows.length} of ${data.length}` : ''} />
      <div className="row" style={{ marginBottom: 12 }}>
        <input type="search" placeholder="Search by ID or title" value={q} onChange={e => setQ(e.target.value)} aria-label="Search use cases"
          style={{ padding: '7px 9px', border: '1px solid var(--line-2)', borderRadius: 6, minWidth: 240 }} />
        <select value={stage} onChange={e => setStage(e.target.value)} aria-label="Stage" style={{ padding: '7px 9px', borderRadius: 6 }}>
          <option value="">All stages</option>
          {boot.stages.map(s => <option key={s} value={s}>{boot.stageLabels[s]}</option>)}
        </select>
      </div>
      {data ? <CaseTable rows={rows} onOpen={id => go('case', id)} /> : <p className="muted">Loading...</p>}
    </>
  );
}
