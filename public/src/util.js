export const newId = (bytes = 9) => {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const fail = (status, message) => { throw new HttpError(status, message); };

export const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
});
export const errorResponse = e => (e instanceof HttpError
  ? json({ error: e.message }, e.status)
  : (console.error(e), json({ error: 'Something went wrong on the server' }, 500)));

export async function readJson(request) {
  try { const t = await request.text(); return t ? JSON.parse(t) : {}; } catch { return {}; }
}

export const normCode = c => String(c || '').trim().toLowerCase();
export const cleanName = n => String(n || '').replace(/\s+/g, ' ').trim().slice(0, 24);
