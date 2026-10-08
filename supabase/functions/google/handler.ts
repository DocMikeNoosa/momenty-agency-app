// Google Calendar: one-time connection (OAuth done on the server, works from any browser, also on iPhone)
// and pushing the app's dated tasks into the user's Google Calendar with reminders.
//
// Routes: POST /google/start · GET /google/callback · POST /google/sync · POST /google/status · POST /google/disconnect
import {
  db, env, functionUrl, getTokens, handle, htmlPage, HttpError, json, randomToken, requireMember, saveTokens, subPath,
} from '../_shared/util.ts';

const AUTH_URL = () => Deno.env.get('GOOGLE_AUTH_URL') || 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = () => Deno.env.get('GOOGLE_TOKEN_URL') || 'https://oauth2.googleapis.com/token';
const REVOKE_URL = () => Deno.env.get('GOOGLE_REVOKE_URL') || 'https://oauth2.googleapis.com/revoke';
const CAL_API = () => Deno.env.get('GOOGLE_CALENDAR_API') || 'https://www.googleapis.com/calendar/v3';
const SCOPES = 'openid email https://www.googleapis.com/auth/calendar.events';
const REDIRECT = () => `${functionUrl('google')}/callback`;
const TZ = 'Europe/Warsaw';

async function tokenRequest(params: Record<string, string>) {
  const res = await fetch(TOKEN_URL(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env('GOOGLE_CLIENT_ID'), client_secret: env('GOOGLE_CLIENT_SECRET'), ...params }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(res.status === 400 ? 401 : 502, `Google: ${data.error_description || data.error || res.status}`);
  return data;
}

async function accessToken(userId: string): Promise<string> {
  const t = await getTokens(userId, 'google');
  if (!t?.refresh_token) throw new HttpError(409, 'Kalendarz Google nie jest połączony.');
  if (t.access_token && t.expires_at && new Date(t.expires_at) > new Date()) return t.access_token;
  const fresh = await tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh_token });
  await saveTokens(userId, 'google', { access_token: fresh.access_token, expires_in: fresh.expires_in, refresh_token: fresh.refresh_token });
  return fresh.access_token;
}

function emailFromIdToken(idToken?: string): string {
  try {
    const p = idToken!.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(p + '==='.slice((p.length + 3) % 4))).email || '';
  } catch { return ''; }
}

interface EventIn {
  id: string; title: string; date: string; time?: string; durationMin?: number;
  description?: string; location?: string; reminders?: number[]; remove?: boolean;
}

function addDay(d: string) {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + 1);
  return x.toISOString().slice(0, 10);
}

function endTime(date: string, time: string, mins: number) {
  const [h, m] = time.split(':').map(Number);
  let total = h * 60 + m + mins;
  let d = date;
  if (total >= 1440) { total -= 1440; d = addDay(date); }
  return { date: d, time: `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}` };
}

export function toGoogleEvent(e: EventIn) {
  const ev: Record<string, unknown> = {
    summary: e.title.slice(0, 1000),
    description: (e.description || '').slice(0, 8000),
    location: e.location || undefined,
    reminders: {
      useDefault: false,
      overrides: [...new Set((e.reminders || []).filter((n) => Number.isFinite(n) && n >= 0 && n <= 40320))]
        .slice(0, 5).map((minutes) => ({ method: 'popup', minutes })),
    },
    extendedProperties: { private: { momentyTaskId: e.id } },
  };
  if (e.time && /^\d{2}:\d{2}$/.test(e.time)) {
    const end = endTime(e.date, e.time, e.durationMin || 60);
    ev.start = { dateTime: `${e.date}T${e.time}:00`, timeZone: TZ };
    ev.end = { dateTime: `${end.date}T${end.time}:00`, timeZone: TZ };
  } else {
    ev.start = { date: e.date };
    ev.end = { date: addDay(e.date) };
  }
  return ev;
}

