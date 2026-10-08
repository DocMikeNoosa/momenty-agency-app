// Local data store (IndexedDB) with an in-memory cache.
// Every record carries id / createdAt / updatedAt / updatedBy and is soft-deleted
// (deleted: true) so a cloud sync can be added later without changing the data model.

const DB_NAME = 'momenty-agency';
const DB_VERSION = 1;
export const COLLECTIONS = ['contacts', 'projects', 'tasks', 'files', 'docs', 'activity', 'meta'];

let db = null;
const cache = Object.fromEntries(COLLECTIONS.map((c) => [c, new Map()]));
const kvCache = new Map();
const listeners = new Set();
const writeListeners = new Set(); // local edits (used by cloud sync to know what to send)
let actor = null; // id of the partner using this device

export function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function req(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transakcja przerwana'));
  });
}

export async function open() {
  if (db) return db;
  db = await new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('records')) {
        const s = d.createObjectStore('records', { keyPath: 'id' });
        s.createIndex('col', 'col');
      }
      if (!d.objectStoreNames.contains('blobs')) d.createObjectStore('blobs', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv', { keyPath: 'k' });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error('Baza danych jest zablokowana przez inną kartę.'));
  });
  const kvs = await req(db.transaction('kv').objectStore('kv').getAll());
  kvs.forEach((e) => kvCache.set(e.k, e.v));
  return db;
}

// Records are loaded only after unlocking.
export async function loadRecords() {
  await open();
  const all = await req(db.transaction('records').objectStore('records').getAll());
  COLLECTIONS.forEach((c) => cache[c].clear());
  for (const r of all) if (cache[r.col]) cache[r.col].set(r.id, r);
}

export function setActor(id) { actor = id; }

export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function onLocalWrite(fn) { writeListeners.add(fn); return () => writeListeners.delete(fn); }
export function getRaw(col, id) { return cache[col]?.get(id) || null; }
function emit(col) { listeners.forEach((fn) => { try { fn(col); } catch (e) { console.error(e); } }); }

export function all(col, { includeDeleted = false } = {}) {
  const out = [];
  for (const r of cache[col].values()) if (includeDeleted || !r.deleted) out.push(r);
  return out;
}

export function get(col, id) {
  const r = id ? cache[col].get(id) : null;
  return r && !r.deleted ? r : null;
}

export async function put(col, data, { silent = false } = {}) {
  await open();
  const now = new Date().toISOString();
  const prev = data.id ? cache[col].get(data.id) : null;
  const rec = {
    ...(prev || {}),
    ...data,
    id: data.id || uid(),
    col,
    createdAt: prev?.createdAt || data.createdAt || now,
    createdBy: prev?.createdBy || data.createdBy || actor,
    updatedAt: now,
    updatedBy: actor,
  };
  const tx = db.transaction('records', 'readwrite');
  tx.objectStore('records').put(rec);
  await txDone(tx);
  cache[col].set(rec.id, rec);
  writeListeners.forEach((fn) => { try { fn(col, rec); } catch (e) { console.error(e); } });
  if (!silent) emit(col);
  return rec;
}

export async function remove(col, id) {
  const r = cache[col].get(id);
  if (!r) return;
  if (col === 'files') await deleteBlobs(r);
  await put(col, { id, deleted: true });
}

// Applies records from a backup or from the cloud; the newer updatedAt wins.
// markLocal: treat them as local edits (so they are uploaded too), e.g. after restoring a backup.
export async function importRecords(records, { markLocal = false } = {}) {
  await open();
  let n = 0;
  const tx = db.transaction('records', 'readwrite');
  const store = tx.objectStore('records');
  for (const r of records) {
    if (!r || !r.id || !COLLECTIONS.includes(r.col)) continue;
    const cur = cache[r.col].get(r.id);
    if (cur && cur.updatedAt >= r.updatedAt) continue;
    store.put(r);
    cache[r.col].set(r.id, r);
    n++;
  }
  await txDone(tx);
  if (markLocal) for (const r of records) if (r && cache[r.col]?.get(r.id) === r) writeListeners.forEach((fn) => fn(r.col, r));
  if (n) emit('*');
  return n;
}

export async function putBlob(id, blob) {
  await open();
  const tx = db.transaction('blobs', 'readwrite');
  tx.objectStore('blobs').put({ id, blob });
  await txDone(tx);
}

export async function getBlob(id) {
  await open();
  const r = await req(db.transaction('blobs').objectStore('blobs').get(id));
  return r ? r.blob : null;
}

async function deleteBlobs(file) {
  const tx = db.transaction('blobs', 'readwrite');
  const s = tx.objectStore('blobs');
  if (file.blobId) s.delete(file.blobId);
  if (file.thumbId) s.delete(file.thumbId);
  await txDone(tx);
}

export function kvGet(k, fallback = null) {
  return kvCache.has(k) ? kvCache.get(k) : fallback;
}

export async function kvSet(k, v) {
  await open();
  const tx = db.transaction('kv', 'readwrite');
  tx.objectStore('kv').put({ k, v });
  await txDone(tx);
  kvCache.set(k, v);
}

export async function wipeAll() {
  await open();
  const tx = db.transaction(['records', 'blobs', 'kv'], 'readwrite');
  ['records', 'blobs', 'kv'].forEach((s) => tx.objectStore(s).clear());
  await txDone(tx);
  COLLECTIONS.forEach((c) => cache[c].clear());
  kvCache.clear();
}

export async function allRecordsRaw() {
  await open();
  return req(db.transaction('records').objectStore('records').getAll());
}

export async function logActivity(text, ref = null) {
  await put('activity', { text, ref, at: new Date().toISOString(), by: actor }, { silent: true });
  // keep the activity log compact
  const items = all('activity').sort((a, b) => b.at.localeCompare(a.at));
  if (items.length > 300) {
    const tx = db.transaction('records', 'readwrite');
    for (const old of items.slice(300)) { tx.objectStore('records').delete(old.id); cache.activity.delete(old.id); }
    await txDone(tx);
  }
}
