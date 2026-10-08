// Security and integration tests against the local Supabase-compatible backend (tests/backend/start.sh).
// Covers: agency creation, pairing by invite, data isolation from strangers, sync rules, file storage
// policies, and the Edge Functions (AI proxy, Google Calendar, Canva) against fake external APIs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const URL_ = 'http://127.0.0.1:54321';
const MOCK = 'http://127.0.0.1:54340';
const ANON = fs.readFileSync('/tmp/momenty-backend-logs/anon.key', 'utf8').trim();
const uid = () => crypto.randomUUID();
const email = (n) => `${n}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`;

async function call(path, { method = 'GET', token, body, headers = {}, raw } = {}) {
  const res = await fetch(URL_ + path, {
    method,
    headers: { apikey: ANON, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body && !raw ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });
  const text = await res.text();
  let data = text;
  try { data = JSON.parse(text); } catch { /* binary or text */ }
  return { status: res.status, data, res };
}
const signup = async (name) => {
  const r = await call('/auth/v1/signup', { method: 'POST', body: { email: email(name), password: 'Haslo-Testowe-123' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return { token: r.data.access_token, id: r.data.user.id };
};
const rpc = (fn, token, args = {}) => call(`/rest/v1/rpc/${fn}`, { method: 'POST', token, body: args });
const rec = (data, col = 'tasks', updated_at = new Date().toISOString()) => ({ id: uid(), col, data, updated_at, deleted: false });

let admin, partner, stranger, inviteCode, wsId;

test('admin creates the agency (only once)', async () => {
  admin = await signup('admin');
  let s = await rpc('agency_status', admin.token);
  assert.equal(s.data.exists, false);
  const c = await rpc('create_workspace', admin.token, { p_name: 'Momenty Agency', p_slot: 'p1', p_display_name: 'Kasia' });
  assert.equal(c.status, 200, JSON.stringify(c.data));
  wsId = c.data;
  s = await rpc('agency_status', admin.token);
  assert.deepEqual([s.data.member, s.data.role, s.data.slot], [true, 'admin', 'p1']);
  const again = await rpc('create_workspace', admin.token, { p_name: 'X', p_slot: 'p1', p_display_name: 'X' });
  assert.notEqual(again.status, 200, 'second agency must be refused');
});

test('admin data is saved and readable by the admin', async () => {
  const rows = [rec({ title: 'Zadanie admina' }), rec({ name: 'Klient poufny' }, 'contacts')];
  const p = await rpc('push_records', admin.token, { p_rows: rows });
  assert.equal(p.data, 2);
  const r = await call('/rest/v1/records?select=id,col,data,seq&order=seq.asc', { token: admin.token });
  assert.equal(r.data.length, 2);
});

test('a stranger with an account sees nothing and cannot write or create an agency', async () => {
  stranger = await signup('stranger');
  const s = await rpc('agency_status', stranger.token);
  assert.equal(s.data.member, false);
  const r = await call('/rest/v1/records?select=*', { token: stranger.token });
  assert.deepEqual(r.data, []);
  const m = await call('/rest/v1/members?select=*', { token: stranger.token });
  assert.deepEqual(m.data, []);
  const w = await call('/rest/v1/workspace?select=*', { token: stranger.token });
  assert.deepEqual(w.data, []);
  const push = await rpc('push_records', stranger.token, { p_rows: [rec({ title: 'hack' })] });
  assert.notEqual(push.status, 200);
  const ins = await call('/rest/v1/records', { method: 'POST', token: stranger.token, body: { id: uid(), workspace_id: wsId, col: 'tasks', data: {}, updated_at: new Date().toISOString() } });
  assert.ok(ins.status >= 400, `direct insert must fail, got ${ins.status}`);
  const inv = await rpc('create_invite', stranger.token, { p_display_name: 'Ja', p_role: 'admin' });
  assert.notEqual(inv.status, 200);
  const red = await rpc('redeem_invite', stranger.token, { p_code: 'deadbeef' });
  assert.notEqual(red.status, 200);
  const cw = await rpc('create_workspace', stranger.token, { p_name: 'Moja', p_slot: 'p1', p_display_name: 'Ja' });
  assert.notEqual(cw.status, 200);
  const tok = await call('/rest/v1/oauth_tokens?select=*', { token: stranger.token });
  assert.ok(tok.status >= 400 || (Array.isArray(tok.data) && tok.data.length === 0));
});

test('anonymous (no account) access is denied', async () => {
  const r = await call('/rest/v1/records?select=*');
  assert.ok(r.status >= 400 || (Array.isArray(r.data) && r.data.length === 0), `got ${r.status}`);
  const f = await rpc('agency_status', null);
  assert.ok(f.status >= 400, 'functions must not be callable anonymously');
  const inv = await call('/rest/v1/invites?select=*');
  assert.ok(inv.status >= 400);
});

test('admin invites the partner; partner pairs and syncs both ways', async () => {
  const inv = await rpc('create_invite', admin.token, { p_display_name: 'Ola', p_role: 'admin' });
  assert.equal(inv.status, 200, JSON.stringify(inv.data));
  inviteCode = inv.data;
  assert.match(inviteCode, /^[0-9a-f]{36}$/);
  const raw = await call('/rest/v1/invites?select=*', { token: admin.token });
  assert.ok(raw.status >= 400, 'invite table must not be readable directly');

  partner = await signup('partner');
  const red = await rpc('redeem_invite', partner.token, { p_code: inviteCode });
  assert.equal(red.status, 200, JSON.stringify(red.data));
  assert.equal(red.data.slot, 'p2');
  const s = await rpc('agency_status', partner.token);
  assert.deepEqual([s.data.member, s.data.role], [true, 'admin']);

  const r = await call('/rest/v1/records?select=*', { token: partner.token });
  assert.equal(r.data.length, 2, 'partner sees the agency data');
  const mine = rec({ title: 'Zadanie partnerki' });
  await rpc('push_records', partner.token, { p_rows: [mine] });
  const seen = await call(`/rest/v1/records?id=eq.${mine.id}&select=*`, { token: admin.token });
  assert.equal(seen.data.length, 1, 'admin sees partner data');
  const strangerView = await call('/rest/v1/records?select=*', { token: stranger.token });
  assert.deepEqual(strangerView.data, [], 'stranger still sees nothing');
});

test('an invite code works only once', async () => {
  const late = await signup('late');
  const red = await rpc('redeem_invite', late.token, { p_code: inviteCode });
  assert.notEqual(red.status, 200);
});

test('newer change wins; older change is ignored; seq increases', async () => {
  const r = rec({ title: 'v1' }, 'tasks', '2026-10-08T10:00:00Z');
  await rpc('push_records', admin.token, { p_rows: [r] });
  const newer = await rpc('push_records', partner.token, { p_rows: [{ ...r, data: { title: 'v2' }, updated_at: '2026-10-08T11:00:00Z' }] });
  assert.equal(newer.data, 1);
  const older = await rpc('push_records', admin.token, { p_rows: [{ ...r, data: { title: 'old' }, updated_at: '2026-10-08T09:00:00Z' }] });
  assert.equal(older.data, 0);
  const got = await call(`/rest/v1/records?id=eq.${r.id}&select=data,seq`, { token: admin.token });
  assert.equal(got.data[0].data.title, 'v2');
  const after = await call(`/rest/v1/records?seq=gt.${got.data[0].seq - 1}&select=id`, { token: partner.token });
  assert.ok(after.data.some((x) => x.id === r.id));
});

test('member (non-admin) cannot invite; admin can remove a member', async () => {
  const inv = await rpc('create_invite', admin.token, { p_display_name: 'Asystentka', p_role: 'member' });
  const helper = await signup('helper');
  await rpc('redeem_invite', helper.token, { p_code: inv.data });
  const tryInvite = await rpc('create_invite', helper.token, { p_display_name: 'X' });
  assert.notEqual(tryInvite.status, 200);
  const members = await call('/rest/v1/members?select=user_id,role,slot', { token: admin.token });
  assert.equal(members.data.length, 3);
  const rm = await rpc('remove_member', admin.token, { p_user: helper.id });
  assert.ok(rm.status === 200 || rm.status === 204, JSON.stringify(rm.data));
  const view = await call('/rest/v1/records?select=*', { token: helper.token });
  assert.deepEqual(view.data, [], 'removed member loses access');
  const self = await rpc('remove_member', admin.token, { p_user: admin.id });
  assert.notEqual(self.status, 200);
});

test('files: members share, strangers are blocked', async () => {
  const path = `${wsId}/${uid()}`;
  const up = await call(`/storage/v1/object/files/${path}`, { method: 'POST', token: admin.token, raw: Buffer.from('zdjecie'), headers: { 'Content-Type': 'image/jpeg', 'x-upsert': 'true' } });
  assert.equal(up.status, 200, JSON.stringify(up.data));
  const got = await fetch(`${URL_}/storage/v1/object/files/${path}`, { headers: { apikey: ANON, Authorization: `Bearer ${partner.token}` } });
  assert.equal(got.status, 200);
  assert.equal(await got.text(), 'zdjecie');
  const s = await fetch(`${URL_}/storage/v1/object/files/${path}`, { headers: { apikey: ANON, Authorization: `Bearer ${stranger.token}` } });
  assert.notEqual(s.status, 200, 'stranger cannot download');
  const sUp = await call(`/storage/v1/object/files/${wsId}/x`, { method: 'POST', token: stranger.token, raw: Buffer.from('x'), headers: { 'Content-Type': 'text/plain' } });
  assert.notEqual(sUp.status, 200, 'stranger cannot upload');
});

test('AI function: members only, forwards to Anthropic with the server key', async () => {
  await fetch(`${MOCK}/__reset`);
  const ok = await call('/functions/v1/ai', { method: 'POST', token: admin.token, body: { messages: [{ role: 'user', content: 'Cześć' }] } });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.content[0].text, 'OK (mock)');
  const log = await (await fetch(`${MOCK}/__log`)).json();
  const sent = JSON.parse(log.find((l) => l.path === '/v1/messages').body);
  assert.equal(sent.model, 'claude-opus-5-5');
  assert.deepEqual(sent.thinking, { type: 'adaptive' });
  assert.equal(sent.fallbacks, 'default');
  const no = await call('/functions/v1/ai', { method: 'POST', token: stranger.token, body: { messages: [{ role: 'user', content: 'x' }] } });
  assert.equal(no.status, 403);
  const anon = await call('/functions/v1/ai', { method: 'POST', body: { messages: [{ role: 'user', content: 'x' }] } });
  assert.equal(anon.status, 401);
});

test('Google Calendar: connect once, events created/updated/removed with reminders', async () => {
  await fetch(`${MOCK}/__reset`);
  const st = await call('/functions/v1/google/start', { method: 'POST', token: admin.token, body: {} });
  assert.equal(st.status, 200);
  const u = new URL(st.data.url);
  assert.equal(u.searchParams.get('access_type'), 'offline');
  assert.equal(u.searchParams.get('redirect_uri'), 'http://127.0.0.1:54321/functions/v1/google/callback');
  // Google redirects the browser to the callback:
  const cb = await fetch(`${URL_}/functions/v1/google/callback?code=good-code&state=${u.searchParams.get('state')}`);
  const html = await cb.text();
  assert.equal(cb.status, 200, html);
  assert.match(html, /połączony/);
  const replay = await fetch(`${URL_}/functions/v1/google/callback?code=good-code&state=${u.searchParams.get('state')}`);
  assert.equal(replay.status, 400, 'state is single-use');
  const status = await call('/functions/v1/google/status', { method: 'POST', token: admin.token, body: {} });
  assert.deepEqual(status.data, { connected: true, account: 'agencja@example.com' });
  const conns = await rpc('my_connections', admin.token);
  assert.ok(conns.data.google);
  assert.equal(JSON.stringify(conns.data).includes('g-refresh'), false, 'tokens never reach the client');

  const t1 = uid(), t2 = uid();
  const events = [
    { id: t1, title: 'Embargo', date: '2026-10-12', time: '09:00', reminders: [2880, 1440, 120] },
    { id: t2, title: 'Raport', date: '2026-10-13', reminders: [960] },
  ];
  let s = await call('/functions/v1/google/sync', { method: 'POST', token: admin.token, body: { events } });
  assert.equal(s.data.created, 2, JSON.stringify(s.data));
  let g = await (await fetch(`${MOCK}/__google/events`)).json();
  const emb = g.find((e) => e.summary === 'Embargo');
  assert.deepEqual(emb.start, { dateTime: '2026-10-12T09:00:00', timeZone: 'Europe/Warsaw' });
  assert.deepEqual(emb.reminders.overrides.map((o) => o.minutes), [2880, 1440, 120]);
  assert.deepEqual(g.find((e) => e.summary === 'Raport').start, { date: '2026-10-13' });

  s = await call('/functions/v1/google/sync', { method: 'POST', token: admin.token, body: { events } });
  assert.equal(s.data.unchanged, 2, 'no duplicate events');
  s = await call('/functions/v1/google/sync', { method: 'POST', token: admin.token, body: { events: [{ ...events[0], title: 'Embargo – zmiana' }, { ...events[1], remove: true }] } });
  assert.deepEqual([s.data.updated, s.data.removed], [1, 1]);
  g = await (await fetch(`${MOCK}/__google/events`)).json();
  assert.deepEqual(g.map((e) => e.summary), ['Embargo – zmiana']);

  const other = await call('/functions/v1/google/sync', { method: 'POST', token: partner.token, body: { events } });
  assert.equal(other.status, 409, 'partner must connect her own calendar');
  const disc = await call('/functions/v1/google/disconnect', { method: 'POST', token: admin.token, body: {} });
  assert.equal(disc.status, 200);
});

test('Canva: connect, list, create, import (export) a design', async () => {
  await fetch(`${MOCK}/__reset`);
  const st = await call('/functions/v1/canva/start', { method: 'POST', token: partner.token, body: {} });
  const u = new URL(st.data.url);
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(u.searchParams.get('code_challenge'));
  const cb = await fetch(`${URL_}/functions/v1/canva/callback?code=canva-code&state=${u.searchParams.get('state')}`);
  assert.equal(cb.status, 200, await cb.text());
  const status = await call('/functions/v1/canva/status', { method: 'POST', token: partner.token, body: {} });
  assert.deepEqual(status.data, { connected: true, account: 'Momenty Canva' });
  const list = await call('/functions/v1/canva/designs', { method: 'POST', token: partner.token, body: { query: 'serum' } });
  assert.deepEqual(list.data.items.map((d) => d.title), ['Post – Premiera serum']);
  assert.ok(list.data.items[0].edit_url);
  const created = await call('/functions/v1/canva/create', { method: 'POST', token: partner.token, body: { title: 'Nowy post', width: 1080, height: 1350 } });
  assert.equal(created.data.id, 'DNEW');
  const log = await (await fetch(`${MOCK}/__log`)).json();
  const createBody = JSON.parse(log.find((l) => l.path === '/canva/api/v1/designs' && l.method === 'POST').body);
  assert.deepEqual(createBody.design_type, { type: 'custom', width: 1080, height: 1350 });
  const exp = await call('/functions/v1/canva/export', { method: 'POST', token: partner.token, body: { design_id: 'DAF1', format: 'png' } });
  assert.equal(exp.status, 200, JSON.stringify(exp.data).slice(0, 200));
  assert.equal(exp.data.mime, 'image/png');
  assert.equal(Buffer.from(exp.data.data, 'base64').subarray(1, 4).toString(), 'PNG');
  const fresh = await call('/functions/v1/canva/design', { method: 'POST', token: partner.token, body: { id: 'DAF1' } });
  assert.equal(fresh.data.edit_url, 'https://www.canva.com/api/design/fresh/edit', 'fresh edit link');
  // return navigation: genuine token accepted, forged or wrong-audience token rejected
  const good = await (await fetch(`${MOCK}/__canva/return-jwt?design=DAF1&state=eyJwIjoiMSJ9`)).json();
  const back = await fetch(`${URL_}/functions/v1/canva/return?correlation_jwt=${good.token}`);
  const backHtml = await back.text();
  assert.equal(back.status, 200, backHtml);
  assert.match(backHtml, /#\/canva-powrot\?design=DAF1&s=eyJwIjoiMSJ9/);
  const forged = await (await fetch(`${MOCK}/__canva/return-jwt?design=DAF1&state=x&forged=1`)).json();
  assert.equal((await fetch(`${URL_}/functions/v1/canva/return?correlation_jwt=${forged.token}`)).status, 400, 'forged token rejected');
  const wrongAud = await (await fetch(`${MOCK}/__canva/return-jwt?design=DAF1&state=x&aud=someone-else`)).json();
  assert.equal((await fetch(`${URL_}/functions/v1/canva/return?correlation_jwt=${wrongAud.token}`)).status, 400, 'token for another app rejected');
  const stranger403 = await call('/functions/v1/canva/designs', { method: 'POST', token: stranger.token, body: {} });
  assert.equal(stranger403.status, 403);
});
