// Fake Anthropic, Google and Canva endpoints for the automated tests (no real accounts are touched).
// Tests can queue scripted AI replies with POST /__ai/script and inspect calls with GET /__log.
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.MOCKS_PORT || 54340);
const here = path.dirname(fileURLToPath(import.meta.url));
const PNG = fs.readFileSync(path.join(here, '../../assets/icons/icon-192.png'));

const log = [];
// Canva signs return-navigation tokens with RS256; the function verifies them against these public keys.
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const JWK = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256', use: 'sig' };
function signJwt(payload, key = privateKey) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const data = `${enc({ alg: 'RS256', kid: 'test-key', typ: 'JWT' })}.${enc(payload)}`;
  return `${data}.${crypto.sign('RSA-SHA256', Buffer.from(data), key).toString('base64url')}`;
}
let aiScript = [];
const gEvents = new Map();
let gSeq = 0;
let exportPolls = 0;
const canvaDesigns = [
  { id: 'DAF1', title: 'Post – Premiera serum', thumbnail: { url: `http://127.0.0.1:${PORT}/canva/file.png`, width: 100, height: 100 }, urls: { edit_url: 'https://www.canva.com/api/design/x/edit', view_url: 'https://www.canva.com/api/design/x/view' }, updated_at: 1760000000 },
  { id: 'DAF2', title: 'Prezentacja dla klienta', thumbnail: { url: `http://127.0.0.1:${PORT}/canva/file.png`, width: 100, height: 100 }, urls: { edit_url: 'https://www.canva.com/api/design/y/edit', view_url: 'https://www.canva.com/api/design/y/view' }, updated_at: 1760000100 },
];

