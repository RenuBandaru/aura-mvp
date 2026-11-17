// Small display helpers. Dates show in the browser's time zone; the engine stores milliseconds.

export const fdate = (ms?: number | null) =>
  ms ? new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';

export const fdatetime = (ms?: number | null) =>
  ms ? new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';

export const DAY = 86400000;

/** The demo clock: the Data and demo page can move time forward, and every "days" figure counts from it. */
let clockOffset = 0;
export const setClockOffset = (ms: number) => { clockOffset = ms || 0; };
export const nowMs = () => Date.now() + clockOffset;

/** Short date without the year, as build 27 shows due dates ("Nov 3"). */
export const fdateShort = (ms?: number | null) => ms ? new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';

export const ago = (ms?: number | null) => {
  if (!ms) return '';
  const d = Math.floor((nowMs() - ms) / DAY);
  return d <= 0 ? 'today' : d === 1 ? '1 day' : d + ' days';
};

export const money = (n: unknown) =>
  n === '' || n == null || isNaN(Number(n)) ? '' : '$' + Math.round(Number(n)).toLocaleString('en-US');

export const plural = (n: number, word: string) => n + ' ' + word + (n === 1 ? '' : 's');
