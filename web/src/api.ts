// Every call to the Python API goes through here. The person picked in "Viewing as" is sent with
// each request; with Microsoft sign-in this header is replaced by the signed-in user's token.

let actingAs = '';
export const setActingAs = (pid: string) => { actingAs = pid; };

/** An error the engine raised, with a message meant for people. */
export class ApiError extends Error {}

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const res = await fetch('/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Aura-Person': actingAs },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({ error: 'The server sent an unreadable answer.' }));
  if (!res.ok) throw new ApiError(data.error || 'Request failed (' + res.status + ').');
  return data as T;
}

export const get = <T,>(path: string) => call<T>('GET', path);
export const post = <T,>(path: string, body: unknown = {}) => call<T>('POST', path, body);

/** Ask the API for a CSV export ({filename, csv}) and save it as a file in the browser. */
export async function downloadCsv(path: string): Promise<void> {
  const { filename, csv } = await get<{ filename: string; csv: string }>(path);
  // A Blob holds the text, a temporary link points at it, and clicking the link saves it.
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
