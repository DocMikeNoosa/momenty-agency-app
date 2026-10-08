// Local stand-in for the Supabase API gateway used by the automated tests.
// Routes exactly like a Supabase project URL:
//   /auth/v1/*      -> Supabase Auth (GoTrue) server
//   /rest/v1/*      -> PostgREST
//   /storage/v1/*   -> file storage, emulated through SQL functions that run with the caller's JWT
//                      so the real storage RLS policies from supabase/schema.sql are enforced
//   /functions/v1/* -> Deno server running the real Edge Function handlers
import http from 'node:http';

const PORT = Number(process.env.GATEWAY_PORT || 54321);
const AUTH = 'http://127.0.0.1:9999';
const REST = 'http://127.0.0.1:3000';
const FUNCS = `http://127.0.0.1:${process.env.FUNCTIONS_PORT || 54330}`;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-upsert, prefer, range',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Expose-Headers': 'content-range',
};

function readBody(req) {
  return new Promise((resolve) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => resolve(Buffer.concat(c))); });
}

async function forward(req, res, target, body) {
  const headers = { ...req.headers };
  delete headers.host;
  delete headers['content-length'];
  if (!headers.authorization && headers.apikey) headers.authorization = `Bearer ${headers.apikey}`;
  const r = await fetch(target, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body, redirect: 'manual' });
  const out = { ...CORS };
  r.headers.forEach((v, k) => { if (!['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'access-control-allow-origin'].includes(k)) out[k] = v; });
  res.writeHead(r.status, out);
  res.end(Buffer.from(await r.arrayBuffer()));
}

async function rpc(name, args, req) {
  const auth = req.headers.authorization || (req.headers.apikey ? `Bearer ${req.headers.apikey}` : '');
  const r = await fetch(`${REST}/rpc/${name}`, { method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
  const text = await r.text();
  return { status: r.status, data: text ? JSON.parse(text) : null };
}

async function storage(req, res, path, body) {
  const send = (status, obj) => { res.writeHead(status, { ...CORS, 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  const m = path.match(/^\/object\/(?:authenticated\/)?([^/]+)\/(.+)$/);
  if (req.method === 'DELETE') {
    const bm = path.match(/^\/object\/([^/]+)$/);
    const { prefixes = [] } = JSON.parse(body.toString() || '{}');
    for (const p of prefixes) await rpc('test_storage_delete', { p_bucket: bm[1], p_name: p }, req);
    return send(200, prefixes.map((name) => ({ name })));
  }
  if (!m) return send(404, { error: 'not found' });
  const [, bucket, name] = m;
  if (req.method === 'POST' || req.method === 'PUT') {
    const r = await rpc('test_storage_put', { p_bucket: bucket, p_name: decodeURIComponent(name), p_ctype: req.headers['content-type'] || 'application/octet-stream', p_b64: body.toString('base64') }, req);
    if (r.status >= 300) return send(403, { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' });
    return send(200, { Key: `${bucket}/${name}` });
  }
  if (req.method === 'GET') {
    const r = await rpc('test_storage_get', { p_bucket: bucket, p_name: decodeURIComponent(name) }, req);
    const row = Array.isArray(r.data) ? r.data[0] : null;
    if (!row) return send(400, { statusCode: '404', error: 'not_found', message: 'Object not found' });
    res.writeHead(200, { ...CORS, 'Content-Type': row.content_type });
    return res.end(Buffer.from(row.b64, 'base64'));
  }
  return send(405, { error: 'method' });
}

http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
    const url = new URL(req.url, 'http://x');
    const body = await readBody(req);
    if (url.pathname.startsWith('/auth/v1/')) return await forward(req, res, AUTH + url.pathname.slice(8) + url.search, body);
    if (url.pathname.startsWith('/rest/v1/')) return await forward(req, res, REST + url.pathname.slice(8) + url.search, body);
    if (url.pathname.startsWith('/storage/v1/')) return await storage(req, res, url.pathname.slice(11), body);
    if (url.pathname.startsWith('/functions/v1/')) return await forward(req, res, FUNCS + url.pathname + url.search, body);
    res.writeHead(404, CORS); res.end();
  } catch (e) {
    console.error('gateway', e);
    res.writeHead(502, CORS); res.end(String(e));
  }
}).listen(PORT, '127.0.0.1', () => console.log(`gateway on ${PORT}`));
