// Editor for KPIs: a name, whether lower or higher is better, a target, an optional scale-up target and
// a stop limit. Values are kept as typed text; the engine checks and converts them (parseMeasures).

import type { Dict } from '../types';

export interface MeasureRow { name: string; dir: string; target: string; scaleUp: string; stop: string }

const text = (v: unknown) => (v === null || v === undefined ? '' : String(v));
export const toRows = (ms?: Dict[]): MeasureRow[] =>
  (ms || []).map(m => ({ name: text(m.name), dir: m.dir === 'higher' ? 'higher' : 'lower', target: text(m.target), scaleUp: text(m.scaleUp), stop: text(m.stop) }));
const blank = (): MeasureRow => ({ name: '', dir: 'lower', target: '', scaleUp: '', stop: '' });

const SLOTS = 4;

/** Build 27's measuresEditor: up to four rows, with at least minRows shown even when empty. */
export function MeasuresEditor({ rows, onChange, idPrefix, minRows = 0 }: { rows: MeasureRow[]; onChange: (r: MeasureRow[]) => void; idPrefix: string; minRows?: number }) {
  const shown = rows.length >= minRows ? rows : [...rows, ...Array.from({ length: minRows - rows.length }, blank)];
  const set = (i: number, k: keyof MeasureRow, v: string) => onChange(shown.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <div className="meas">
      {shown.length > 0 && <div className="mrow mhead" aria-hidden="true"><span>KPI</span><span>Better when</span><span>Target</span><span>Scale-up target (optional)</span><span>Stop limit</span><span /></div>}
      {shown.map((r, i) => (
        <div className="mrow" key={i}>
          <input type="text" aria-label={`KPI ${i + 1} name`} id={`${idPrefix}m${i}_name`} value={r.name} placeholder={i ? 'Another KPI' : 'For example: hours per week saved'} onChange={e => set(i, 'name', e.target.value)} />
          <select id={`${idPrefix}m${i}_dir`} value={r.dir} onChange={e => set(i, 'dir', e.target.value)}>
            <option value="lower">Lower is better</option><option value="higher">Higher is better</option>
          </select>
          <input type="number" step="any" id={`${idPrefix}m${i}_target`} aria-label={`KPI ${i + 1} target`} placeholder="Target" value={r.target} onChange={e => set(i, 'target', e.target.value)} />
          <input type="number" step="any" id={`${idPrefix}m${i}_scale`} aria-label={`KPI ${i + 1} scale-up target`} placeholder="Scale-up" value={r.scaleUp} onChange={e => set(i, 'scaleUp', e.target.value)} />
          <input type="number" step="any" id={`${idPrefix}m${i}_stop`} aria-label={`KPI ${i + 1} stop limit`} placeholder="Stop limit" value={r.stop} onChange={e => set(i, 'stop', e.target.value)} />
          <button type="button" className="btn sm kpidel" aria-label={`Remove KPI ${i + 1}`} title="Remove this KPI" onClick={() => onChange(shown.filter((_, j) => j !== i))}>&times;</button>
        </div>
      ))}
      <div className="kpiadd">{shown.length < SLOTS ? <button type="button" className="btn sm" onClick={() => onChange([...shown, blank()])}>+ Add a KPI</button>
        : <span className="muted small">Four KPIs is the maximum.</span>}</div>
    </div>
  );
}

export const measuresText = (ms?: Dict[]) =>
  (ms || []).map(m => `${m.name} (${m.dir === 'higher' ? 'higher' : 'lower'} is better; target ${m.target}${m.scaleUp != null ? ', scale up at ' + m.scaleUp : ''}, stop at ${m.stop})`).join('; ');
