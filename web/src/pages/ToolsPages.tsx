// The AI tool catalog (B-06): a list of known AI tools, and one tool's page where people report a new
// tool, its owner edits it, and the governance lead sets its status. Ports of build 27's vTools and vTool.

import { useEffect, useState } from 'react';
import { get, post } from '../api';
import { go, useApp } from '../state';
import type { Action, Dict } from '../types';
import { fdate } from '../format';
import { PageHead, useLoad } from '../components/bits';
import { ActionDialog } from '../components/ActionDialog';

const STATUS_CLS: Record<string, string> = { approved: 'ok', review: 'warn', not_approved: 'bad', draft: '' };
const StatusChip = ({ t }: { t: Dict }) => <span className={'chip ' + (STATUS_CLS[t.status] || '')}>{t.statusLabel}</span>;

export function ToolsPage() {
  const { me, version, name, toast } = useApp();
  const { data, error } = useLoad(() => get<Dict[]>('/tools'), [me.id, version]);
  const report = async () => {
    try { const t = await post<Dict>('/tools'); go('tools', t.id); } catch (e: any) { toast(e.message, true); }
  };
  if (error) return <div className="callout bad">{error}</div>;
  return (
    <>
      <PageHead title="AI tools" sub="AI tools in use. Reporting a tool carries no consequence; reviews apply going forward.">
        {!['admin', 'auditor'].includes(me.role) && <button className="btn accent" onClick={report}>Report an AI tool</button>}
      </PageHead>
      {!data ? <p className="muted">Loading...</p> : <div className="tablewrap"><table>
        <thead><tr><th>ID</th><th>AI tool</th><th>Status</th><th>Owner</th><th>Source</th></tr></thead>
        <tbody>{data.map(t => <tr key={t.id} className="click" onClick={() => go('tools', t.id)}>
          <td className="mono">{t.id}</td><td><div className="title">{t.name || <span className="muted">Untitled draft</span>}</div><div className="small muted">{t.purpose}</div></td>
          <td><StatusChip t={t} /></td><td className="small">{name(t.ownerId)}</td>
          <td className="small">{t.source === 'use_case' ? <a href={'#/case/' + t.useCaseId} onClick={e => e.stopPropagation()}>{t.useCaseId}</a> : 'Reported'}</td></tr>)}</tbody>
      </table></div>}
    </>
  );
}

const TOOL_FIELDS: [string, string, boolean][] = [['name', 'Name of the AI tool', false], ['vendor', 'Vendor or maker', false], ['purpose', 'What it is used for', true],
  ['users', 'Who uses it', false], ['accessNote', 'How people get access', false], ['link', 'Link', false]];

export function ToolPage({ id }: { id: string }) {
  const { me, version, name, toast, changed, boot } = useApp();
  const { data, error } = useLoad(() => get<Dict>('/tools/' + id), [id, me.id, version]);
  const [t, setT] = useState<Dict | null>(null);
  const [form, setForm] = useState<Dict>({});
  const [open, setOpen] = useState<Action | null>(null);
  useEffect(() => { setT(data); if (data) setForm(Object.fromEntries([...TOOL_FIELDS.map(([k]) => [k, data[k] || '']), ['ownerId', data.ownerId || '']])); }, [data]);

  if (error) return <div className="callout bad">{error} <a href="#/tools">Back to AI tools</a></div>;
  if (!t) return <p className="muted">Loading...</p>;
  const formActs: Action[] = t.actions.filter((a: Action) => a.form);
  const others: Action[] = t.actions.filter((a: Action) => !a.form);
  const editable = formActs.length > 0;

  const act = async (a: Action, input: Dict = {}) => {
    if (a.id === 'discard_tool' && !window.confirm('Discard this draft?')) return;
    try {
      const r = await post<Dict>(`/tools/${t.id}/actions/${a.id}`, { input: a.form ? { form } : input });
      changed();
      if (r.discarded) { toast('Draft discarded.'); go('tools'); return; }
      setT(r); toast('Done: ' + a.label);
    } catch (e: any) { toast(e.message, true); }
  };

  return (
    <div>
      <button className="btn ghost" style={{ marginBottom: 10 }} onClick={() => go('tools')}>&larr; Back to AI tools</button>
      <PageHead title={t.name || 'New AI tool'} sub={t.id}><StatusChip t={t} /></PageHead>
      <div className="caselayout">
        <div className="stack">
          <div className="card"><h2>Details</h2>
            {editable ? <div className="formgrid">
              {TOOL_FIELDS.map(([k, l, area]) => <div key={k} className={'field' + (area ? ' wide' : '')}><label htmlFor={'tf_' + k}>{l}</label>
                {area ? <textarea id={'tf_' + k} value={form[k]} onChange={e => setForm({ ...form, [k]: e.target.value })} />
                  : <input id={'tf_' + k} type="text" value={form[k]} onChange={e => setForm({ ...form, [k]: e.target.value })} />}</div>)}
              <div className="field"><label htmlFor="tf_owner">Owner</label><select id="tf_owner" value={form.ownerId} onChange={e => setForm({ ...form, ownerId: e.target.value })}>
                <option value="">Choose...</option>{boot.people.filter(p => !['admin', 'auditor'].includes(p.role)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
            </div> : <div className="kv">
              {TOOL_FIELDS.filter(([k]) => t[k]).flatMap(([k, l]) => [<div key={k}>{l}</div>, <div key={k + 'v'}>{t[k]}</div>])}
              <div>Owner</div><div>{name(t.ownerId)}</div>
              {t.useCaseId && <><div>Use case</div><div><a href={'#/case/' + t.useCaseId}>{t.useCaseId}</a></div></>}
            </div>}
          </div>
          <div className="card"><h2>History</h2><ul className="timeline">{[...(t.history || [])].reverse().map((h: Dict, i: number) =>
            <li key={i}><b>{h.action}</b> <span className="muted small">{h.actor === 'system' ? 'System' : name(h.actor)}, {fdate(h.ts)}</span>{h.note && <div className="small">{h.note}</div>}</li>)}</ul></div>
        </div>
        <aside className="rail"><div className="card"><h2>Next step</h2>
          {t.actions.length ? <div className="actions">
            {formActs.map(a => <button key={a.id} className={'btn ' + (a.tone === 'primary' ? 'primary' : '')} onClick={() => act(a)}>{a.label}</button>)}
            {others.map(a => <button key={a.id} className="btn" onClick={() => (a.fields.length ? setOpen(a) : act(a))}>{a.label}</button>)}
          </div> : <p className="muted">Nothing for {me.name} to do on this AI tool.</p>}
        </div></aside>
      </div>
      {open && <ToolActionDialog toolId={t.id} action={open} onClose={() => setOpen(null)} onDone={r => { setT(r); setOpen(null); changed(); }} />}
    </div>
  );
}

/** Reuses the case action dialog's field drawing for a tool action (only "Change status" has fields). */
function ToolActionDialog({ toolId, action, onClose, onDone }: { toolId: string; action: Action; onClose: () => void; onDone: (t: Dict) => void }) {
  return <ActionDialog caseId={toolId} action={action} onClose={onClose} onDone={onDone as any} endpoint={`/tools/${toolId}/actions/${action.id}`} />;
}
