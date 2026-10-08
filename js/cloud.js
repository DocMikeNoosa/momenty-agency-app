// Cloud sync with the agency's own Supabase project: sign-in, pairing (invites), two-way sync of all
// records, shared photo/file storage, and calls to the server functions (AI, Google Calendar, Canva).
// Nothing here is shared with anyone who is not a member of the agency – the database enforces that.

import * as db from './db.js';

const K = {
  cfg: 'cloudCfg', session: 'cloudSession', seq: 'cloudSeq', dirty: 'cloudDirty',
  blobs: 'cloudBlobQueue', uploaded: 'cloudBlobsDone', last: 'cloudLastSync', gcal: 'gcalSent', conns: 'cloudConnections',
};
const listeners = new Set();
let state = { phase: 'off', error: null };
let syncing = null;
let timer = null;
let dirtyTimer = null;

// ---------- config & status ----------
export const config = () => db.kvGet(K.cfg, null);
export const isConfigured = () => !!config()?.url;
export const isLinked = () => !!(config()?.workspaceId && db.kvGet(K.session));
export const status = () => ({ ...state, last: db.kvGet(K.last) });
export const connections = () => db.kvGet(K.conns, {});
export function onStatus(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function setState(s) { state = { ...state, ...s }; listeners.forEach((fn) => fn(status())); }

export async function saveConfig(patch) {
  const next = { ...(config() || {}), ...patch };
  if (next.url) next.url = next.url.trim().replace(/\/+$/, '');
  if (next.key) next.key = next.key.trim();
  await db.kvSet(K.cfg, next);
  return next;
}

// ---------- invite links ----------
const b64u = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4))));

export function inviteLink(code, name) {
  const c = config();
  const z = b64u(JSON.stringify({ u: c.url, k: c.key, c: code, n: name }));
  return `${location.origin}${location.pathname}#/dolacz?z=${z}`;
}

/** Accepts a full invite link, just its "z" part, or anything containing "z=..." */
export function parseInvite(text) {
  if (!text) return null;
  const m = String(text).trim().match(/(?:[?&#]z=)?([A-Za-z0-9_-]{40,})\s*$/);
  if (!m) return null;
  try {
    const o = JSON.parse(unb64u(m[1]));
    if (!o.u || !o.k || !o.c) return null;
    return { url: o.u, key: o.k, code: o.c, name: o.n || '' };
  } catch { return null; }
}

// ---------- HTTP ----------
class CloudError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function http(path, { method = 'GET', body, auth = true, headers = {}, raw = false, retry = true } = {}) {
  const c = config();
  if (!c?.url) throw new CloudError(0, 'Brak połączenia z serwerem agencji.');
  const h = { apikey: c.key, ...headers };
  const sess = db.kvGet(K.session);
  if (auth && sess?.access_token) {
    if (sess.expires_at && sess.expires_at * 1000 < Date.now() + 60000 && retry) await refresh();
    h.Authorization = `Bearer ${db.kvGet(K.session)?.access_token}`;
  }
  if (body !== undefined && !raw) h['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(c.url + path, { method, headers: h, body: raw ? body : body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    throw new CloudError(0, 'Brak połączenia z internetem.');
  }
  if (res.status === 401 && auth && retry && db.kvGet(K.session)?.refresh_token) {
    if (await refresh()) return http(path, { method, body, auth, headers, raw, retry: false });
  }
  if (raw === 'blob' && res.ok) return res.blob();
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const msg = data?.msg || data?.message || data?.error_description || data?.error || `Błąd ${res.status}`;
    throw new CloudError(res.status, translate(String(msg)));
  }
  return data;
}

function translate(msg) {
  const map = [
    [/invalid login credentials/i, 'Nieprawidłowy e-mail lub hasło.'],
    [/user already registered|already been registered/i, 'Konto z tym e-mailem już istnieje – wybierz „Mam już konto”.'],
    [/email not confirmed/i, 'Potwierdź adres e-mail (link w wiadomości od Supabase), a potem zaloguj się ponownie.'],
    [/password should be at least/i, 'Hasło jest za krótkie dla serwera.'],
    [/agency already exists/i, 'Agencja już istnieje – poproś administratora o zaproszenie.'],
    [/invite is invalid/i, 'Zaproszenie jest nieprawidłowe, wykorzystane lub wygasło. Poproś o nowe.'],
    [/already a member/i, 'To konto już należy do agencji.'],
    [/only an admin/i, 'Tylko administrator może to zrobić.'],
    [/not a member/i, 'To konto nie należy do agencji.'],
    [/rate limit/i, 'Zbyt wiele prób – odczekaj chwilę.'],
  ];
  for (const [re, pl] of map) if (re.test(msg)) return pl;
  return msg;
}

// ---------- auth ----------
async function storeSession(s) {
  if (!s?.access_token) return null;
  const session = {
    access_token: s.access_token, refresh_token: s.refresh_token,
    expires_at: s.expires_at || Math.floor(Date.now() / 1000) + (s.expires_in || 3600),
    user: { id: s.user?.id, email: s.user?.email },
  };
  await db.kvSet(K.session, session);
  return session;
}

let refreshing = null;
async function refresh() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const rt = db.kvGet(K.session)?.refresh_token;
    if (!rt) return false;
    try {
      const s = await http('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: rt }, auth: false, retry: false });
      await storeSession(s);
      return true;
    } catch (e) {
      if (e.status >= 400 && e.status < 500) { await db.kvSet(K.session, null); setState({ phase: 'signedout', error: 'Sesja wygasła – zaloguj się ponownie w Ustawieniach.' }); }
      return false;
    } finally { setTimeout(() => { refreshing = null; }, 0); }
  })();
  return refreshing;
}