const body = (req) => new Promise((r) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => r(Buffer.concat(c).toString())); });
const send = (res, status, obj, type = 'application/json') => {
  res.writeHead(status, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*' });
  res.end(type === 'application/json' ? JSON.stringify(obj) : obj);
};
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

function aiReply(reqBody) {
  if (aiScript.length) {
    const next = aiScript.shift();
    return typeof next === 'function' ? next(reqBody) : next;
  }
  return { content: [{ type: 'text', text: 'OK (mock)' }], stop_reason: 'end_turn' };
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const raw = await body(req);
  const p = url.pathname;
  log.push({ method: req.method, path: p, auth: req.headers.authorization || null, body: raw.slice(0, 500000) });
  try {
    // ---------- test controls
    if (p === '/__log') return send(res, 200, log);
    if (p === '/__reset') { log.length = 0; aiScript = []; gEvents.clear(); exportPolls = 0; return send(res, 200, { ok: true }); }
    if (p === '/__ai/script') { aiScript.push(...JSON.parse(raw)); return send(res, 200, { queued: aiScript.length }); }
    if (p === '/__google/events') return send(res, 200, [...gEvents.values()]);

    // ---------- Anthropic
    if (p === '/v1/messages' && req.method === 'POST') {
      if (req.headers['x-api-key'] !== 'test-anthropic-key') return send(res, 401, { type: 'error', error: { type: 'authentication_error', message: 'bad key' } });
      const reqBody = JSON.parse(raw);
      const r = aiReply(reqBody);
      return send(res, 200, {
        id: `msg_${Date.now()}`, type: 'message', role: 'assistant', model: reqBody.model,
        content: r.content, stop_reason: r.stop_reason || 'end_turn', stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 10 },
      });
    }

    // ---------- Google
    if (p === '/google/token') {
      const f = new URLSearchParams(raw);
      if (f.get('client_secret') !== 'gsecret') return send(res, 401, { error: 'invalid_client' });
      if (f.get('grant_type') === 'authorization_code') {
        if (f.get('code') !== 'good-code') return send(res, 400, { error: 'invalid_grant' });
        return send(res, 200, { access_token: 'g-access-1', refresh_token: 'g-refresh', expires_in: 3600, id_token: `x.${b64url({ email: 'agencja@example.com' })}.y` });
      }
      if (f.get('grant_type') === 'refresh_token' && f.get('refresh_token') === 'g-refresh') return send(res, 200, { access_token: `g-access-${Date.now()}`, expires_in: 3600 });
      return send(res, 400, { error: 'invalid_grant' });
    }
    if (p === '/google/revoke') return send(res, 200, {});
    const ev = p.match(/^\/calendar\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/);
    if (ev) {
      if (!String(req.headers.authorization || '').startsWith('Bearer g-access')) return send(res, 401, { error: { message: 'auth' } });
      const [, cal, id] = ev;
      if (req.method === 'POST') { const e = { ...JSON.parse(raw), id: `ev${++gSeq}`, calendar: decodeURIComponent(cal) }; gEvents.set(e.id, e); return send(res, 200, e); }
      if (!gEvents.has(id)) return send(res, 404, { error: { message: 'Not Found' } });
      if (req.method === 'PATCH') { const e = { ...gEvents.get(id), ...JSON.parse(raw) }; gEvents.set(id, e); return send(res, 200, e); }
      if (req.method === 'DELETE') { gEvents.delete(id); res.writeHead(204); return res.end(); }
    }

    // ---------- Canva
    if (p === '/canva/api/v1/connect/keys') return send(res, 200, { keys: [JWK] });
    if (p === '/__canva/return-jwt') {
      const now = Math.floor(Date.now() / 1000);
      const payload = { aud: url.searchParams.get('aud') || 'cid', design_id: url.searchParams.get('design'), correlation_state: url.searchParams.get('state'), iat: now, exp: now + 300 };
      const forged = url.searchParams.get('forged') ? crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey : privateKey;
      return send(res, 200, { token: signJwt(payload, forged) });
    }
    if (p === '/canva/api/v1/designs/DAF1' && req.method === 'GET') {
      if (req.headers.authorization !== 'Bearer c-access') return send(res, 401, { code: 'invalid_access_token' });
      return send(res, 200, { design: { ...canvaDesigns[0], urls: { edit_url: 'https://www.canva.com/api/design/fresh/edit', view_url: canvaDesigns[0].urls.view_url } } });
    }
    if (p === '/canva/api/v1/oauth/token') {
      const expected = `Basic ${Buffer.from('cid:csecret').toString('base64')}`;
      if (req.headers.authorization !== expected) return send(res, 401, { error: 'invalid_client' });
      const f = new URLSearchParams(raw);
      if (f.get('grant_type') === 'authorization_code' && f.get('code') === 'canva-code' && f.get('code_verifier')) {
        return send(res, 200, { access_token: 'c-access', refresh_token: 'c-refresh-1', expires_in: 14400, token_type: 'Bearer' });
      }
      if (f.get('grant_type') === 'refresh_token') return send(res, 200, { access_token: 'c-access', refresh_token: 'c-refresh-2', expires_in: 14400 });
      return send(res, 400, { error: 'invalid_grant' });
    }
    if (p.startsWith('/canva/api/v1/') && req.headers.authorization !== 'Bearer c-access') return send(res, 401, { code: 'invalid_access_token' });
    if (p === '/canva/api/v1/users/me/profile') return send(res, 200, { profile: { display_name: 'Momenty Canva' } });
    if (p === '/canva/api/v1/designs' && req.method === 'GET') {
      const q = url.searchParams.get('query');
      return send(res, 200, { items: q ? canvaDesigns.filter((d) => d.title.toLowerCase().includes(q.toLowerCase())) : canvaDesigns });
    }
    if (p === '/canva/api/v1/designs' && req.method === 'POST') {
      const b = JSON.parse(raw);
      return send(res, 200, { design: { id: 'DNEW', title: b.title, urls: { edit_url: 'https://www.canva.com/api/design/new/edit', view_url: 'https://www.canva.com/api/design/new/view' }, thumbnail: null } });
    }
    if (p === '/canva/api/v1/exports' && req.method === 'POST') { exportPolls = 0; return send(res, 200, { job: { id: 'job1', status: 'in_progress' } }); }
    if (p === '/canva/api/v1/exports/job1') {
      exportPolls++;
      return send(res, 200, { job: exportPolls < 2 ? { id: 'job1', status: 'in_progress' } : { id: 'job1', status: 'success', urls: [`http://127.0.0.1:${PORT}/canva/file.png`] } });
    }
    if (p === '/canva/api/v1/oauth/revoke') return send(res, 200, {});
    if (p === '/canva/file.png') { res.writeHead(200, { 'Content-Type': 'image/png', 'Access-Control-Allow-Origin': '*' }); return res.end(PNG); }

    send(res, 404, { error: `mock: ${req.method} ${p}` });
  } catch (e) {
    send(res, 500, { error: String(e) });
  }
}).listen(PORT, '127.0.0.1', () => console.log(`mocks on ${PORT}`));
