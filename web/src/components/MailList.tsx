// Simulated emails: each one opens to the formatted message (as build 27 renders it) and its plain text.
// mailTag and mailHtml are build 27's functions of the same names, with types added.

import { useApp } from '../state';
import type { Mail } from '../types';
import { fdt } from '../format';

const esc = (v: unknown) => String(v == null ? '' : v).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[ch]);
const MAIL_CSS = `:root{--hdr:#004677;--brand:#004677;--accent:#ffc20e;--bg:#eef2f6;--surface:#fff;--surface-2:#f4f7fa;--ink:#13222f;--muted:#52667a;--line:#d3dce4}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 -apple-system,'Segoe UI',system-ui,sans-serif;padding:24px 16px}.tag{display:inline-block;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:3px 9px;border-radius:999px;white-space:nowrap}.k-decision{background:#e0f2e8;color:#1f7a4d}.k-task{background:#dbe9f4;color:#0a5a95}.k-return{background:#fdebc8;color:#9a5200}.k-close{background:#fbe2df;color:#b3261e}.k-notice{background:#e6ebf0;color:#3c4f61}.k-alert{background:#b3261e;color:#fff}.k-reminder{background:#fff3cf;color:#7a5a00}.k-consult{background:#ebe3f7;color:#5b3f9a}.mail{background:#fff;border:1px solid var(--line);border-radius:10px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08)}.meta{padding:12px 18px;border-bottom:1px solid var(--line);font-size:12.5px;color:var(--muted)}.meta b{color:var(--ink)}.hd{background:var(--hdr);color:#fff;padding:16px 22px;display:flex;align-items:center;gap:12px}.mark{width:40px;height:40px;flex:none}.mark .ring{fill:none;stroke:#b2c7d6;stroke-width:1.5}.mark .r1{opacity:.5}.mark .r2{opacity:.85}@media(prefers-reduced-motion:no-preference){.mark .r1{animation:aura 4.5s ease-in-out infinite}.mark .r2{animation:aura 4.5s ease-in-out .6s infinite}}@keyframes aura{0%,100%{opacity:.25}50%{opacity:.9}}.hd b{display:block;letter-spacing:.16em;font-size:17px}.hd small{font-size:11px;opacity:.8}.hd .tag{margin-left:auto}.body{padding:22px}.title{font-size:20px;font-weight:700;margin:0 0 2px}.sub{color:var(--muted);margin:0 0 16px}.banner{background:#e0f2e8;border-left:5px solid #1f7a4d;border-radius:6px;padding:12px 14px;margin-bottom:18px}.banner b{color:#1f7a4d;font-size:15px}.facts{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:6px}.fact{background:var(--surface-2);border:1px solid var(--line);border-radius:8px;padding:10px 12px}.fact small{display:block;color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.07em}.fact b{font-size:15px}h3{font-size:14px;margin:22px 0 8px;color:var(--brand);border-bottom:2px solid var(--accent);padding-bottom:4px;display:inline-block}table{border-collapse:collapse;width:100%;font-size:13px}th{background:var(--brand);color:#fff;text-align:left;padding:7px 10px;font-weight:600}td{padding:7px 10px;border-bottom:1px solid var(--line);vertical-align:top}tr:nth-child(even) td{background:var(--surface-2)}.pill{font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;display:inline-block}.p-ok{background:#e0f2e8;color:#1f7a4d}.p-ev{background:#dbe9f4;color:#0a5a95}.p-no{background:#fdebc8;color:#9a5200}.note{background:var(--surface-2);border:1px solid var(--line);border-radius:8px;padding:10px 12px;margin:0 0 8px}.btn{display:inline-block;background:var(--brand);color:#fff;text-decoration:none;font-weight:700;padding:11px 20px;border-radius:7px;margin-top:22px}.ft{padding:14px 22px;background:var(--surface-2);border-top:1px solid var(--line);font-size:12px;color:var(--muted)}@media(max-width:560px){.facts{grid-template-columns:1fr}}.ask{background:#fff;border:1px solid var(--line);border-left:5px solid var(--brand);border-radius:6px;padding:12px 14px;margin:0 0 12px}.due{background:#fff3cf;border-left:5px solid #c79100;border-radius:6px;padding:10px 14px;margin:0 0 14px}.ret{background:#fdebc8;border-left:5px solid #9a5200;border-radius:6px;padding:12px 14px;margin-bottom:16px}.ret b{color:#9a5200;font-size:15px}.est{background:#dbe9f4;border-left:5px solid #0a5a95;border-radius:6px;padding:12px 14px;margin-bottom:16px}.est b{color:#0a5a95;font-size:15px}.cav{color:var(--muted);font-size:13px}a.uc{color:#0a5a95;font-weight:700;text-decoration:underline}ol{margin:6px 0 0 18px;padding:0}`;
const MAIL_TAGS: Record<string, [string, string]> = { decision: ['decision', 'Decision'], task: ['task', 'Action needed'], return: ['return', 'Returned'], remediate: ['return', 'Returned'], close: ['close', 'Closed'], notice: ['notice', 'Notice'], alert: ['alert', 'Alert'], reminder: ['reminder', 'Reminder'], consult: ['consult', 'Consult'], requested: ['consult', 'Consult'] };
type Dict = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
function mailTag(m: Dict): [string, string] {
  const sj = m.subject || '';
  if (/^Reminder/i.test(sj) || m.kind === 'reminder') return MAIL_TAGS.reminder;
  if (/^(Consult requested|Your input is welcome)/i.test(sj)) return MAIL_TAGS.consult;
  if (/^Returned|declined sign-off|needs rework/i.test(sj)) return MAIL_TAGS.return;
  if (/^(Closed|Training reminder)/i.test(sj)) return /^Closed/i.test(sj) ? MAIL_TAGS.close : MAIL_TAGS.reminder;
  if (/stop limit/i.test(sj)) return MAIL_TAGS.alert;
  return MAIL_TAGS[m.kind] || MAIL_TAGS.notice;
}
function mailHtml(m: Dict): string {
  const [tk, tl] = mailTag(m), c = m.c || {}, isCase = /^UC-/.test(c.id || '');
  const lines = String(m.body || '').split(/\n+/).filter(Boolean);
  let x: Dict = {}; try { x = typeof m.x === 'string' ? JSON.parse(m.x) : (m.x || {}); } catch (e) { x = {}; } let inner = '';
  if (x.only) {
    if (x.banner) inner += `<div class="${x.banner[0]}"><b>${esc(x.banner[1])}</b><br>${esc(x.banner[2])}</div>`;
    if (x.due) inner += `<div class="due"><b>${esc(x.due[0])}</b> ${esc(x.due[1] || '')}</div>`;
    if (x.intro) inner += `<p style="margin:0 0 8px">${esc(x.intro)}</p>`;
    if (x.facts) inner += `<div class="facts" style="grid-template-columns:1fr 1fr">${x.facts.map((f: string[]) => `<div class="fact"><small>${esc(f[0])}</small><b>${esc(f[1])}</b></div>`).join('')}</div>`;
    (x.notes || []).forEach((n: string[]) => { inner += `<h3>${esc(n[0])}</h3><div class="${n[2] === 'ask' ? 'ask' : 'note'}">${esc(n[1])}</div>`; });
    if (x.caveat) inner += `<p class="cav" style="margin-top:12px">${esc(x.caveat)}</p>`;
  } else if (m.kind === 'decision') {
    const first = lines.shift() || '';
    const mm = first.match(/^Decision: (.*?), by (.*?) on (.*?)\.$/);
    inner += `<div class="banner"><b>${esc(mm ? mm[1].replace(/^./, (ch: string) => ch.toUpperCase()) : first)}</b><br>${mm ? 'Decided by ' + esc(mm[2]) + ' on ' + esc(mm[3]) + '. Please read the conditions below. They are part of the approval.' : ''}</div>`;
    lines.forEach(l => { const x = l.match(/^([A-Z][A-Za-z ]{2,40}): ([\s\S]*)$/); inner += x ? `<h3>${esc(x[1])}</h3><div class="note">${esc(x[2]).replace(/ \| /g, '<br>').replace(/; /g, ';<br>')}</div>` : `<p>${esc(l)}</p>`; });
  } else {
    const cls = tk === 'return' ? 'ret' : tk === 'reminder' ? 'due' : '';
    lines.forEach((l, i) => { inner += (i === 0 && cls) ? `<div class="${cls}">${esc(l)}</div>` : `<p style="margin:0 0 10px">${esc(l)}</p>`; });
  }
  const title = (c.title && c.id !== 'TRAINING') ? c.title : (m.subject || '');
  const foot = m.second ? 'This is a second reminder.' : 'This is a simulated message from the AURA prototype.';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${MAIL_CSS}body{padding:0;background:#fff}.cls{background:#fbe2df;border-left:5px solid #b3261e;border-radius:6px;padding:12px 14px;margin-bottom:16px}.cls b{color:#b3261e;font-size:15px}</style></head><body><div class="hd"><svg class="mark" viewBox="0 0 46 46" aria-hidden="true"><circle class="ring r1" cx="23" cy="23" r="21"/><circle class="ring r2" cx="23" cy="23" r="16.5"/><circle cx="23" cy="23" r="12" fill="#ffc20e"/><path d="M17 29l6-12 6 12M19.2 25h7.6" fill="none" stroke="#004677" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg><div><b>AURA</b><small>AI Use, Risk, and Assurance</small></div><span class="tag k-${tk}">${tl}</span></div><div class="body"><p class="title">${esc(m.subject || title)}</p><p class="sub">${isCase ? `<a class="uc" href="#">${esc(c.id)}</a> ${esc(c.title)}` : esc(c.title || '')}</p>${inner}${isCase ? `<a class="btn" href="#">${esc(x.button || 'Open in AURA')}</a>` : ''}</div><div class="ft">${foot}</div></body></html>`;
}

/** The emails, newest first: at most the latest 120, as build 27's Outbox shows them. */
export function MailList({ mails }: { mails: Mail[] }) {
  const { name } = useApp();
  if (!mails.length) return <div className="empty">No messages match.</div>;
  return (
    <>
      <div className="stack" style={{ gap: 8 }}>
        {mails.slice(0, 120).map((m, i) => (
          <details key={i} className="msg">
            <summary><b>{m.subject}</b><span className="chip">{m.kind || 'message'}</span>
              <span className="muted small">To {m.to.map(name).join(', ')}</span><span className="muted small">{fdt(m.ts)}</span></summary>
            <div className="body2" style={{ whiteSpace: 'normal' }}>
              <iframe className="mailframe" sandbox="" title="Message preview" loading="lazy" srcDoc={mailHtml({ ...m, c: m.ref })}
                style={{ width: '100%', height: 520, border: '1px solid var(--line)', borderRadius: 8, background: '#fff' }} />
              {/^UC-/.test(m.ref.id) && <p className="small"><a href={'#/case/' + m.ref.id}>Open {m.ref.id} in AURA</a></p>}
              <details className="small"><summary>Plain text version</summary>
                <div style={{ whiteSpace: 'pre-wrap' }}>{m.body + '\n\n' + (/^T-/.test(m.ref.id) ? 'AI tool' : 'Case') + ': ' + m.ref.id + ' ' + m.ref.title}</div></details>
            </div>
          </details>
        ))}
      </div>
      {mails.length > 120 && <p className="muted small">Showing the latest 120 of {mails.length}.</p>}
    </>
  );
}
