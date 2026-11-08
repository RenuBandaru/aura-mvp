// Log a new idea. While you type, AURA shows AI tools and use cases that look similar, so people
// reuse before they build (build 27's dupe check, engine matchCatalog).

import { useEffect, useState } from 'react';
import { get, post } from '../api';
import { go, useApp } from '../state';
import type { CaseDetail, Dict } from '../types';
import { PageHead } from '../components/bits';

export function NewSuggestionPage() {
  const { me, boot, toast, changed } = useApp();
  const [title, setTitle] = useState('');
  const [idea, setIdea] = useState('');
  const [unitId, setUnitId] = useState(me.unit);
  const [similar, setSimilar] = useState<Dict[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const text = (title + ' ' + idea).trim();
    if (text.length < 4) { setSimilar([]); return; }
    const t = window.setTimeout(() => get<Dict[]>('/similar?text=' + encodeURIComponent(text)).then(setSimilar).catch(() => setSimilar([])), 300);
    return () => window.clearTimeout(t);
  }, [title, idea]);

  if (['admin', 'auditor'].includes(me.role)) return <div className="callout warn">This role cannot log suggestions. Switch to another person.</div>;

  const submit = async () => {
    setBusy(true);
    try {
      const d = await post<CaseDetail>('/cases', { title, idea, unitId });
      toast('Suggestion logged as ' + d.case.id + '.');
      changed();
      go('case', d.case.id);
    } catch (e: any) { toast(e.message, true); } finally { setBusy(false); }
  };

  return (
    <>
      <PageHead title="New suggestion" sub="A short idea is enough. An adoption adviser helps shape it into a use case." />
      <div className="card" style={{ maxWidth: 760 }}>
        <div className="field"><label htmlFor="n_title">Title</label><input id="n_title" type="text" value={title} onChange={e => setTitle(e.target.value)} /></div>
        <div className="field"><label htmlFor="n_idea">The idea, in a few sentences</label><textarea id="n_idea" value={idea} onChange={e => setIdea(e.target.value)} /></div>
        <div className="field"><label htmlFor="n_unit">Business unit (decides your adoption adviser)</label>
          <select id="n_unit" value={unitId} onChange={e => setUnitId(e.target.value)}>
            {(boot.rules.units || []).map((u: Dict) => <option key={u.id} value={u.id}>{u.label}</option>)}
          </select></div>
        {similar.length > 0 && (
          <div className="callout" style={{ marginBottom: 12 }}>
            <b>Something similar may already exist</b>
            {similar.map((m, i) => (
              <span key={i} className="small">
                <span className="chip">{m.kind === 'tool' ? 'AI tool' : 'Use case'}</span> <b>{m.ref.name || m.ref.title}</b>{' '}
                <span className="muted">({m.ref.id}; matches: {(m.words || []).join(', ')})</span>{' '}
                <a href={(m.kind === 'tool' ? '#/tools/' : '#/case/') + m.ref.id}>Open</a>
              </span>
            ))}
          </div>
        )}
        <button className="btn primary" disabled={busy || !title.trim() || !idea.trim()} onClick={submit}>Log suggestion</button>
      </div>
    </>
  );
}
