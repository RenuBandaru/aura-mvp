// Small display pieces shared by many pages.

import { useEffect, useState } from 'react';
import { useApp } from '../state';
import type { CaseRow } from '../types';
import { fdate, ago } from '../format';

export const TierChip = ({ tier, label }: { tier?: string; label?: string }) =>
  tier ? <span className={'tier ' + tier}>{label || tier}</span> : <span className="muted small">Not scored</span>;

/** The warning chips build 27 shows on lists: missing answers, guardrails, stop limits. JavaScript gapChip and flagChips. */
export function GapChips({ row }: { row: CaseRow }) {
  const g = row.gaps;
  return (
    <>
      {g.gates > 0 && <span className="chip bad" title="A guardrail has no answer on this case, so it was never applied">Missing guardrail{g.gates > 1 ? ` (${g.gates})` : ''}</span>}
      {g.newStops > 0 && <span className="chip bad" title="A guardrail now applies to this case">Guardrail applies</span>}
      {g.other > 0 && <span className="chip warn" title="Some answers are missing, so the tier may be understated">Missing{g.other > 1 ? ` (${g.other})` : ''}</span>}
      {row.stopFlags.length > 0 && <span className="chip bad">Stop limit passed</span>}
      {row.acceptanceExpired && <span className="chip warn">Approval expired</span>}
      {row.notPermitted && <span className="chip bad">Not permitted</span>}
    </>
  );
}

export const DueText = ({ row }: { row: CaseRow }) =>
  row.dueAt && row.stage !== 'closed' ? <span className={row.late ? 'chip bad' : 'small'}>{row.late ? 'Late, due ' : 'Due '}{fdate(row.dueAt)}</span> : <span className="muted small">-</span>;

/** A table of cases. Clicking a row opens the case. */
export function CaseTable({ rows, onOpen }: { rows: CaseRow[]; onOpen: (id: string) => void }) {
  const { name } = useApp();
  return (
    <div className="tablewrap">
      <table>
        <thead><tr><th>ID</th><th>Use case</th><th>Stage</th><th>Tier</th><th>Due</th><th>In stage</th></tr></thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id} className="click" onClick={() => onOpen(r.id)}>
              <td className="mono">{r.id}</td>
              <td><div className="title">{r.title}</div><div className="muted small">{name(r.submitterId)}</div></td>
              <td><b>{r.stageLabel}</b> {r.returned && <span className="chip warn">Returned</span>}<div className="row"><GapChips row={r} /></div></td>
              <td><TierChip tier={r.tier} label={r.tierLabel} /></td>
              <td><DueText row={r} /></td>
              <td className="muted small">{ago(r.stageSince)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const PageHead = ({ title, sub, children }: { title: string; sub?: string; children?: React.ReactNode }) => (
  <div className="pagehead"><div><h1>{title}</h1>{sub && <p className="muted">{sub}</p>}</div><div className="row">{children}</div></div>
);

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
