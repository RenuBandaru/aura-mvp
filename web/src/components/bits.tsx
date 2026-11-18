// Small display pieces shared by many pages: tier gauges, due chips, warning chips, the case table,
// the page heading, a full-screen dialog backdrop (whose dialogs drag by their title bar) and a data loader.

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '../state';
import type { CaseRow } from '../types';
import { ago, DAY, nowMs } from '../format';

const TIER_ORDER = ['low', 'moderate', 'high', 'critical'];
const segs = (tier?: string) => TIER_ORDER.map((t, k) => <i key={t} style={{ background: k <= TIER_ORDER.indexOf(tier || '') ? `var(--t-${t})` : 'var(--line)' }} />);

export const TierChip = ({ tier, label }: { tier?: string; label?: string }) =>
  tier ? <span className={'chip ' + tier}>{label || tier}</span> : <span className="chip">Not scored</span>;

/** The filled warning triangle build 27 puts before alerts (its ALERT). */
export const ALERT = <svg className="ico" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 1.6 15.2 14H0.8z" fill="currentColor" /><path d="M8 6.2v3.8M8 11.7v.5" stroke="var(--surface)" strokeWidth="1.7" strokeLinecap="round" /></svg>;

/** The question-mark circle on the "Ask adviser" button (build 27's HELP_ICO). */
export const HELP_ICO = <svg className="hlp" aria-hidden="true" width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M6 6.2a2 2 0 1 1 3 1.7c-.7.4-1 .8-1 1.6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /><circle cx="8" cy="11.8" r=".9" fill="currentColor" /></svg>;

/** The case-page and queue gauge: "Risk tier", four segments filled up to the tier, and its name. JavaScript tierMeter. */
export function TierGauge({ tier }: { tier?: string }) {
  const { boot } = useApp();
  return (
    <div className="tiermeter" title="Risk tier comes from the inherent risk score"><span className="muted small">Risk tier</span>
      <div className="segs" aria-hidden="true">{segs(tier)}</div>
      <b style={{ color: tier ? `var(--t-${tier})` : 'var(--muted)' }}>{tier ? boot.tierLabels[tier] : 'Not scored yet'}</b></div>
  );
}

/** The smaller gauge used in tables. JavaScript tierInline. */
export function TierInline({ tier }: { tier?: string }) {
  const { boot } = useApp();
  if (!tier) return <span className="muted small">Not scored yet</span>;
  return <span className="tierinline"><span className="segs" aria-hidden="true">{segs(tier)}</span><b style={{ color: `var(--t-${tier})` }}>{boot.tierLabels[tier]}</b></span>;
}

const DUE_LABEL: Record<string, string> = { vetting: 'Vetting due', panel: 'Panel due', exec: 'Decision due', pilot: 'Pilot review', production: 'Next review' };

/** What is due and when: "Panel due: overdue 13d", "Pilot review in 2d". JavaScript dueChip. */
export function DueChip({ row }: { row: Pick<CaseRow, 'dueAt' | 'stage'> }) {
  if (!row.dueAt || row.stage === 'closed') return null;
  const lab = DUE_LABEL[row.stage] || 'Due', diff = row.dueAt - nowMs();
  if (diff < 0) return <span className="chip bad">{lab}: overdue {Math.max(1, Math.floor(-diff / DAY))}d</span>;
  const d = Math.ceil(diff / DAY);
  return <span className={'chip' + (d <= 1 ? ' warn' : '')}>{lab} in {d}d</span>;
}

/** The chip only when the case is overdue or due within a day (case page header, list rows). JavaScript dueAlert. */
export function DueAlert({ row }: { row: Pick<CaseRow, 'dueAt' | 'stage'> }) {
  if (!row.dueAt || row.stage === 'closed') return null;
  const diff = row.dueAt - nowMs();
  return diff < 0 || Math.ceil(diff / DAY) <= 1 ? <DueChip row={row} /> : null;
}

/** The Due column in tables. JavaScript dueCell. */
export function DueCell({ row }: { row: CaseRow }) {
  if (!row.dueAt || row.stage === 'closed') return <span className="muted">-</span>;
  const diff = row.dueAt - nowMs();
  if (diff < 0 || Math.ceil(diff / DAY) <= 1) return <DueChip row={row} />;
  return <span className="muted small">{DUE_LABEL[row.stage] || 'Due'} in {Math.ceil(diff / DAY)}d</span>;
}

/** Kept for pages that only need a plain due text. */
export const DueText = DueCell;

