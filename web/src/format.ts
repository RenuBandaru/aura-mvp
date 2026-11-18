// Small display helpers. Dates show in the browser's time zone; the engine stores milliseconds.

/** "Nov 3", as build 27 shows most dates (its fdate). */
export const fdate = (ms?: number | null) =>
  ms ? new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';

/** "Nov 3, 2026", where build 27 shows the year (its fdateY). */
export const fdateY = (ms?: number | null) =>
  ms ? new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';

/** "Nov 3, 2026, 4:05 PM": the Activity tab and the Audit log, which always show the year (build 27's fdy). */
export const fdatetime = (ms?: number | null) =>
  ms ? new Date(ms).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';

/** "Nov 3, 4:05 PM": email times in the Outbox (build 27's fdt). */
export const fdt = (ms?: number | null) =>
  ms ? new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';

/** "EST (America/New_York)": the time zone line under the Activity log (build 27's tzName). */
export const tzName = () => {
  try {
    const z = new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' }).formatToParts(new Date()).find(x => x.type === 'timeZoneName')?.value;
    return z + ' (' + Intl.DateTimeFormat().resolvedOptions().timeZone + ')';
  } catch { return 'your browser time zone'; }
};

export const DAY = 86400000;

/** The demo clock: the Data and demo page can move time forward, and every "days" figure counts from it. */
let clockOffset = 0;
export const setClockOffset = (ms: number) => { clockOffset = ms || 0; };
export const nowMs = () => Date.now() + clockOffset;

/** Short date without the year; the same as fdate. */
export const fdateShort = fdate;

/** "today", "1 day ago", "5 days ago" (build 27's ago). */
export const ago = (ms?: number | null) => {
  if (!ms) return '';
  const d = Math.floor((nowMs() - ms) / DAY);
  return d <= 0 ? 'today' : d === 1 ? '1 day ago' : d + ' days ago';
};

export const money = (n: unknown) =>
  n === '' || n == null || isNaN(Number(n)) ? '' : '$' + Math.round(Number(n)).toLocaleString('en-US');

export const plural = (n: number, word: string) => n + ' ' + word + (n === 1 ? '' : 's');