export async function signUp(email, password) {
  const s = await http('/auth/v1/signup', { method: 'POST', body: { email, password }, auth: false });
  if (!s?.access_token) throw new CloudError(400, 'Konto utworzone. Potwierdź adres e-mail (link w skrzynce), a potem wybierz „Mam już konto” i zaloguj się.');
  return storeSession(s);
}

export async function signIn(email, password) {
  const s = await http('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password }, auth: false });
  return storeSession(s);
}

export async function signOut({ forget = true } = {}) {
  try { await http('/auth/v1/logout', { method: 'POST' }); } catch { /* offline is fine */ }
  await db.kvSet(K.session, null);
  if (forget) {
    const c = config() || {};
    await db.kvSet(K.cfg, { url: c.url, key: c.key });
    await db.kvSet(K.seq, 0);
  }
  stopAuto();
  setState({ phase: 'off', error: null });
}

export const user = () => db.kvGet(K.session)?.user || null;
export const rpc = (fn, args = {}) => http(`/rest/v1/rpc/${fn}`, { method: 'POST', body: args });

// ---------- agency / pairing ----------
export async function agencyStatus() { return rpc('agency_status'); }

async function adopt(st) {
  await saveConfig({ workspaceId: st.workspace_id, slot: st.slot, role: st.role, agency: st.name, email: user()?.email });
  await refreshMembers();
}

/** First admin: create the agency and upload everything already on this device. */
export async function createAgency(displayName, slot) {
  await rpc('create_workspace', { p_name: 'Momenty Agency', p_slot: slot, p_display_name: displayName });
  const st = await agencyStatus();
  await adopt(st);
  await markAllDirty();
  return st;
}

/** Link this device to the agency (account already a member) – e.g. the admin's second device. */
export async function linkExisting() {
  const st = await agencyStatus();
  if (!st.member) {
    throw new CloudError(403, st.exists ? 'To konto nie należy jeszcze do agencji. Poproś administratora o zaproszenie.' : 'Agencja nie została jeszcze utworzona.');
  }
  await adopt(st);
  await markAllDirty();
  return st;
}

export async function join(code, displayName) {
  await rpc('redeem_invite', { p_code: code, p_display_name: displayName });
  const st = await agencyStatus();
  await adopt(st);
  return st;
}

export async function createInvite(name, role) {
  const code = await rpc('create_invite', { p_display_name: name, p_role: role });
  return inviteLink(code, name);
}

export const listInvites = () => rpc('list_invites');
export const removeMember = (userId) => rpc('remove_member', { p_user: userId });

export async function members() {
  return http('/rest/v1/members?select=user_id,role,slot,display_name,email,created_at&order=slot.asc');
}

async function refreshMembers() {
  const list = await members();
  if (!list?.length) return;
  // members from the server + people named on this device who have not joined yet (keeps task owners readable)
  const joined = list.map((m) => ({ id: m.slot, name: m.display_name, role: m.role, email: m.email, userId: m.user_id }));
  const pending = (db.kvGet('partners') || []).filter((p) => !p.userId && !joined.some((j) => j.id === p.id));
  await db.kvSet('partners', [...joined, ...pending].sort((a, b) => a.id.localeCompare(b.id)));
  const mine = list.find((m) => m.user_id === user()?.id);
  if (mine) { await db.kvSet('me', mine.slot); db.setActor(mine.slot); }
}

// ---------- sync ----------
function dirtySet() { return new Set(db.kvGet(K.dirty, [])); }

async function markAllDirty() {
  const ids = [];
  for (const col of db.COLLECTIONS) for (const r of db.all(col, { includeDeleted: true })) ids.push(`${col}:${r.id}`);
  await db.kvSet(K.dirty, ids);
  const q = new Set(db.kvGet(K.blobs, []));
  for (const f of db.all('files')) { if (f.blobId) q.add(f.blobId); if (f.thumbId) q.add(f.thumbId); }
  await db.kvSet(K.blobs, [...q]);
}

db.onLocalWrite((col, rec) => {
  if (!isConfigured()) return;
  const d = dirtySet();
  d.add(`${col}:${rec.id}`);
  db.kvSet(K.dirty, [...d]);
  if (col === 'files' && !rec.deleted) {
    const done = new Set(db.kvGet(K.uploaded, []));
    const q = new Set(db.kvGet(K.blobs, []));
    for (const b of [rec.blobId, rec.thumbId]) if (b && !done.has(b)) q.add(b);
    db.kvSet(K.blobs, [...q]);
  }
  clearTimeout(dirtyTimer);
  dirtyTimer = setTimeout(() => syncNow().catch(() => {}), 1500);
});

async function push() {
  const d = dirtySet();
  if (!d.size) return 0;
  const keys = [...d];
  let sent = 0;
  for (let i = 0; i < keys.length; i += 200) {
    const batch = keys.slice(i, i + 200);
    const rows = [];
    for (const k of batch) {
      const [col, id] = k.split(':');
      const r = db.getRaw(col, id);
      if (r) rows.push({ id: r.id, col, data: r, updated_at: r.updatedAt, deleted: !!r.deleted });
    }
    if (rows.length) await rpc('push_records', { p_rows: rows });
    sent += rows.length;
    const now = dirtySet();
    // keep anything that changed again while uploading
    for (const k of batch) { const [col, id] = k.split(':'); const r = db.getRaw(col, id); const row = rows.find((x) => x.id === id); if (!r || !row || r.updatedAt === row.updated_at) now.delete(k); }
    await db.kvSet(K.dirty, [...now]);
  }
  return sent;
}

async function pull() {
  let seq = Number(db.kvGet(K.seq, 0)) || 0;
  // re-read a small window to cover writes that committed out of order
  let from = Math.max(0, seq - 50);
  let got = 0;
  for (let guard = 0; guard < 200; guard++) {
    const rows = await http(`/rest/v1/records?select=id,col,data,updated_at,deleted,seq&seq=gt.${from}&order=seq.asc&limit=500`);
    if (!rows.length) break;
    const recs = rows.map((r) => ({ ...r.data, id: r.id, col: r.col, updatedAt: r.data?.updatedAt || r.updated_at, deleted: r.deleted }));
    got += await db.importRecords(recs);
    from = rows[rows.length - 1].seq;
    seq = Math.max(seq, from);
    if (rows.length < 500) break;
  }
  await db.kvSet(K.seq, seq);
  return got;
}

async function uploadBlobs() {
  const queue = db.kvGet(K.blobs, []);
  if (!queue.length) return;
  const done = new Set(db.kvGet(K.uploaded, []));
  const keep = [];
  let offline = false;
  for (const id of queue) {
    if (!id || done.has(id)) continue;
    if (offline) { keep.push(id); continue; }
    const blob = await db.getBlob(id);
    if (!blob) continue; // file was deleted on this device
    try {
      await http(`/storage/v1/object/files/${config().workspaceId}/${id}`, {
        method: 'POST', raw: true, body: blob, headers: { 'Content-Type': blob.type || 'application/octet-stream', 'x-upsert': 'true' },
      });
      done.add(id);
    } catch (e) { keep.push(id); if (e.status === 0) offline = true; }
  }
  await db.kvSet(K.blobs, keep);
  await db.kvSet(K.uploaded, [...done].slice(-5000));
}

/** Fetches a photo/file that another device uploaded. */
export async function downloadBlob(id) {
  if (!isLinked() || !id) return null;
  try {
    const blob = await http(`/storage/v1/object/files/${config().workspaceId}/${id}`, { raw: 'blob' });
    if (blob && blob.size) { await db.putBlob(id, blob); return blob; }
  } catch { /* not uploaded yet or offline */ }
  return null;
}

export async function syncNow() {
  if (!isLinked()) return null;
  if (syncing) return syncing;
  syncing = (async () => {
    setState({ phase: 'syncing', error: null });
    try {
      await push();
      const got = await pull();
      await uploadBlobs();
      if (Math.random() < 0.2 || !db.kvGet('partners')?.[0]?.userId) await refreshMembers();
      await db.kvSet(K.last, new Date().toISOString());
      setState({ phase: navigator.onLine === false ? 'offline' : 'ok', error: null });
      calendarSync().catch(() => {});
      return got;
    } catch (e) {
      setState({ phase: e.status === 0 ? 'offline' : 'error', error: e.message });
      throw e;
    } finally { syncing = null; }
  })();
  return syncing;
}

export function startAuto() {
  if (!isLinked()) { setState({ phase: isConfigured() && !db.kvGet(K.session) ? 'signedout' : 'off' }); return; }
  stopAuto();
  syncNow().catch(() => {});
  timer = setInterval(() => { if (!document.hidden) syncNow().catch(() => {}); }, 30000);
}
export function stopAuto() { clearInterval(timer); timer = null; }

if (typeof window !== 'undefined') {
  document.addEventListener('visibilitychange', () => { if (!document.hidden && timer) syncNow().catch(() => {}); });
  window.addEventListener('online', () => { if (timer) syncNow().catch(() => {}); });
}

// ---------- server functions ----------
export async function fn(name, sub = '', body = {}) {
  if (!isLinked()) throw new CloudError(0, 'Ta funkcja wymaga połączenia z serwerem agencji (Ustawienia → Zespół i synchronizacja).');
  return http(`/functions/v1/${name}${sub ? `/${sub}` : ''}`, { method: 'POST', body });
}

export async function refreshConnections() {
  const out = {};
  for (const p of ['google', 'canva']) {
    try { out[p] = await fn(p, 'status'); } catch (e) { out[p] = { connected: false, error: e.message }; }
  }
  await db.kvSet(K.conns, out);
  return out;
}

/** Step 1 of the one-time Google / Canva connection: returns the sign-in address to open in a browser. */
export async function startConnect(provider) {
  const { url } = await fn(provider, 'start');
  return url;
}

/** Step 2: waits until the server has received the authorisation (the user approved it in the browser). */
export async function waitConnected(provider, { signal } = {}) {
  for (let i = 0; i < 150; i++) {
    if (signal?.aborted) return null;
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const st = await fn(provider, 'status');
      if (st.connected) { await refreshConnections(); return st; }
    } catch { /* keep waiting */ }
  }
  return null;
}