async function hashOf(o: unknown) {
  const d = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(JSON.stringify(o)));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sync(userId: string, events: EventIn[]) {
  const token = await accessToken(userId);
  const t = await getTokens(userId, 'google');
  const calendarId = encodeURIComponent((t?.settings as any)?.calendarId || 'primary');
  const ids = events.map((e) => e.id).filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  const links = ids.length ? await db(`calendar_links?user_id=eq.${userId}&task_id=in.(${ids.join(',')})&select=*`) : [];
  const linkOf = new Map(links.map((l: any) => [l.task_id, l]));
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const out = { created: 0, updated: 0, removed: 0, unchanged: 0, errors: [] as { id: string; title: string; message: string }[] };

  for (const e of events.slice(0, 200)) {
    if (!/^[0-9a-f-]{36}$/i.test(e.id)) continue;
    const link: any = linkOf.get(e.id);
    try {
      if (e.remove || !e.date) {
        if (link) {
          const r = await fetch(`${CAL_API()}/calendars/${encodeURIComponent(link.calendar_id)}/events/${encodeURIComponent(link.event_id)}`, { method: 'DELETE', headers: auth });
          if (!r.ok && r.status !== 404 && r.status !== 410) throw new Error(`usuwanie ${r.status}`);
          await db(`calendar_links?user_id=eq.${userId}&task_id=eq.${e.id}`, { method: 'DELETE' });
          out.removed++;
        }
        continue;
      }
      const body = toGoogleEvent(e);
      const h = await hashOf(body);
      if (link && link.hash === h) { out.unchanged++; continue; }
      let res: Response | null = null;
      if (link) {
        res = await fetch(`${CAL_API()}/calendars/${encodeURIComponent(link.calendar_id)}/events/${encodeURIComponent(link.event_id)}`, { method: 'PATCH', headers: auth, body: JSON.stringify(body) });
        if (res.status === 404 || res.status === 410) res = null; // deleted in Google → create again
        else if (res.ok) out.updated++;
      }
      if (!res) {
        res = await fetch(`${CAL_API()}/calendars/${calendarId}/events`, { method: 'POST', headers: auth, body: JSON.stringify(body) });
        if (res.ok) out.created++;
      }
      if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 160)}`);
      const saved = await res.json();
      await db('calendar_links?on_conflict=user_id,task_id', {
        method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ user_id: userId, task_id: e.id, event_id: saved.id, calendar_id: decodeURIComponent(calendarId), hash: h }),
      });
    } catch (err) {
      out.errors.push({ id: e.id, title: e.title, message: (err as Error).message });
    }
  }
  return out;
}

export const handler = handle(async (req) => {
  const route = subPath(req, 'google');

  if (route === 'callback' && req.method === 'GET') {
    const u = new URL(req.url);
    const state = u.searchParams.get('state') || '';
    if (u.searchParams.get('error')) return htmlPage('Anulowano', 'Połączenie z Kalendarzem Google nie zostało zatwierdzone.', false);
    const rows = await db(`oauth_states?state=eq.${encodeURIComponent(state)}&provider=eq.google&select=*`);
    const st = rows?.[0];
    if (!st || Date.now() - new Date(st.created_at).getTime() > 15 * 60000) {
      return htmlPage('Link wygasł', 'Spróbuj połączyć kalendarz ponownie z aplikacji.', false);
    }
    await db(`oauth_states?state=eq.${encodeURIComponent(state)}`, { method: 'DELETE' });
    const tok = await tokenRequest({ grant_type: 'authorization_code', code: u.searchParams.get('code') || '', redirect_uri: REDIRECT() });
    if (!tok.refresh_token) {
      return htmlPage('Brak zgody offline', 'Google nie zwrócił tokenu odświeżania. Usuń dostęp aplikacji na myaccount.google.com/permissions i połącz ponownie.', false);
    }
    await saveTokens(st.user_id, 'google', {
      refresh_token: tok.refresh_token, access_token: tok.access_token, expires_in: tok.expires_in,
      account: emailFromIdToken(tok.id_token), settings: { calendarId: 'primary' },
    });
    return htmlPage('Kalendarz Google połączony', 'Możesz zamknąć tę kartę i wrócić do aplikacji Momenty. Zadania z datą pojawią się w Twoim kalendarzu z przypomnieniami.');
  }

  if (req.method !== 'POST') throw new HttpError(405, 'Nieobsługiwane');
  const member = await requireMember(req);

  if (route === 'start') {
    const state = randomToken(24);
    await db('oauth_states', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ state, user_id: member.user_id, provider: 'google' }) });
    const q = new URLSearchParams({
      client_id: env('GOOGLE_CLIENT_ID'), redirect_uri: REDIRECT(), response_type: 'code', scope: SCOPES,
      access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state,
    });
    return json({ url: `${AUTH_URL()}?${q}` });
  }
  if (route === 'status') {
    const t = await getTokens(member.user_id, 'google');
    return json({ connected: !!t?.refresh_token, account: t?.account || null });
  }
  if (route === 'sync') {
    const body = await req.json();
    if (!Array.isArray(body.events)) throw new HttpError(400, 'Brak listy wydarzeń');
    return json(await sync(member.user_id, body.events));
  }
  if (route === 'disconnect') {
    const t = await getTokens(member.user_id, 'google');
    if (t?.refresh_token) await fetch(`${REVOKE_URL()}?token=${encodeURIComponent(t.refresh_token)}`, { method: 'POST' }).catch(() => {});
    await db(`oauth_tokens?user_id=eq.${member.user_id}&provider=eq.google`, { method: 'DELETE' });
    await db(`calendar_links?user_id=eq.${member.user_id}`, { method: 'DELETE' });
    return json({ ok: true });
  }
  throw new HttpError(404, 'Nieznana ścieżka');
});
