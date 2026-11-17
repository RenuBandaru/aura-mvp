// People (demo admin): the list behind "Viewing as". Add, edit or delete people; the API checks every
// change and says why a person cannot be deleted. Bulk loading is on the Data page (Import people).

import { useState } from 'react';
import { get, post } from '../api';
import { useApp, go } from '../state';
import { PageHead, useLoad } from '../components/bits';

interface Row { id: string; name: string; email: string; role: string; roleLabel: string; unit: string; unitLabel: string;
  title: string; cases: number; tools: number; rules: string[]; deleteBlock: string }
interface Page { people: Row[]; roles: { id: string; label: string }[]; units: { id: string; label: string }[]; ruleGaps: string[] }
type Draft = { id?: string; name: string; email: string; role: string; unit: string; title: string };

export function PeoplePage() {
  const { me, toast, reloadBoot } = useApp();
  const { data, error, reload } = useLoad(() => get<Page>('/people'), [me.id]);
  const [edit, setEdit] = useState<Draft | null>(null);
  const [q, setQ] = useState('');
  if (me.role !== 'admin') return <div className="callout warn">Switch "Viewing as" to the Demo admin to manage people.</div>;
  if (error) return <div className="callout bad">{error}</div>;
  if (!data) return <p className="muted">Loading...</p>;

  const done = (msg: string) => { toast(msg); reload(); reloadBoot(); };
  const remove = async (r: Row) => {
    if (!window.confirm('Delete ' + r.name + '?')) return;
    try { await post('/people/' + r.id + '/delete'); done(r.name + ' deleted.'); } catch (e: any) { toast(e.message, true); }
  };
  const shown = data.people.filter(p => !q || (p.name + ' ' + p.email + ' ' + p.roleLabel + ' ' + p.title + ' ' + p.unitLabel).toLowerCase().includes(q.toLowerCase()));

  return (
    <>
      <PageHead title="People" sub={data.people.length + ' people. Everyone here appears in "Viewing as".'}>
        <button className="btn accent" onClick={() => setEdit({ name: '', email: '', role: 'submitter', unit: '', title: '' })}>Add person</button>
      </PageHead>
      <div className="stack">
        {data.ruleGaps.length > 0 && <div className="callout warn"><b>The rules need updating for these people</b>
          <ul style={{ margin: '4px 0 0 18px' }}>{data.ruleGaps.map(g => <li key={g}>{g}</li>)}</ul>
          <div><button className="btn" onClick={() => go('rules')}>Open Rules</button></div></div>}
        <div className="row"><div className="field" style={{ flex: '1 1 260px', marginBottom: 0 }}>
          <label htmlFor="people_q">Search</label>
          <input id="people_q" type="text" value={q} onChange={e => setQ(e.target.value)} placeholder="Name, email, role, unit or area" /></div>
          <p className="small muted" style={{ flex: '1 1 260px' }}>To load many people at once, use Import people on the <a href="#/data">Data and demo</a> page.</p>
        </div>
        <div className="tablewrap"><table>
          <thead><tr><th>Name</th><th>Role</th><th>Business unit</th><th>Title or area</th><th>Named on</th><th></th></tr></thead>
          <tbody>{shown.map(p => (
            <tr key={p.id}>
              <td><b>{p.name}</b>{p.email && <div className="small muted">{p.email}</div>}</td>
              <td>{p.roleLabel}</td>
              <td>{p.unitLabel || <span className="muted">None</span>}</td>
              <td>{p.title}</td>
              <td className="small">{[p.cases ? p.cases + ' use case(s)' : '', p.tools ? p.tools + ' tool(s)' : '', ...p.rules].filter(Boolean).join(', ') || <span className="muted">Nothing yet</span>}</td>
              <td><div className="row" style={{ flexWrap: 'nowrap' }}>
                <button className="btn" onClick={() => setEdit({ id: p.id, name: p.name, email: p.email, role: p.role, unit: p.unit || '', title: p.title })}>Edit</button>
                <button className="btn danger" disabled={!!p.deleteBlock} title={p.deleteBlock || 'Delete'} onClick={() => remove(p)}>Delete</button>
              </div></td>
            </tr>))}</tbody>
        </table></div>
      </div>
      {edit && <PersonEditor draft={edit} page={data} onClose={() => setEdit(null)} onSaved={name => { setEdit(null); done(name + ' saved.'); }} />}
    </>
  );
}

function PersonEditor({ draft, page, onClose, onSaved }: { draft: Draft; page: Page; onClose: () => void; onSaved: (name: string) => void }) {
  const [d, setD] = useState<Draft>(draft);
  const [err, setErr] = useState('');
  const set = (k: keyof Draft, v: string) => setD({ ...d, [k]: v });
  const save = async () => {
    try { await post('/people', { person: d }); onSaved(d.name.trim()); } catch (e: any) { setErr(e.message); }
  };
  const isAdmin = d.id === 'p_admin';
  return (
    <div className="modalbg" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={d.id ? 'Edit person' : 'Add person'}>
        <div className="phead"><h2>{d.id ? 'Edit ' + draft.name : 'Add a person'}</h2><button className="btn ghost" onClick={onClose} aria-label="Close">Close</button></div>
        <div className="pbody">
          <div className="grid2">
            <div className="field"><label htmlFor="pe_name">Name</label><input id="pe_name" type="text" value={d.name} onChange={e => set('name', e.target.value)} /></div>
            <div className="field"><label htmlFor="pe_email">Work email</label><input id="pe_email" type="text" value={d.email} onChange={e => set('email', e.target.value)} placeholder="Links them to Microsoft sign-in later" /></div>
            <div className="field"><label htmlFor="pe_role">Role</label>
              <select id="pe_role" value={d.role} disabled={isAdmin} onChange={e => set('role', e.target.value)}>
                {page.roles.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}</select></div>
            <div className="field"><label htmlFor="pe_unit">Business unit</label>
              <select id="pe_unit" value={d.unit} onChange={e => set('unit', e.target.value)}>
                <option value="">None</option>{page.units.map(u => <option key={u.id} value={u.id}>{u.label}</option>)}</select></div>
          </div>
          <div className="field"><label htmlFor="pe_title">Title or area</label><input id="pe_title" type="text" value={d.title} onChange={e => set('title', e.target.value)} placeholder="For an expert, the area they cover, such as Cybersecurity" /></div>
          {d.role === 'sme' && <p className="small muted">To send an area's consult requests to this expert, pick them on Rules, Consult areas.</p>}
          {d.role === 'adviser' && <p className="small muted">To make them a business unit's adviser, pick them on Rules, Business units.</p>}
        </div>
        <div className="pfoot"><button className="btn primary" onClick={save}>Save</button><button className="btn" onClick={onClose}>Cancel</button>{err && <span className="err">{err}</span>}</div>
      </div>
    </div>
  );
}
