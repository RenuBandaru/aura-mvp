// The pop-up for one action: draws its fields (some actions group them in tabs), sends the input to the
// API, and shows the engine's message if it refuses. Port of build 27's railHtml pop-up and "doact".

import { useState } from 'react';
import { post } from '../api';
import { useApp } from '../state';
import type { Action, CaseDetail, Dict } from '../types';
import { FieldView, initialValues, inputFrom } from './fields';

/** Fields marked required that are still empty, so they can be outlined before sending. */
const emptyRequired = (a: Action, v: Dict) =>
  new Set(a.fields.filter(f => f.required && !['measures', 'overrides', 'support', 'panelnotes', 'note', 'hidden'].includes(f.type))
    .filter(f => (Array.isArray(v[f.name]) ? !v[f.name].length : !String(v[f.name] ?? '').trim())).map(f => f.name));

export function ActionDialog({ caseId, action, extra, onClose, onDone, endpoint }: {
  caseId: string; action: Action; extra?: Dict; onClose: () => void; onDone: (d: CaseDetail) => void;
  /** Where to send the input. Defaults to the case action endpoint; AI tool actions pass their own. */
  endpoint?: string;
}) {
  const { toast } = useApp();
  const [v, setV] = useState<Dict>(() => initialValues(action.fields));
  const [tab, setTab] = useState(action.defaultTab || action.tabs?.[0]?.[0] || '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const set = (k: string, val: unknown) => setV(x => ({ ...x, [k]: val }));
  const tabs = (action.tabs || []).filter(([k]) => action.fields.some(f => f.tab === k));
  const shown = tabs.length ? action.fields.filter(f => f.tab === tab) : action.fields;
  const missing = tried ? emptyRequired(action, v) : new Set<string>();

  const send = async () => {
    setTried(true);
    setBusy(true);
    setError('');
    try {
      const d = await post<CaseDetail>(endpoint || `/cases/${caseId}/actions/${action.id}`, { input: { ...inputFrom(action.fields, v), ...(extra || {}) } });
      toast('Done: ' + action.label);
      onDone(d);
    } catch (e: any) {
      setError(e.message);
      const hit = action.fields.find(f => f.tab && f.label && e.message.includes(f.label.replace(/ \(.*\)$/, '')));
      if (hit?.tab) setTab(hit.tab); // jump to the tab the problem is on
    } finally { setBusy(false); }
  };

  return (
    <div className="modalbg" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className={'modal' + (tabs.length ? ' wide' : '')} role="dialog" aria-modal="true" aria-label={action.label}>
        <div className="phead"><div><h2>{action.label}</h2>{action.intro && <p className="small muted" style={{ marginTop: 4 }}>{action.intro}</p>}</div>
          <button className="pclose" onClick={onClose} aria-label="Close">&times;</button></div>
        {tabs.length > 0 && <div className="tabs" role="tablist" style={{ padding: '0 16px' }}>
          {tabs.map(([k, l]) => {
            const gaps = action.fields.filter(f => f.tab === k && missing.has(f.name)).length;
            return <button key={k} role="tab" aria-selected={k === tab} onClick={() => setTab(k)}>{l}{gaps ? <span className="chip bad" style={{ marginLeft: 6 }}>{gaps}</span> : null}</button>;
          })}</div>}
        <div className="pbody">
          {action.disabled && <p className="callout warn" style={{ marginBottom: 10 }}>{action.why}</p>}
          {shown.map(f => <FieldView key={f.name + (f.sec || '')} f={f} v={v} set={set} need={missing.has(f.name)} />)}
        </div>
        <div className="pfoot">
          {!action.disabled && <button className="btn primary" disabled={busy} onClick={send}>{busy ? 'Saving...' : action.confirmLabel || (action.id === 'rv_vote' ? 'Save my decision' : 'Confirm')}</button>}
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          {error && <span className="err" role="alert">{error}</span>}
        </div>
      </div>
    </div>
  );
}
