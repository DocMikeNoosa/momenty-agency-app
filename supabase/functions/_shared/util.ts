// Shared helpers for the Momenty Agency Edge Functions.

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function env(name: string, fallback?: string): string {
  const v = Deno.env.get(name) ?? fallback;
  if (v == null || v === '') throw new HttpError(500, `Brak konfiguracji serwera: ${name}`);
  return v;
}

const SUPABASE_URL = () => env('SUPABASE_URL').replace(/\/$/, '');
const SERVICE_KEY = () => env('SUPABASE_SERVICE_ROLE_KEY');

/** REST call to the database with the service role (bypasses RLS – server only). */
export async function db(path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${SUPABASE_URL()}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY(),
      Authorization: `Bearer ${SERVICE_KEY()}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new HttpError(500, `DB ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

export interface Member { user_id: string; workspace_id: string; role: string; slot: string; display_name: string; email: string | null }

/** Verifies the caller's Supabase session and that they belong to the agency. */
export async function requireMember(req: Request): Promise<Member> {
  const auth = req.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) throw new HttpError(401, 'Brak logowania');
  const res = await fetch(`${SUPABASE_URL()}/auth/v1/user`, { headers: { Authorization: auth, apikey: SERVICE_KEY() } });
  if (!res.ok) throw new HttpError(401, 'Sesja wygasła – zaloguj się ponownie');
  const user = await res.json();
  const rows = await db(`members?user_id=eq.${encodeURIComponent(user.id)}&select=*`);
  if (!rows?.length) throw new HttpError(403, 'To konto nie należy do agencji');
  return rows[0];
}

export function randomToken(bytes = 32): string {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sha256b64url(s: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  return btoa(String.fromCharCode(...d)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Public URL of this function, used as the OAuth redirect URI. */
export function functionUrl(name: string): string {
  const base = Deno.env.get('PUBLIC_FUNCTIONS_URL') || `${SUPABASE_URL()}/functions/v1`;
  return `${base.replace(/\/$/, '')}/${name}`;
}

/** Path inside a function, e.g. /functions/v1/google/callback -> "callback". */
export function subPath(req: Request, name: string): string {
  const p = new URL(req.url).pathname;
  const i = p.indexOf(`/${name}`);
  return (i >= 0 ? p.slice(i + name.length + 1) : p).replace(/^\/+|\/+$/g, '');
}

export function htmlPage(title: string, message: string, ok = true): Response {
  const color = ok ? '#5C0100' : '#7a3b00';
  const body = `<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title></head><body style="margin:0;font:17px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;background:${color};color:#FAF6F0;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center;padding:24px;box-sizing:border-box">
<div style="max-width:420px"><div style="font-size:48px">${ok ? '✓' : '!'}</div><h1 style="font-weight:500">${title}</h1><p>${message}</p></div></body></html>`;
  return new Response(body, { status: ok ? 200 : 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

export function handle(fn: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    try {
      return await fn(req);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: 'Błąd serwera' }, 500);
    }
  };
}

/** Stores/refreshes OAuth tokens. */
export async function saveTokens(userId: string, provider: string, t: { refresh_token?: string; access_token?: string; expires_in?: number; account?: string; settings?: Record<string, unknown> }) {
  const row: Record<string, unknown> = {
    user_id: userId, provider, updated_at: new Date().toISOString(),
  };
  if (t.refresh_token) row.refresh_token = t.refresh_token;
  if (t.access_token) row.access_token = t.access_token;
  if (t.expires_in) row.expires_at = new Date(Date.now() + (t.expires_in - 60) * 1000).toISOString();
  if (t.account !== undefined) row.account = t.account;
  if (t.settings !== undefined) row.settings = t.settings;
  await db('oauth_tokens?on_conflict=user_id,provider', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(row),
  });
}

export async function getTokens(userId: string, provider: string) {
  const rows = await db(`oauth_tokens?user_id=eq.${userId}&provider=eq.${provider}&select=*`);
  return rows?.[0] || null;
}