/** The warning chips build 27 shows on lists: missing answers, guardrails, stop limits, sign-off, budget. JavaScript gapChip and flagChips. */
export function GapChips({ row }: { row: CaseRow }) {
  const g = row.gaps;
  return (
    <>
      {g.gates > 0 && <> <span className="chip bad" title="A guardrail has no answer on this case, so it was never applied">{ALERT} Missing guardrail{g.gates > 1 ? ` (${g.gates})` : ''}</span></>}
      {g.newStops > 0 && <> <span className="chip bad" title="A guardrail now applies to this case">{ALERT} Guardrail applies</span></>}
      {g.other > 0 && <> <span className="chip warn" title="Some answers are missing, so the tier may be understated">{ALERT} Missing{g.other > 1 ? ` (${g.other})` : ''}</span></>}
      {row.awaitingSignoff && <> <span className="chip warn" title="The owner has to accept before it is submitted">Awaiting owner sign-off</span></>}
      {row.stopFlags.length > 0 && <> <span className="chip bad" title="A KPI has passed its stop limit">{ALERT} Stop limit passed</span></>}
      {row.acceptanceExpired && <> <span className="chip warn" title="The approval period has ended">Acceptance expired</span></>}
      {row.notPermitted && <> <span className="chip bad" title="Rejected and marked not permitted">Not permitted</span></>}
      {row.budget && <> <span className="chip warn" title="Ongoing cost per user is above the limit">Budget scrutiny</span></>}
    </>
  );
}

/** Whether GapChips would show anything (build 27 adds the line only then). */
export const hasChips = (r: CaseRow) => r.gaps.gates > 0 || r.gaps.newStops > 0 || r.gaps.other > 0 || !!r.awaitingSignoff || r.stopFlags.length > 0 || !!r.acceptanceExpired || !!r.notPermitted || !!r.budget;

/** A table of cases. Clicking a row opens the case. JavaScript caseRow. */
export function CaseTable({ rows, onOpen }: { rows: CaseRow[]; onOpen: (id: string) => void }) {
  const { name } = useApp();
  return (
    <div className="tablewrap">
      <table>
        <thead><tr><th>ID</th><th>Use case</th><th>Stage</th><th>Tier</th><th>Due</th><th>In stage</th></tr></thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id} className="click" onClick={() => onOpen(r.id)}>
              <td className="mono ucidc">{r.id}</td>
              <td><div className="title">{r.title}</div><div className="muted small">{name(r.submitterId)}</div></td>
              <td><b className="stagetxt">{r.stageLabel}</b>{r.returned && r.stage === 'use_case' && <> <span className="chip warn">Returned</span></>}{hasChips(r) && <div><GapChips row={r} /></div>}</td>
              <td><TierInline tier={r.tier} /></td>
              <td><DueCell row={r} /></td>
              <td className="muted small">{ago(r.stageSince)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const PageHead = ({ title, sub, children }: { title: string; sub?: string; children?: React.ReactNode }) => (
  <div className="pagehead"><div><h1>{title}</h1>{sub && <p>{sub}</p>}</div><div className="row">{children}</div></div>
);

/** The dark backdrop behind a dialog. Drawn on document.body so it always covers the whole window, however long the page. */
export function Backdrop({ onClose, children }: { onClose?: () => void; children: React.ReactNode }) {
  useEffect(() => {
    if (!onClose) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  return createPortal(<div className="modalbg" onMouseDown={e => onClose && e.target === e.currentTarget && onClose()} onPointerDown={startDrag}>{children}</div>, document.body);
}

/** The part of a dialog you can drag it by: its title bar, or the title of a plain dialog. */
const DRAG_HANDLE = '.modal > .phead, .modal.plain > h2, .modal.plain > h3';

/**
 * Lets a dialog be dragged aside by its title bar, to see the page behind it. The dialog keeps at
 * least 80 pixels of its title bar inside the window, so it can always be dragged back or closed.
 * Buttons and fields in the title bar (the X) still work as before.
 */
function startDrag(e: React.PointerEvent<HTMLDivElement>) {
  const t = e.target as HTMLElement;
  if (e.button !== 0 || t.closest('button, a, input, select, textarea')) return;
  const handle = t.closest(DRAG_HANDLE);
  const box = handle?.parentElement;
  if (!handle || !box) return;
  e.preventDefault();
  const [dx0, dy0] = (box.dataset.drag || '0,0').split(',').map(Number);
  const r = box.getBoundingClientRect(), hr = handle.getBoundingClientRect();
  const x0 = e.clientX, y0 = e.clientY, keep = 80;
  const move = (m: PointerEvent) => {
    const dx = Math.min(Math.max(dx0 + m.clientX - x0, dx0 + keep - r.right), dx0 + window.innerWidth - keep - r.left);
    const dy = Math.min(Math.max(dy0 + m.clientY - y0, dy0 - r.top), dy0 + window.innerHeight - (hr.bottom - r.top) - r.top);
    box.dataset.drag = dx + ',' + dy;
    box.style.transform = `translate(${dx}px, ${dy}px)`;
  };
  const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); window.removeEventListener('pointercancel', stop); box.classList.remove('dragging'); };
  box.classList.add('dragging');
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', stop);
  window.addEventListener('pointercancel', stop);
}

/** Loads data with the given loader whenever any of the dependencies change. */
export function useLoad<T>(loader: () => Promise<T>, deps: unknown[]): { data: T | null; error: string; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    setError('');
    loader().then(d => { if (live) setData(d); }).catch(e => { if (live) setError(e.message || String(e)); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n]);
  return { data, error, reload: () => setN(x => x + 1) };
}
