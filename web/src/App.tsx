// The frame around every page: header with "Viewing as", left navigation, and the current page.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { get, setActingAs } from './api';
import { AppContext, AppState, go, parseHash, Route } from './state';
import type { Bootstrap, QueueItem } from './types';
import { QueuePage } from './pages/QueuePage';
import { CasesPage } from './pages/CasesPage';
import { CasePage } from './pages/CasePage';
import { NewSuggestionPage } from './pages/NewSuggestionPage';
import { ToolsPage, ToolPage } from './pages/ToolsPages';
import { OutboxPage } from './pages/OutboxPage';
import { DataPage } from './pages/DataPage';
import { AuditPage } from './pages/AuditPage';

const START_AS = 'p_dana';
const remembered = () => { try { return localStorage.getItem('aura.as') || START_AS; } catch { return START_AS; } };

export function App() {
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [failed, setFailed] = useState('');
  const [asId, setAsId] = useState(remembered);
  const [route, setRoute] = useState<Route>(parseHash(window.location.hash));
  const [version, setVersion] = useState(0);
  const [toastMsg, setToast] = useState<{ text: string; bad?: boolean } | null>(null);
  const [queueCount, setQueueCount] = useState(0);

  useEffect(() => {
    get<Bootstrap>('/bootstrap').then(setBoot).catch(() => setFailed('Cannot reach the AURA API. Is "python api/dev_server.py" running?'));
    const onHash = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  setActingAs(asId); // every request from here on is made as this person

  useEffect(() => {
    if (!boot) return;
    get<{ items: QueueItem[] }>('/queue').then(q => setQueueCount(q.items.length)).catch(() => setQueueCount(0));
  }, [boot, asId, version]);

  const toast = useCallback((text: string, bad?: boolean) => {
    setToast({ text, bad });
    window.setTimeout(() => setToast(t => (t && t.text === text ? null : t)), bad ? 6000 : 3500);
  }, []);

  const state = useMemo<AppState | null>(() => {
    if (!boot) return null;
    const me = boot.people.find(p => p.id === asId) || boot.people[0];
    const person = (id?: string | null) => boot.people.find(p => p.id === id);
    return { boot, me, version, changed: () => setVersion(v => v + 1), toast, person, name: id => person(id)?.name || id || '' };
  }, [boot, asId, version, toast]);

  if (failed) return <div className="main"><div className="callout bad"><b>{failed}</b></div></div>;
  if (!state) return <div className="main muted">Loading AURA...</div>;

  const switchTo = (pid: string) => {
    setAsId(pid);
    try { localStorage.setItem('aura.as', pid); } catch { /* private window: the choice just is not remembered */ }
    setVersion(v => v + 1);
  };
  const canCreate = !['admin', 'auditor'].includes(state.me.role);
  const navItem = (page: string, label: string, count?: number) => (
    <button className="item" aria-current={route.page === page || (page === 'cases' && route.page === 'case') ? 'page' : undefined} onClick={() => go(page)}>
      <span>{label}</span>{count ? <span className="count">{count}</span> : null}
    </button>
  );

  return (
    <AppContext.Provider value={state}>
      <header className="top">
        <div className="brand"><span className="bar" /><b>AURA</b><span className="small">AI use case governance (sample data)</span></div>
        <label className="viewas small">Viewing as
          <select value={state.me.id} onChange={e => switchTo(e.target.value)}>
            {state.boot.people.map(p => <option key={p.id} value={p.id}>{p.name}, {p.roleLabel}</option>)}
          </select>
        </label>
      </header>
      <div className="frame">
        <nav className="nav" aria-label="Main">
          {canCreate && <button className="btn accent" style={{ marginBottom: 10 }} onClick={() => go('new')}>+ New suggestion</button>}
          {navItem('queue', 'Your queue', queueCount)}
          {navItem('cases', 'Use cases')}
          {navItem('tools', 'AI tools')}
          {navItem('outbox', 'Outbox')}
          {navItem('audit', 'Audit log')}
          {(state.me.role === 'admin' || state.me.role === 'lead') && <><div className="sep">Demo</div>{navItem('data', 'Data and demo')}</>}
        </nav>
        <main className="main">{page(route)}</main>
      </div>
      {toastMsg && <div className={'toast' + (toastMsg.bad ? ' bad' : '')} role="status">{toastMsg.text}</div>}
    </AppContext.Provider>
  );
}

function page(r: Route) {
  switch (r.page) {
    case 'cases': return <CasesPage />;
    case 'case': return <CasePage id={r.id || ''} />;
    case 'new': return <NewSuggestionPage />;
    case 'tools': return r.id ? <ToolPage id={r.id} /> : <ToolsPage />;
    case 'outbox': return <OutboxPage />;
    case 'audit': return <AuditPage caseId={r.id} />;
    case 'data': return <DataPage />;
    default: return <QueuePage />;
  }
}
