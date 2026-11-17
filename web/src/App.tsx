// The frame around every page: header with "Viewing as", left navigation, and the current page.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { get, setActingAs } from './api';
import { setClockOffset } from './format';
import { AppContext, AppState, go, parseHash, Route } from './state';
import type { Bootstrap, QueueItem, TrainingPageData } from './types';
import { QueuePage } from './pages/QueuePage';
import { CasesPage } from './pages/CasesPage';
import { CasePage } from './pages/CasePage';
import { NewSuggestionPage } from './pages/NewSuggestionPage';
import { ToolsPage, ToolPage } from './pages/ToolsPages';
import { OutboxPage } from './pages/OutboxPage';
import { DataPage } from './pages/DataPage';
import { AuditPage } from './pages/AuditPage';
import { TrainingPage } from './pages/TrainingPage';
import { DashboardPage } from './pages/DashboardPage';
import { RulesPage } from './pages/RulesPage';
import { PeoplePage } from './pages/PeoplePage';

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
  const [trainingDue, setTrainingDue] = useState(0);

  const [lookup, setLookup] = useState('');
  // The demo clock lives on the server; the browser counts days from the same moment.
  const takeBoot = useCallback((b: Bootstrap) => { setClockOffset(b.clockOffsetMs || 0); setBoot(b); }, []);
  const reloadBoot = useCallback(() => { get<Bootstrap>('/bootstrap').then(takeBoot).catch(() => { /* keep the old labels */ }); }, [takeBoot]);

  useEffect(() => {
    get<Bootstrap>('/bootstrap').then(takeBoot).catch(() => setFailed('Cannot reach the AURA API. Is "python api/dev_server.py" running?'));
    const onHash = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);


  useEffect(() => {
    if (!boot) return;
    get<{ items: QueueItem[] }>('/queue').then(q => setQueueCount(q.items.length)).catch(() => setQueueCount(0));
    get<TrainingPageData>('/training').then(t => setTrainingDue(t.dueCount)).catch(() => setTrainingDue(0));
  }, [boot, asId, version]);

  const toast = useCallback((text: string, bad?: boolean) => {
    setToast({ text, bad });
    window.setTimeout(() => setToast(t => (t && t.text === text ? null : t)), bad ? 6000 : 3500);
  }, []);

  const state = useMemo<AppState | null>(() => {
    if (!boot) return null;
    const me = boot.people.find(p => p.id === asId) || boot.people[0];
    const person = (id?: string | null) => boot.people.find(p => p.id === id);
    return { boot, me, version, changed: () => setVersion(v => v + 1), reloadBoot, toast, person, name: id => person(id)?.name || id || '' };
  }, [boot, asId, version, toast, reloadBoot]);

  // Every request from here on is made as this person. If they were removed (an import or a reset),
  // the first person in the list is used instead.
  setActingAs(state ? state.me.id : asId);

  if (failed) return <div className="main"><div className="callout bad"><b>{failed}</b></div></div>;
  if (!state) return <div className="main muted">Loading AURA...</div>;

  const switchTo = (pid: string) => {
    setAsId(pid);
    try { localStorage.setItem('aura.as', pid); } catch { /* private window: the choice just is not remembered */ }
    setVersion(v => v + 1);
  };
  const canCreate = !['admin', 'auditor'].includes(state.me.role);
  // The Rules and Data and demo pages belong to the demo admin (build 27 sends everyone else to the queue).
  const shown: Route = ['rules', 'data', 'people'].includes(route.page) && state.me.role !== 'admin' ? { page: 'queue' } : route;
  /** "Go to use case #": accepts 1003, UC-1003 or uc 1003. JavaScript lookupf. */
  const goLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    const raw = lookup.trim(), m = /^(?:uc)?[\s-]*(\d{1,6})$/i.exec(raw);
    if (!raw) return;
    if (!m) { state.toast('Enter a use case number, for example 1003 or UC-1003.', true); return; }
    try { await get('/cases/UC-' + m[1]); } catch { state.toast('No use case UC-' + m[1] + ' was found.', true); return; }
    setLookup(''); go('case', 'UC-' + m[1]); window.scrollTo(0, 0);
  };
  const groups = ['submitter', 'adviser', 'lead', 'panel', 'sme', 'stakeholder', 'exec', 'auditor', 'admin'];
  const clockDays = Math.round((state.boot.clockOffsetMs || 0) / 86400000);
  const navItem = (page: string, label: string, count?: number) => (
    <button className="item" aria-current={route.page === page || (page === 'cases' && route.page === 'case') ? 'page' : undefined} onClick={() => go(page)}>
      <span>{label}</span>{count ? <span className="count">{count}</span> : null}
    </button>
  );

  return (
    <AppContext.Provider value={state}>
      <header className="top">
        <div className="brand">
          <svg className="mark" aria-hidden="true" viewBox="0 0 46 46" width="38" height="38"><circle className="ring r1" cx="23" cy="23" r="21" /><circle className="ring r2" cx="23" cy="23" r="16.5" />
            <circle cx="23" cy="23" r="12" fill="var(--accent)" /><path d="M16.5 23.5 L21 28 L30 18" fill="none" stroke="var(--hdr)" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <div className="wm"><b>AURA</b><small>AI Use, Risk, and Assurance</small></div>
        </div>
        <form className="lookup" role="search" autoComplete="off" onSubmit={goLookup}>
          <label htmlFor="lookup" className="sr">Go to use case number</label>
          <input id="lookup" type="text" inputMode="numeric" placeholder="Go to use case #" maxLength={12} value={lookup} onChange={e => setLookup(e.target.value)} />
          <button className="btn sm accent" type="submit">Go</button>
        </form>
        <div className="viewas"><span>Viewing as</span>
          <select aria-label="Viewing as" value={state.me.id} onChange={e => switchTo(e.target.value)}>
            {groups.map(r => <optgroup key={r} label={state.boot.roleLabels[r] || r}>
              {state.boot.people.filter(p => p.role === r).map(p => <option key={p.id} value={p.id}>{p.name}{p.title && r !== 'admin' ? ', ' + p.title : ''}</option>)}
            </optgroup>)}
          </select>
        </div>
      </header>
      {clockDays > 0 && <div className="banner"><span>The demo clock is {clockDays} day{clockDays === 1 ? '' : 's'} ahead, for everyone. Due dates and reminders count from that date.</span>
        <span>Reset it on Data and demo.</span></div>}
      <div className="frame">
        <nav className="nav" aria-label="Main">
          {canCreate && <button className="btn accent" style={{ marginBottom: 10 }} onClick={() => go('new')}>+ New suggestion</button>}
          {navItem('queue', 'Your queue', state.me.role === 'admin' ? 0 : queueCount)}
          {navItem('dash', 'Dashboard')}
          {navItem('cases', 'Use cases')}
          {navItem('tools', 'AI tools')}
          {state.me.role !== 'admin' && navItem('training', 'Training', trainingDue)}
          {navItem('outbox', 'Outbox')}
          {navItem('audit', 'Audit log')}
          {state.me.role === 'admin' && <><div className="sep">Demo admin</div>{navItem('rules', 'Rules')}{navItem('people', 'People')}{navItem('data', 'Data and demo')}</>}
        </nav>
        <main className="main">{page(shown)}</main>
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
    case 'training': return <TrainingPage />;
    case 'dash': return <DashboardPage />;
    case 'rules': return <RulesPage />;
    case 'people': return <PeoplePage />;
    case 'data': return <DataPage />;
    default: return <QueuePage />;
  }
}
