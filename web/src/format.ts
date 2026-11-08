// Small display helpers. Dates show in the browser's time zone; the engine stores milliseconds.

export const fdate = (ms?: number | null) =>
  ms ? new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';

export const fdatetime = (ms?: number | null) =>
  ms ? new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';

export const ago = (ms?: number | null) => {
  if (!ms) return '';
  const d = Math.floor((Date.now() - ms) / 86400000);
  return d <= 0 ? 'today' : d === 1 ? '1 day' : d + ' days';
};

export const money = (n: unknown) =>
  n === '' || n == null || isNaN(Number(n)) ? '' : '$' + Math.round(Number(n)).toLocaleString('en-US');

export const plural = (n: number, word: string) => n + ' ' + word + (n === 1 ? '' : 's');
