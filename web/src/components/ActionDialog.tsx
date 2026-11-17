// The pop-up for one action: draws its fields (some actions group them in tabs), sends the input to the
// API, and shows the engine's message if it refuses. Port of build 27's railHtml pop-up and "doact".

import { useState } from 'react';
import { post } from '../api';
import { useApp } from '../state';
import type { Action, CaseDetail, Dict } from '../types';
import { FieldView, ReviewerNotes, initialValues, inputFrom } from './fields';
import { Backdrop } from './bits';

/** Fields marked required that are still empty, so they can be outlined before sending. */
const emptyRequired = (a: Action, v: Dict) =>
  new Set(a.fields.filter(f => f.required && !['measures', 'overrides', 'support', 'panelnotes', 'note', 'hidden'].includes(f.type))
    .filter(f => (Array.isArray(v[f.name]) ? !v[f.name].length : !String(v[f.name] ?? '').trim())).map(f => f.name));

/** Button wording on tabbed decision forms, as build 27 words them. */
const CONFIRM: Record<string, string> = { rv_vote: 'Save my decision', panel_break: 'Break the deadlock', exec_break: 'Break the deadlock', panel_waivequorum: 'Waive quorum and decide' };

export function ActionDialog({ caseId, action, extra, onClose, onDone, endpoint, draftAction }: {
  caseId: string; action: Action; extra?: Dict; onClose: () => void; onDone: (d: CaseDetail) => void;
  /** review_draft, when this decision form can also be saved without deciding. */
  draftAction?: Action;
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
  // In "Record my decision", the other reviewers' decisions and notes sit beside your own decision and note.
  const sideNotes = action.id === 'rv_vote' ? shown.find(f => f.type === 'panelnotes') : undefined;
  const decWords: Record<string, string> = Object.fromEntries((action.fields.find(f => f.name === 'decision')?.options || []).map((o: Dict) => [o.v, o.l]));

  const send = async (asDraft = false) => {
    setTried(!asDraft);
    setBusy(true);
    setError('');
    try {
      const d = await post<CaseDetail>(asDraft ? `/cases/${caseId}/actions/review_draft` : endpoint || `/cases/${caseId}/actions/${action.id}`,
        { input: { ...inputFrom(action.fields, v), ...(extra || {}) } });
      toast(asDraft ? 'Changes saved for the other reviewers.' : 'Done: ' + action.label);
      onDone(d);
    } catch (e: any) {
      setError(e.message);
      const hit = action.fields.find(f => f.tab && f.label && e.message.includes(f.label.replace(/ \(.*\)$/, '')));
      if (hit?.tab) setTab(hit.tab); // jump to the tab the problem is on
    } finally { setBusy(false); }
  };

  return (
    <Backdrop onClose={onClose}>
      <div className={'modal' + (tabs.length ? ' wide' : '')} role="dialog" aria-modal="true" aria-label={action.label}>
        <div className="phead"><div><h2>{action.label}</h2>{action.intro && <p className="small muted" style={{ marginTop: 4 }}>{action.intro}</p>}</div>
          <button className="pclose" onClick={onClose} aria-label="Close">&times;</button></div>
        {tabs.length > 0 && <div className="tabs" role="tablist" style={{ padding: '0 16px' }}>
          {tabs.map(([k, l]) => {
            const gaps = action.fields.filter(f => f.tab === k && missing.has(f.name)).length;
            return <button key={k} role="tab" aria-selected={k === tab} onClick={() => setTab(k)}>{l}{gaps ? <span className="chip bad" style={{ marginLeft: 6 }}>{gaps}</span> : null}</button>;
          })}</div>}
        <div className="pbody">
          {action.disabled && <p className="callout warn" style={{ marginBottom: 10 }}>{tabs.length ? <><b>Cannot approve yet.</b> {action.why}{draftAction ? ' You can still fill in the tabs and save your changes for the other reviewers to see.' : ''}</> : action.why}</p>}
          {sideNotes ? <div className="decgrid">
            <div>{shown.filter(f => f !== sideNotes).map(f => <FieldView key={f.name + (f.sec || '')} f={f} v={v} set={set} need={missing.has(f.name)} />)}</div>
            <aside className="decside"><ReviewerNotes f={sideNotes} othersOnly labels={decWords} /></aside>
          </div> : shown.map(f => <FieldView key={f.name + (f.sec || '')} f={f} v={v} set={set} need={missing.has(f.name)} />)}
        </div>
        <div className="pfoot">
          {!action.disabled && <button className="btn primary" disabled={busy} onClick={() => send()}>{busy ? 'Saving...' : action.confirmLabel || CONFIRM[action.id]
            || (tabs.length ? (/^(panel|exec)_/.test(action.id) ? 'Confirm decision' : 'Confirm approval') : 'Confirm')}</button>}
          {draftAction && <button className="btn" disabled={busy} onClick={() => send(true)}
            title="Saves your changes to the terms, KPIs and accepted risks for the other reviewers. Your decision and note are not recorded.">Save changes without deciding</button>}
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          {error && <span className="err" role="alert">{error}</span>}
        </div>
      </div>
    </Backdrop>
  );
}
