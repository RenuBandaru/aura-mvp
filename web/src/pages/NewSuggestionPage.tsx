// Log a new idea. While you type, AURA shows AI tools and use cases that look similar, so people
// reuse before they build (build 27's dupe check, engine matchCatalog).

import { useEffect, useState } from 'react';
import { get, post } from '../api';
import { go, useApp } from '../state';
import type { CaseDetail, Dict } from '../types';
import { PageHead } from '../components/bits';
import { MatchCard, matchTerms } from '../components/MatchCard';

export function NewSuggestionPage() {
  const { me, boot, toast, changed } = useApp();
  const [title, setTitle] = useState('');
  const [idea, setIdea] = useState('');
  const [unitId, setUnitId] = useState(me.unit);
  const [similar, setSimilar] = useState<Dict[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const text = (title + ' ' + idea).trim();
    if (!matchTerms(text).length) { setSimilar([]); return; }
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
      <PageHead title="New suggestion" sub="Anyone can log an AI idea. It does not need to be a full use case yet." />
      <div className="card" style={{ maxWidth: 640 }}><div className="stack">
        <div className="field"><label htmlFor="n_title">Title</label><input id="n_title" type="text" placeholder="A short name for the idea" value={title} onChange={e => setTitle(e.target.value)} /></div>
        <div id="dupes" aria-live="polite">{matchTerms(title + ' ' + idea).length > 0 && (similar.length
          ? <div className="callout"><b>Something similar may already exist</b><span className="muted small">You can still log your idea. A match may not be relevant, and nothing here blocks you. This is only to avoid duplicate work.</span>
            {similar.map((m, i) => <MatchCard key={i} m={m} />)}</div>
          : <p className="small muted">Nothing similar found in the catalog or the current use cases.</p>)}</div>
        <div className="field"><label htmlFor="n_idea">What is the idea?</label><textarea id="n_idea" placeholder="Describe the problem and how AI might help." value={idea} onChange={e => setIdea(e.target.value)} /></div>
        <div className="field"><label htmlFor="n_unit">Business unit</label>
          <select id="n_unit" value={unitId} onChange={e => setUnitId(e.target.value)}>
            {(boot.rules.units || []).map((u: Dict) => <option key={u.id} value={u.id}>{u.label}</option>)}
          </select><span className="small muted">Your adoption adviser for this unit is alerted to new ideas. Change it if the idea belongs to another unit.</span></div>
        <div className="row"><button className="btn primary" disabled={busy} onClick={() => title.trim() && idea.trim() ? submit() : toast('Add a title and a short description.', true)}>Log suggestion</button>
          <button className="btn ghost" onClick={() => go('queue')}>Cancel</button></div>
        <p className="small muted">Submitting as {me.name}.</p>
      </div></div>
    </>
  );
}
