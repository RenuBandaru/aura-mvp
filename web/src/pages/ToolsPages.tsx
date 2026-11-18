// The AI tool catalog (B-06): a list of known AI tools, and one tool's page where people report a new
// tool, its owner edits it, and the governance lead sets its status. Ports of build 27's vTools and vTool.

import { useEffect, useState } from 'react';
import { get, post } from '../api';
import { go, useApp } from '../state';
import type { Action, CaseRow, Dict } from '../types';
import { fdate, fdateShort } from '../format';
import { GapChips, PageHead, TierChip, useLoad } from '../components/bits';
import { ToolChip } from '../components/MatchCard';

const StatusChip = ({ t }: { t: Dict }) => <ToolChip status={t.status} />;

const TOOL_SOURCE: Record<string, string> = { reported: 'Reported by a person', use_case: 'Created from a use case' };

export function ToolsPage() {
  const { me, version, name, toast, boot } = useApp();
  const { data, error } = useLoad(() => get<Dict[]>('/tools'), [me.id, version]);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const report = async () => {
    try { const t = await post<Dict>('/tools'); go('tools', t.id); } catch (e: any) { toast(e.message, true); }
  };
  if (error) return <div className="callout bad">{error}</div>;
  const list = [...(data || [])].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
    .filter(t => (status === 'all' || t.status === status)
      && (!q || [t.name, t.vendor, t.purpose, name(t.ownerId)].join(' ').toLowerCase().includes(q.toLowerCase())));
  return (
    <>
      <PageHead title="AI tools" sub="The AI tools people are using or have reported. Look here before starting something new, so work is not duplicated. Reporting a tool carries no consequence: reviews apply going forward.">
        {!['admin', 'auditor'].includes(me.role) && <button className="btn accent" onClick={report}>Report an AI tool</button>}
      </PageHead>
      <div className="filters">
        <input type="search" placeholder="Search by name, vendor, purpose or owner" value={q} onChange={e => setQ(e.target.value)} aria-label="Search AI tools" />
        <select value={status} onChange={e => setStatus(e.target.value)} aria-label="Status">
          <option value="all">All statuses</option>{Object.entries(boot.toolStatus).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      </div>
      {!data ? <p className="muted">Loading...</p> : list.length ? <div className="tablewrap"><table>
        <thead><tr><th>ID</th><th>AI tool</th><th>Status</th><th>Owner</th><th>Source</th><th>Use case</th><th>Reported</th></tr></thead>
        <tbody>{list.map(t => <tr key={t.id} className="click" onClick={() => go('tools', t.id)}>
          <td className="mono">{t.id}</td><td><div className="title">{t.name || <span className="muted">Untitled draft</span>}</div><div className="small muted">{t.vendor || t.purpose}</div></td>
          <td><StatusChip t={t} /></td><td>{name(t.ownerId)}</td><td className="small">{TOOL_SOURCE[t.source] || t.source}</td>
          <td className="mono small">{t.useCaseId && <a href={'#/case/' + t.useCaseId} onClick={e => e.stopPropagation()}>{t.useCaseId}</a>}</td>
          <td className="small muted">{t.reportedAt ? fdateShort(t.reportedAt) : 'Not reported'}</td></tr>)}</tbody>
      </table></div> : <div className="empty">No AI tools match.</div>}
    </>
  );
}

export function ToolPage({ id }: { id: string }) {
  const { me, version, name, toast, changed, boot } = useApp();
  const { data, error } = useLoad(() => get<Dict>('/tools/' + id), [id, me.id, version]);
  const [t, setT] = useState<Dict | null>(null);
  const [form, setForm] = useState<Dict>({});
  const [st, setSt] = useState({ status: '', note: '' });
  useEffect(() => {
    setT(data);
    if (data) {
      setForm(Object.fromEntries(['name', 'vendor', 'purpose', 'users', 'link', 'accessNote', 'ownerId'].map(k => [k, data[k] || ''])));
      const opts = (data.actions.find((a: Action) => a.id === 'set_tool_status')?.fields[0]?.options || []) as Dict[];
      setSt({ status: opts[0]?.v || '', note: '' });
    }
  }, [data]);

  if (error) return <><PageHead title="Not found" /><div className="empty">That AI tool does not exist, or it is someone else's draft.<button className="btn" onClick={() => go('tools')}>Back to AI tools</button></div></>;
  if (!t) return <p className="muted">Loading...</p>;
  const has = (aid: string) => t.actions.some((a: Action) => a.id === aid);
  const editable = has('save_tool') || has('report_tool') || has('edit_tool'), draft = t.status === 'draft';

  const run = async (aid: string, input: Dict, ok: string) => {
    try {
      const r = await post<Dict>(`/tools/${t.id}/actions/${aid}`, { input });
      changed();
      if (r.discarded) { toast('Draft discarded.'); go('tools'); return; }
      setT(r); toast(ok);
    } catch (e: any) { toast(e.message, true); }
  };
  const save = (report: boolean) => run(report ? 'report_tool' : draft ? 'save_tool' : 'edit_tool', { form }, report ? 'Reported. It now shows as Reported in the AI tool catalog.' : 'Saved.');
  const F = (k: string, label: string, wide = false, area = false) => <div className={'field ' + (wide ? 'wide' : '')}><label htmlFor={'tf_' + k}>{label}</label>
    {area ? <textarea id={'tf_' + k} value={form[k] ?? ''} onChange={e => setForm({ ...form, [k]: e.target.value })} />
      : <input type="text" id={'tf_' + k} value={form[k] ?? ''} onChange={e => setForm({ ...form, [k]: e.target.value })} />}</div>;
  const D = (l: string, v?: string) => <><dt>{l}</dt><dd>{v || <span className="muted">Not provided</span>}</dd></>;
  const uc: Dict | undefined = t.linkedCase;
  const statusOpts: Dict[] = t.actions.find((a: Action) => a.id === 'set_tool_status')?.fields[0]?.options || [];

  return (
    <div>
      <button className="btn ghost" onClick={() => go('tools')}>Back to AI tools</button>
      <div className="casehead"><div className="meta"><span className="mono muted">{t.id}</span><ToolChip status={t.status} /><span className="chip">{TOOL_SOURCE[t.source] || t.source}</span></div><h1>{t.name || 'Untitled draft'}</h1></div>
      <div className="caselayout">
        <div className="stack">
          <div className="card"><h2>Details {editable && !draft && <span className="chip">You can edit this</span>}{draft && <span className="chip auto">Private draft: only you can see it</span>}</h2>
            {editable ? <>
              <div className="formgrid">{F('name', 'Name of the AI tool', true)}{F('vendor', 'Vendor or who built it')}
                <div className="field"><label htmlFor="tf_ownerId">Owner</label><select id="tf_ownerId" value={form.ownerId} onChange={e => setForm({ ...form, ownerId: e.target.value })}>
                  {boot.people.filter(p => p.role !== 'admin' && p.role !== 'auditor').map(p => <option key={p.id} value={p.id}>{p.name}, {p.title}</option>)}</select></div>
                {F('purpose', 'What it is used for', true, true)}{F('users', 'Who uses it')}{F('link', 'Link (optional)')}{F('accessNote', 'How to get access (a note only: access requests stay with IT)', true, true)}</div>
              <div className="row" style={{ marginTop: 14 }}>{draft ? <><button className="btn primary" onClick={() => save(true)}>Report this AI tool</button><button className="btn" onClick={() => save(false)}>Save draft</button>
                <button className="btn ghost" onClick={() => run('discard_tool', {}, 'Draft discarded.')}>Discard draft</button></> : <button className="btn primary" onClick={() => save(false)}>Save changes</button>}</div>
              {draft && <p className="small muted" style={{ marginTop: 8 }}><b>This draft is private.</b> Only you can see it, not the governance lead and not the owner you pick, until you report it. Reporting carries no consequence. Once you report it you can no longer edit it as the reporter. The owner and the governance lead can. It will show as Reported.</p>}
            </> : <dl className="dl">{D('Vendor or builder', t.vendor)}{D('Owner', name(t.ownerId))}{D('Used for', t.purpose)}{D('Who uses it', t.users)}{D('Link', t.link)}{D('How to get access', t.accessNote)}</dl>}
          </div>
          {uc && <div className="card"><h2>Linked use case</h2><p><a href={'#/case/' + uc.id}>{uc.id} {uc.title}</a></p>
            <div className="row" style={{ margin: '6px 0' }}><TierChip tier={uc.tier} label={uc.tierLabel} /><span className="chip stage">{uc.stageLabel}</span><GapChips row={{ ...uc, gaps: { gates: 0, newStops: 0, other: 0 } } as CaseRow} /></div>
            <dl className="dl"><dt>Approval valid until</dt><dd>{uc.validUntil ? fdate(uc.validUntil) : <span className="muted">No current approval</span>}</dd>
              <dt>Next review</dt><dd>{uc.nextReviewAt ? fdate(uc.nextReviewAt) : <span className="muted">Not in production</span>}</dd>
              <dt>Use case owner</dt><dd>{uc.ownerName}</dd></dl>
            <p className="small muted">Production review, approval limits and alerts stay on the use case. The owner and key details above were copied when this entry was created and can now differ from the use case.</p></div>}
          <div className="card"><h2>History</h2><div className="timeline">{[...(t.history || [])].reverse().map((h: Dict, i: number) =>
            <div key={i} className="tl"><div className="when">{fdate(h.ts)}</div><div><div className="what">{h.action}</div><div className="note">{name(h.actor)}{h.note ? '. ' + h.note : ''}</div></div></div>)}</div></div>
        </div>
        <aside className="rail">
          {me.role === 'lead' && !draft && has('set_tool_status') && <div className="card"><h2>Status</h2>
            <div className="field"><label htmlFor="ts_status">Change status</label><select id="ts_status" value={st.status} onChange={e => setSt({ ...st, status: e.target.value })}>
              {statusOpts.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}</select></div>
            <div className="field"><label htmlFor="ts_note">Note (optional)</label><textarea id="ts_note" value={st.note} onChange={e => setSt({ ...st, note: e.target.value })} /></div>
            <button className="btn" onClick={() => run('set_tool_status', st, 'Status changed.')}>Change status</button>
            <p className="small muted" style={{ marginTop: 6 }}>Only the governance lead changes status. Most reported tools stay Reported. Not approved is set only on purpose.</p></div>}
          <div className="card"><h2>Facts</h2><div className="facts"><div><span>Reported by</span><span>{name(t.reportedBy)}</span></div><div><span>Owner</span><span>{name(t.ownerId)}</span></div>
            <div><span>Reported</span><span>{t.reportedAt ? fdate(t.reportedAt) : 'Not yet'}</span></div></div></div>
        </aside>
      </div>
    </div>
  );
}
