// Editor for KPIs: a name, whether lower or higher is better, a target, an optional scale-up target and
// a stop limit. Values are kept as typed text; the engine checks and converts them (parseMeasures).

import type { Dict } from '../types';

export interface MeasureRow { name: string; dir: string; target: string; scaleUp: string; stop: string }

const text = (v: unknown) => (v === null || v === undefined ? '' : String(v));
export const toRows = (ms?: Dict[]): MeasureRow[] =>
  (ms || []).map(m => ({ name: text(m.name), dir: m.dir === 'higher' ? 'higher' : 'lower', target: text(m.target), scaleUp: text(m.scaleUp), stop: text(m.stop) }));
const blank = (): MeasureRow => ({ name: '', dir: 'lower', target: '', scaleUp: '', stop: '' });

export function MeasuresEditor({ rows, onChange, idPrefix }: { rows: MeasureRow[]; onChange: (r: MeasureRow[]) => void; idPrefix: string }) {
  const set = (i: number, k: keyof MeasureRow, v: string) => onChange(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <div className="meas">
      {rows.length > 0 && <div className="mrow mhead" aria-hidden="true"><span>KPI</span><span>Better when</span><span>Target</span><span>Scale-up target (optional)</span><span>Stop limit</span><span /></div>}
      {rows.map((r, i) => (
        <div className="mrow" key={i}>
          <input aria-label={`KPI ${i + 1} name`} id={`${idPrefix}m${i}_name`} value={r.name} onChange={e => set(i, 'name', e.target.value)} />
          <select aria-label={`KPI ${i + 1} better when`} value={r.dir} onChange={e => set(i, 'dir', e.target.value)}>
            <option value="lower">Lower is better</option><option value="higher">Higher is better</option>
          </select>
          <input aria-label={`KPI ${i + 1} target`} type="number" step="any" value={r.target} onChange={e => set(i, 'target', e.target.value)} />
          <input aria-label={`KPI ${i + 1} scale-up target`} type="number" step="any" value={r.scaleUp} onChange={e => set(i, 'scaleUp', e.target.value)} />
          <input aria-label={`KPI ${i + 1} stop limit`} type="number" step="any" value={r.stop} onChange={e => set(i, 'stop', e.target.value)} />
          <button type="button" className="btn ghost" aria-label={`Remove KPI ${i + 1}`} onClick={() => onChange(rows.filter((_, j) => j !== i))}>&times;</button>
        </div>
      ))}
      <div><button type="button" className="btn" onClick={() => onChange([...rows, blank()])}>+ Add KPI</button></div>
    </div>
  );
}

export const measuresText = (ms?: Dict[]) =>
  (ms || []).map(m => `${m.name} (${m.dir === 'higher' ? 'higher' : 'lower'} is better; target ${m.target}${m.scaleUp != null ? ', scale up at ' + m.scaleUp : ''}, stop at ${m.stop})`).join('; ');