export async function disconnectProvider(provider) {
  await fn(provider, 'disconnect');
  if (provider === 'google') await db.kvSet(K.gcal, {});
  await refreshConnections();
}

// ---------- Google Calendar push ----------
let calendarEventsFor = null; // injected by app (needs model helpers)
export function setCalendarMapper(f) { calendarEventsFor = f; }

export async function calendarSync({ force = false } = {}) {
  if (!isLinked() || !connections().google?.connected || !calendarEventsFor) return null;
  const sent = force ? {} : { ...db.kvGet(K.gcal, {}) };
  const events = calendarEventsFor();
  const want = new Map(events.map((e) => [e.id, e]));
  const changes = [];
  for (const e of events) { const h = JSON.stringify(e); if (sent[e.id] !== h) changes.push({ e, h }); }
  for (const id of Object.keys(sent)) if (!want.has(id)) changes.push({ e: { id, remove: true, title: '' }, h: null });
  if (!changes.length) return { created: 0, updated: 0, removed: 0, unchanged: events.length, errors: [] };
  const res = await fn('google', 'sync', { events: changes.map((c) => c.e) });
  const failed = new Set((res.errors || []).map((x) => x.id));
  for (const c of changes) {
    if (failed.has(c.e.id)) continue;
    if (c.h) sent[c.e.id] = c.h; else delete sent[c.e.id];
  }
  await db.kvSet(K.gcal, sent);
  return res;
}
