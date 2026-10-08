// Canva Connect: one-time connection (server-side OAuth with PKCE + client secret), browsing designs,
// creating a new design (opened in Canva's editor) and importing a design as PNG/PDF/JPG into the app.
//
// Routes: POST /canva/start · GET /canva/callback · POST /canva/status · POST /canva/designs
//         POST /canva/create · POST /canva/export · POST /canva/disconnect
import {
  db, env, functionUrl, getTokens, handle, htmlPage, HttpError, json, randomToken, requireMember, saveTokens, sha256b64url, subPath,
} from '../_shared/util.ts';

const AUTH_URL = () => Deno.env.get('CANVA_AUTH_URL') || 'https://www.canva.com/api/oauth/authorize';
const API = () => (Deno.env.get('CANVA_API') || 'https://api.canva.com/rest').replace(/\/$/, '');
const SCOPES = 'design:meta:read design:content:read design:content:write asset:read asset:write profile:read';
const REDIRECT = () => `${functionUrl('canva')}/callback`;

const basic = () => `Basic ${btoa(`${env('CANVA_CLIENT_ID')}:${env('CANVA_CLIENT_SECRET')}`)}`;

async function tokenRequest(params: Record<string, string>) {
  const res = await fetch(`${API()}/v1/oauth/token`, {
    method: 'POST',
    headers: { Authorization: basic(), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(res.status === 400 || res.status === 401 ? 401 : 502, `Canva: ${data.error_description || data.message || data.error || res.status}`);
  return data;
}

async function accessToken(userId: string): Promise<string> {
  const t = await getTokens(userId, 'canva');
  if (!t?.refresh_token) throw new HttpError(409, 'Canva nie jest połączona.');
  if (t.access_token && t.expires_at && new Date(t.expires_at) > new Date()) return t.access_token;
  // Canva rotates refresh tokens: always store the new one.
  const fresh = await tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh_token });
  await saveTokens(userId, 'canva', { access_token: fresh.access_token, expires_in: fresh.expires_in, refresh_token: fresh.refresh_token });
  return fresh.access_token;
}

async function canva(userId: string, path: string, init: RequestInit = {}) {
  const token = await accessToken(userId);
  const res = await fetch(`${API()}${path}`, {
    ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(res.status === 401 ? 401 : res.status === 403 ? 403 : 502, `Canva ${res.status}: ${data.message || data.code || ''}`);
  return data;
}

const summary = (d: any) => ({
  id: d.id, title: d.title || 'Bez tytułu', thumbnail: d.thumbnail?.url || null,
  edit_url: d.urls?.edit_url || null, view_url: d.urls?.view_url || null,
  updated_at: d.updated_at || null, page_count: d.page_count || null,
});

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', pdf: 'application/pdf' };

function toB64(buf: Uint8Array) {
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

export const handler = handle(async (req) => {
  const route = subPath(req, 'canva');

  if (route === 'callback' && req.method === 'GET') {
    const u = new URL(req.url);
    if (u.searchParams.get('error')) return htmlPage('Anulowano', 'Połączenie z Canvą nie zostało zatwierdzone.', false);
    const state = u.searchParams.get('state') || '';
    const rows = await db(`oauth_states?state=eq.${encodeURIComponent(state)}&provider=eq.canva&select=*`);
    const st = rows?.[0];
    if (!st || Date.now() - new Date(st.created_at).getTime() > 15 * 60000) {
      return htmlPage('Link wygasł', 'Spróbuj połączyć Canvę ponownie z aplikacji.', false);
    }
    await db(`oauth_states?state=eq.${encodeURIComponent(state)}`, { method: 'DELETE' });
    const tok = await tokenRequest({ grant_type: 'authorization_code', code: u.searchParams.get('code') || '', code_verifier: st.code_verifier, redirect_uri: REDIRECT() });
    let account = '';
    try {
      const p = await fetch(`${API()}/v1/users/me/profile`, { headers: { Authorization: `Bearer ${tok.access_token}` } }).then((r) => r.json());
      account = p?.profile?.display_name || '';
    } catch { /* optional */ }
    await saveTokens(st.user_id, 'canva', { refresh_token: tok.refresh_token, access_token: tok.access_token, expires_in: tok.expires_in, account });
    return htmlPage('Canva połączona', 'Możesz zamknąć tę kartę i wrócić do aplikacji Momenty.');
  }

  if (req.method !== 'POST') throw new HttpError(405, 'Nieobsługiwane');
  const member = await requireMember(req);
  const body = await req.json().catch(() => ({}));

  switch (route) {
    case 'start': {
      const state = randomToken(24);
      const verifier = randomToken(48);
      await db('oauth_states', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ state, user_id: member.user_id, provider: 'canva', code_verifier: verifier }) });
      const q = new URLSearchParams({
        code_challenge: await sha256b64url(verifier), code_challenge_method: 'S256', scope: SCOPES,
        response_type: 'code', client_id: env('CANVA_CLIENT_ID'), state, redirect_uri: REDIRECT(),
      });
      return json({ url: `${AUTH_URL()}?${q}` });
    }
    case 'status': {
      const t = await getTokens(member.user_id, 'canva');
      return json({ connected: !!t?.refresh_token, account: t?.account || null });
    }
    case 'designs': {
      const q = new URLSearchParams({ limit: '30', ownership: 'any' });
      if (body.query) q.set('query', String(body.query).slice(0, 255)); else q.set('sort_by', 'modified_descending');
      if (body.continuation) q.set('continuation', String(body.continuation));
      const data = await canva(member.user_id, `/v1/designs?${q}`);
      return json({ items: (data.items || []).map(summary), continuation: data.continuation || null });
    }
    case 'create': {
      const width = Math.min(Math.max(Number(body.width) || 1080, 40), 8000);
      const height = Math.min(Math.max(Number(body.height) || 1350, 40), 8000);
      const data = await canva(member.user_id, '/v1/designs', {
        method: 'POST',
        body: JSON.stringify({ type: 'type_and_asset', design_type: { type: 'custom', width, height }, title: String(body.title || 'Momenty – projekt').slice(0, 255) }),
      });
      return json(summary(data.design));
    }
    case 'export': {
      const format = ['png', 'jpg', 'pdf'].includes(body.format) ? body.format : 'png';
      if (!body.design_id) throw new HttpError(400, 'Brak design_id');
      const fmt: Record<string, unknown> = { type: format };
      if (format === 'jpg') fmt.quality = 90;
      let job = (await canva(member.user_id, '/v1/exports', { method: 'POST', body: JSON.stringify({ design_id: body.design_id, format: fmt }) })).job;
      const started = Date.now();
      while (job.status === 'in_progress' && Date.now() - started < 50000) {
        await new Promise((r) => setTimeout(r, 1500));
        job = (await canva(member.user_id, `/v1/exports/${encodeURIComponent(job.id)}`)).job;
      }
      if (job.status !== 'success' || !job.urls?.length) throw new HttpError(502, `Eksport z Canvy nie powiódł się${job.error?.message ? `: ${job.error.message}` : ''}.`);
      const file = await fetch(job.urls[0]);
      if (!file.ok) throw new HttpError(502, 'Nie udało się pobrać pliku z Canvy.');
      const buf = new Uint8Array(await file.arrayBuffer());
      if (buf.length > 20 * 1024 * 1024) throw new HttpError(413, 'Plik z Canvy jest za duży (ponad 20 MB).');
      return json({ mime: MIME[format], ext: format, pages: job.urls.length, data: toB64(buf) });
    }
    case 'disconnect': {
      const t = await getTokens(member.user_id, 'canva');
      if (t?.refresh_token) {
        await fetch(`${API()}/v1/oauth/revoke`, {
          method: 'POST', headers: { Authorization: basic(), 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: t.refresh_token }),
        }).catch(() => {});
      }
      await db(`oauth_tokens?user_id=eq.${member.user_id}&provider=eq.canva`, { method: 'DELETE' });
      return json({ ok: true });
    }
    default:
      throw new HttpError(404, 'Nieznana ścieżka');
  }
});
