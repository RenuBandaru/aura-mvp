// Cards for AI tools and use cases that look like an idea: on New suggestion while you type, and in
// the form's Existing solutions list. Build 27's matchCard and dupeCase. Nothing here moves you inside
// the app, so a draft is never lost.

import { useApp } from '../state';
import type { Dict } from '../types';

const STOP = new Set(('that this with from they them their have has had will would could should about into over under than then when where which '
  + 'while what your you are was were been being also only each other more most some such very can may might must not and for the '
  + 'our out use used using make made way any all new').split(' '));

/** The distinct meaningful words in a text (4+ letters, not a stop word). Build 27's matchTerms; the API matches on the same words. */
export const matchTerms = (text: string) => {
  const out: string[] = [];
  for (const w of String(text || '').toLowerCase().split(/[^a-z0-9]+/)) if (w.length >= 4 && !STOP.has(w) && !out.includes(w)) out.push(w);
  return out;
};

const TOOL_TONE: Record<string, string> = { approved: 'ok', review: 'warn', not_approved: 'bad', draft: 'auto' };

export const ToolChip = ({ status }: { status: string }) => {
  const { boot } = useApp();
  return <span className={'chip ' + (TOOL_TONE[status] || '')}>{boot.toolStatus[status] || status}</span>;
};

const ICO_NP = <svg className="ico" role="img" aria-label="Rejected as not permitted" width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.5" fill="none" stroke="#b3261e" strokeWidth="1.8" /><line x1="3.6" y1="12.4" x2="12.4" y2="3.6" stroke="#b3261e" strokeWidth="1.8" strokeLinecap="round" /></svg>;
const ICO_REJ = <svg className="ico" role="img" aria-label="Rejected" width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="#fdebc8" stroke="#9a5200" strokeWidth="1.2" /><path d="M5.3 8.5a2.9 2.9 0 1 0 .9-2.2M5.3 4.7v2.1h2.1" fill="none" stroke="#9a5200" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>;

function DupeCase({ c }: { c: Dict }) {
  const { boot } = useApp();
  if (c.stage !== 'closed' || !c.closed) return <span><b>{c.title}</b> (use case, {boot.stageLabels[c.stage]})</span>;
  const np = !!c.closed.notPermitted, reason = String(c.closed.reason || '').trim(), short = reason.length > 160 ? reason.slice(0, 157) + '...' : reason;
  return <span>{np ? ICO_NP : ICO_REJ} <b>{c.title}</b> <b>{np ? 'Rejected as not permitted' : 'Rejected'}</b>
    {reason && <><br /><span className="muted small">Reason: {short}</span>{reason.length > 160 && <details className="small"><summary>Read the full reason</summary>{reason}</details>}</>}</span>;
}

export function MatchCard({ m }: { m: Dict }) {
  const { name } = useApp();
  const words = m.words || [];
  if (m.kind === 'tool') {
    const t = m.ref;
    return <div className="mcard"><div><b>{t.name}</b> <ToolChip status={t.status} /></div>{t.purpose && <div className="small">{t.purpose}</div>}
      <div className="muted small">AI tool · Owner: {name(t.ownerId)}{t.accessNote ? ' · ' + t.accessNote : ''}
        {t.link && /^https?:\/\//.test(t.link) && <> · <a href={t.link} target="_blank" rel="noopener noreferrer">Open the tool's page</a></>}</div>
      {words.length > 0 && <div className="muted small">Matched: {words.join(', ')}</div>}</div>;
  }
  return <div className="mcard"><DupeCase c={m.ref} />{words.length > 0 && <div className="muted small">Matched: {words.join(', ')}</div>}</div>;
}
