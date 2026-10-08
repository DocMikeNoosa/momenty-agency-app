// Shared UI pieces: task rows (with swipe), editors for tasks / projects / contacts, file upload, pickers.

import * as db from './db.js';
import * as M from './model.js';
import {
  h, icon, openSheet, buildForm, toast, confirmDialog, relDay, todayStr, addDays, initials, stars, clear, fmtBytes,
} from './ui.js';
import { navigate } from './router.js';
import * as cloud from './cloud.js';

// ---------- Avatars / badges ----------
export function avatar(name, { kind, size = 40, photoUrl } = {}) {
  const el = h('span', { class: `avatar avatar-${kind || 'x'}`, style: { width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.36)}px` } }, initials(name));
  if (photoUrl) { clear(el); el.append(h('img', { src: photoUrl, alt: '' })); }
  return el;
}

export function ownerBadge(owner) {
  if (!owner) return null;
  const label = owner === 'oba' ? 'Obie' : initials(M.partnerName(owner));
  const mine = owner === M.me();
  return h('span', { class: `owner ${mine ? 'owner-me' : ''} ${owner === 'oba' ? 'owner-both' : ''}`, title: M.ownerLabel(owner) }, label);
}

export function progressBar(pct) {
  return h('div', { class: 'progress', role: 'progressbar', 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100 },
    h('div', { class: 'progress-fill', style: { width: `${pct}%` } }));
}

// ---------- Tasks ----------
export async function toggleTask(t) {
  const done = !t.done;
  await db.put('tasks', { id: t.id, done, doneAt: done ? new Date().toISOString() : null });
  if (done) {
    db.logActivity(`ukończył(a): ${t.title}`, { col: 'tasks', id: t.id });
    toast('Zadanie ukończone', { action: 'Cofnij', onAction: () => db.put('tasks', { id: t.id, done: false, doneAt: null }) });
  }
}

export async function postpone(t, days = 1) {
  const base = t.due && t.due > todayStr() ? t.due : todayStr();
  const due = addDays(base, days);
  await db.put('tasks', { id: t.id, due });
  toast(`Przeniesiono na: ${relDay(due).toLowerCase()}`, { action: 'Cofnij', onAction: () => db.put('tasks', { id: t.id, due: t.due }) });
}

export function taskRow(t, { showDate = false, showProject = true } = {}) {
  const today = todayStr();
  const overdue = !t.done && t.due && t.due < today;
  const p = showProject ? db.get('projects', t.projectId) : null;
  const c = db.get('contacts', t.contactId);
  const meta = [];
  if (showDate && t.due) meta.push(h('span', { class: overdue ? 'overdue' : '' }, relDay(t.due)));
  if (t.time) meta.push(h('span', { class: 'meta-time' }, icon('clock', 13), t.time));
  if (t.kind && t.kind !== 'zadanie') meta.push(h('span', { class: 'meta-kind' }, icon(M.taskKindIcon(t.kind), 13), M.taskKindLabel(t.kind)));
  if (p) meta.push(h('span', { class: 'meta-proj' }, p.title));
  else if (c) meta.push(h('span', null, c.name));

  const check = h('button', {
    class: `check ${t.done ? 'on' : ''} ${t.priority === 'wysoki' ? 'hi' : ''}`,
    'aria-label': t.done ? 'Oznacz jako nieukończone' : 'Oznacz jako ukończone',
    onclick: (e) => { e.stopPropagation(); toggleTask(t); },
  }, icon('check', 16));

  const content = h('div', { class: 'row-main', onclick: () => editTask(t) },
    h('div', { class: 'row-title' }, t.priority === 'wysoki' && !t.done ? h('span', { class: 'prio', title: 'Wysoki priorytet' }, '!') : null, t.title),
    meta.length ? h('div', { class: 'row-meta' }, meta) : null);

  const front = h('div', { class: 'swipe-front' }, check, content, ownerBadge(t.owner));
  const row = h('div', { class: `task ${t.done ? 'done' : ''} ${overdue ? 'is-overdue' : ''}`, dataset: { id: t.id } },
    h('div', { class: 'swipe-bg swipe-done' }, icon('check', 20), h('span', null, t.done ? 'Przywróć' : 'Gotowe')),
    h('div', { class: 'swipe-bg swipe-later' }, h('span', null, 'Jutro'), icon('calendar', 20)),
    front);
  enableSwipe(row, front, { right: () => toggleTask(t), left: () => postpone(t, 1) });
  return row;
}

function enableSwipe(row, front, { left, right }) {
  let x0 = 0, y0 = 0, dx = 0, active = false, locked = null, pid = null;
  const TH = 90;
  front.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    x0 = e.clientX; y0 = e.clientY; dx = 0; active = true; locked = null; pid = e.pointerId;
  });
  front.addEventListener('pointermove', (e) => {
    if (!active || e.pointerId !== pid) return;
    const mx = e.clientX - x0, my = e.clientY - y0;
    if (locked == null && (Math.abs(mx) > 8 || Math.abs(my) > 8)) locked = Math.abs(mx) > Math.abs(my) ? 'x' : 'y';
    if (locked !== 'x') return;
    dx = Math.max(-140, Math.min(140, mx));
    front.style.transform = `translateX(${dx}px)`;
    row.classList.toggle('sw-right', dx > 0);
    row.classList.toggle('sw-left', dx < 0);
    row.classList.toggle('sw-armed', Math.abs(dx) > TH);
  });
  const end = () => {
    if (!active) return;
    active = false;
    front.style.transition = 'transform .2s ease';
    front.style.transform = '';
    setTimeout(() => { front.style.transition = ''; row.classList.remove('sw-right', 'sw-left', 'sw-armed'); }, 220);
    if (locked === 'x') {
      const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
      front.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => front.removeEventListener('click', swallow, { capture: true }), 300);
      if (dx > TH) right(); else if (dx < -TH) left();
    }
  };
  front.addEventListener('pointerup', end);
  front.addEventListener('pointercancel', end);
  front.style.touchAction = 'pan-y';
}

const projectOptions = (withEmpty = true) => [
  ...(withEmpty ? [['', '— bez projektu —']] : []),
  ...db.all('projects').filter((p) => p.stage !== 'zakonczony').sort((a, b) => a.title.localeCompare(b.title, 'pl')).map((p) => [p.id, p.title]),
];
const contactOptions = (kinds, emptyLabel = '— brak —') => [
  ['', emptyLabel],
  ...db.all('contacts').filter((c) => !kinds || kinds.includes(c.kind)).sort((a, b) => a.name.localeCompare(b.name, 'pl'))
    .map((c) => [c.id, `${c.name}${kinds && kinds.length === 1 ? '' : ` (${M.kindLabel(c.kind).toLowerCase()})`}`]),
];

export function taskFields() {
  return [
    { key: 'title', label: 'Zadanie', required: true, full: true, placeholder: 'Co trzeba zrobić?', autocapitalize: 'sentences' },
    { key: 'due', label: 'Data', type: 'date' },
    { key: 'time', label: 'Godzina', type: 'time' },
    { key: 'owner', label: 'Kto', type: 'select', options: () => M.partnerOptions(false), default: M.me() },
    { key: 'kind', label: 'Rodzaj', type: 'select', options: M.TASK_KINDS.map(([k, l]) => [k, l]) },
    { key: 'priority', label: 'Priorytet', type: 'select', options: M.PRIORITIES },
    { key: 'projectId', label: 'Projekt', type: 'select', options: () => projectOptions() },
    { key: 'contactId', label: 'Kontakt', type: 'select', options: () => contactOptions(null), full: true },
    { key: 'location', label: 'Miejsce', full: true, placeholder: 'Adres lub link do spotkania' },
    { key: 'notes', label: 'Notatki', type: 'textarea', rows: 3 },
  ];
}

export function editTask(t = null, defaults = {}) {
  const isNew = !t;
  const values = t || { due: todayStr(), owner: M.me(), kind: 'zadanie', priority: 'normalny', ...defaults };
  const form = buildForm(taskFields(), values);
  const calNote = h('p', { class: 'hint-line' });
  const updateNote = () => {
    const v = form.read();
    calNote.textContent = v.due ? `Przypomnienia w kalendarzu: ${M.reminderText(v)}` : 'Bez daty – zadanie nie trafi do kalendarza.';
  };
  ['due', 'time', 'kind'].forEach((k) => form.inputs[k].addEventListener('change', updateNote));
  updateNote();

  const extra = [];
  if (!isNew) {
    extra.push(h('div', { class: 'sheet-actions' },
      t.due ? h('a', { class: 'btn btn-soft', href: M.googleCalendarUrl(t), target: '_blank', rel: 'noopener' }, icon('calendar', 18), 'Dodaj do Kalendarza Google') : null,
      h('button', { class: 'btn btn-soft', onclick: () => { s.close(); toggleTask(t); } }, icon('check', 18), t.done ? 'Przywróć' : 'Oznacz jako gotowe'),
      h('button', { class: 'btn btn-ghost danger-text', onclick: async () => {
        if (await confirmDialog(`Usunąć zadanie „${t.title}”?`, { ok: 'Usuń', danger: true })) {
          await db.remove('tasks', t.id); s.close(); toast('Zadanie usunięte');
        }
      } }, icon('trash', 18), 'Usuń')));
    extra.push(h('p', { class: 'hint-line' }, `Dodane przez: ${M.partnerName(t.createdBy) || '—'} · Ostatnia zmiana: ${M.partnerName(t.updatedBy) || '—'}`));
  }

  const s = openSheet({
    title: isNew ? 'Nowe zadanie' : 'Zadanie',
    body: [form.el, calNote, ...extra],
    footer: [
      h('button', { class: 'btn btn-ghost', onclick: () => s.close() }, 'Anuluj'),
      h('button', { class: 'btn btn-primary', onclick: save }, 'Zapisz'),
    ],
  });
  async function save() {
    if (!form.validate()) return;
    const v = form.read();
    const rec = await db.put('tasks', { ...(t ? { id: t.id } : { done: false }), ...v });
    if (isNew) db.logActivity(`dodał(a) zadanie: ${rec.title}`, { col: 'tasks', id: rec.id });
    s.close();
    toast(isNew ? 'Zadanie dodane' : 'Zapisano');
  }
}

// ---------- Projects ----------
export function editProject(p = null, defaults = {}) {
  const isNew = !p;
  const fields = [
    { key: 'title', label: 'Nazwa projektu', required: true, full: true, autocapitalize: 'sentences' },
    { key: 'clientId', label: 'Klient', type: 'select', options: () => contactOptions(['klient'], '— wybierz klienta —') },
    { key: 'type', label: 'Rodzaj', type: 'select', options: M.PROJECT_TYPES },
    { key: 'stage', label: 'Etap', type: 'select', options: M.STAGES },
    { key: 'owner', label: 'Prowadzi', type: 'select', options: () => M.partnerOptions(false) },
    { key: 'start', label: 'Start', type: 'date' },
    { key: 'due', label: 'Termin', type: 'date' },
    { key: 'budget', label: 'Budżet', placeholder: 'np. 25 000 zł' },
    { key: 'goal', label: 'Cel / KPI', placeholder: 'np. 10 publikacji, 500 tys. zasięgu' },
    { key: 'description', label: 'Opis i brief', type: 'textarea', rows: 5 },
  ];
  const values = p || { stage: 'plan', owner: M.me(), type: 'pr', start: todayStr(), ...defaults };
  const form = buildForm(fields, values);
  const s = openSheet({
    title: isNew ? 'Nowy projekt' : 'Edytuj projekt',
    body: form.el,
    footer: [
      h('button', { class: 'btn btn-ghost', onclick: () => s.close() }, 'Anuluj'),
      h('button', { class: 'btn btn-primary', onclick: async () => {
        if (!form.validate()) return;
        const rec = await db.put('projects', { ...(p ? { id: p.id } : { influencerIds: [] }), ...form.read() });
        if (isNew) {
          db.logActivity(`utworzył(a) projekt: ${rec.title}`, { col: 'projects', id: rec.id });
          s.close();
          navigate(`projekt/${rec.id}`);
          toast('Projekt utworzony');
        } else { s.close(); toast('Zapisano'); }
      } }, 'Zapisz'),
    ],
  });
}

// ---------- Contacts ----------
export function editContact(c = null, kind = 'klient', defaults = {}) {
  const isNew = !c;
  kind = c?.kind || kind;
  const holder = h('div');
  let form;
  const kindPicker = isNew ? h('div', { class: 'seg seg-scroll', role: 'tablist' }, M.CONTACT_KINDS.map(([k, , label]) =>
    h('button', { class: `seg-btn ${k === kind ? 'on' : ''}`, onclick: (e) => {
      kind = k;
      e.currentTarget.parentElement.querySelectorAll('.seg-btn').forEach((b) => b.classList.remove('on'));
      e.currentTarget.classList.add('on');
      draw();
    } }, label))) : null;
  function draw() {
    const prev = form ? form.read() : null;
    const keep = prev ? { name: prev.name, email: prev.email, phone: prev.phone, instagram: prev.instagram, notes: prev.notes } : {};
    form = buildForm(M.contactFields(kind), c || { status: 'aktywny', health: 'dobra', lead: M.me(), ...defaults, ...keep });
    clear(holder).append(form.el);
  }
  draw();
  const s = openSheet({
    title: isNew ? 'Nowy kontakt' : `Edytuj: ${c.name}`,
    body: [kindPicker, holder],
    footer: [
      h('button', { class: 'btn btn-ghost', onclick: () => s.close() }, 'Anuluj'),
      h('button', { class: 'btn btn-primary', onclick: async () => {
        if (!form.validate()) return;
        const v = form.read();
        if (v.instagram) v.instagram = M.handle(v.instagram);
        if (v.tiktok) v.tiktok = M.handle(v.tiktok);
        const rec = await db.put('contacts', { ...(c ? { id: c.id } : {}), kind, ...v });
        if (isNew) {
          db.logActivity(`dodał(a) kontakt: ${rec.name}`, { col: 'contacts', id: rec.id });
          s.close();
          navigate(`kontakt/${rec.id}`);
          toast('Kontakt dodany');
        } else { s.close(); toast('Zapisano'); }
      } }, 'Zapisz'),
    ],
  });
}

// ---------- Files ----------
const MAX_IMAGE_SIDE = 2560;

async function loadImage(blob) {
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(blob, { imageOrientation: 'from-image' }); } catch { /* fall through */ }
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Nie można odczytać obrazu')); };
    img.src = url;
  });
}

function scaleTo(img, max, type = 'image/jpeg', q = 0.86) {
  const w = img.width, hgt = img.height;
  const k = Math.min(1, max / Math.max(w, hgt));
  const c = document.createElement('canvas');
  c.width = Math.round(w * k); c.height = Math.round(hgt * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return new Promise((r) => c.toBlob(r, type, q));
}

export async function saveFile(file, links = {}) {
  let blob = file;
  let thumb = null;
  let width, height;
  const isImg = /^image\/(jpeg|png|webp|gif|heic|heif)/i.test(file.type);
  if (isImg && !/gif/i.test(file.type)) {
    try {
      const img = await loadImage(file);
      width = img.width; height = img.height;
      if (Math.max(width, height) > MAX_IMAGE_SIDE || /heic|heif/i.test(file.type)) blob = await scaleTo(img, MAX_IMAGE_SIDE);
      thumb = await scaleTo(img, 480, 'image/jpeg', 0.78);
    } catch (e) { console.warn(e); }
  }
  const blobId = db.uid();
  await db.putBlob(blobId, blob);
  let thumbId = null;
  if (thumb) { thumbId = db.uid(); await db.putBlob(thumbId, thumb); }
  let name = file.name || `zdjecie-${new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-')}.jpg`;
  if (blob !== file && blob.type === 'image/jpeg') name = name.replace(/\.(heic|heif|png|webp)$/i, '.jpg');
  return db.put('files', {
    name, mime: blob.type || file.type || 'application/octet-stream', size: blob.size, blobId, thumbId,
    isImage: isImg, width, height, caption: '', ...links,
  });
}

export function pickFiles({ camera = false, accept, multiple = true } = {}) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept: accept || (camera ? 'image/*' : 'image/*,video/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip'), style: { display: 'none' } });
    if (camera) input.setAttribute('capture', 'environment');
    if (multiple && !camera) input.multiple = true;
    input.addEventListener('change', () => { resolve([...input.files]); input.remove(); });
    document.body.append(input);
    input.click();
  });
}

export async function uploadFlow({ camera = false, links = {} } = {}) {
  const files = await pickFiles({ camera });
  if (!files.length) return [];
  toast(files.length > 1 ? `Zapisywanie ${files.length} plików…` : 'Zapisywanie…', { timeout: 1500 });
  const out = [];
  for (const f of files) {
    try { out.push(await saveFile(f, links)); } catch (e) {
      console.error(e);
      toast(e.name === 'QuotaExceededError' ? 'Brak miejsca na urządzeniu.' : `Nie udało się zapisać: ${f.name}`);
    }
  }
  if (out.length) {
    db.logActivity(out.length > 1 ? `dodał(a) ${out.length} pliki` : `dodał(a) plik: ${out[0].name}`, { col: 'files', id: out[0].id });
    toast(out.length > 1 ? `Dodano ${out.length} plików` : 'Plik dodany');
  }
  return out;
}

const urlCache = new Map();
export async function blobUrl(id) {
  if (!id) return null;
  if (urlCache.has(id)) return urlCache.get(id);
  // photos added on the other partner's device are fetched from the agency's storage on first view
  const b = (await db.getBlob(id)) || (await cloud.downloadBlob(id));
  if (!b) return null;
  const u = URL.createObjectURL(b);
  urlCache.set(id, u);
  return u;
}

export function fileTile(f, onOpen) {
  const img = h('div', { class: 'tile-media' });
  if (f.thumbId) {
    blobUrl(f.thumbId).then((u) => { if (u) img.append(h('img', { src: u, alt: f.caption || f.name, loading: 'lazy' })); });
  } else {
    const ext = (f.name.split('.').pop() || '').slice(0, 4).toUpperCase();
    img.append(h('div', { class: 'tile-file' }, icon('file', 28), h('span', null, ext)));
  }
  return h('button', { class: 'tile', onclick: () => onOpen(f), 'aria-label': f.caption || f.name },
    img, h('span', { class: 'tile-cap' }, f.caption || f.name));
}

export function filesGrid(files) {
  return h('div', { class: 'tiles' }, files.map((f) => fileTile(f, openFile)));
}

export async function openFile(f) {
  const url = await blobUrl(f.blobId);
  const media = f.isImage && url ? h('img', { class: 'viewer-img', src: url, alt: f.caption || f.name })
    : /^video\//.test(f.mime) && url ? h('video', { class: 'viewer-img', src: url, controls: true, playsinline: true })
      : h('div', { class: 'viewer-file' }, icon('file', 48), h('div', null, f.name), h('div', { class: 'muted' }, fmtBytes(f.size)));
  const form = buildForm([
    { key: 'caption', label: 'Opis', full: true, placeholder: 'np. sesja produktowa, event 12.10' },
    { key: 'clientId', label: 'Klient / kontakt', type: 'select', options: () => contactOptions(null) },
    { key: 'projectId', label: 'Projekt', type: 'select', options: () => [['', '— bez projektu —'], ...db.all('projects').map((p) => [p.id, p.title])] },
  ], f);
  const s = openSheet({
    title: f.caption || f.name,
    wide: true,
    body: [
      h('div', { class: 'viewer' }, media),
      h('div', { class: 'sheet-actions' },
        h('button', { class: 'btn btn-soft', onclick: async () => {
          const b = (await db.getBlob(f.blobId)) || (await cloud.downloadBlob(f.blobId));
          const { shareOrDownload } = await import('./ui.js');
          if (b) shareOrDownload(b, f.name, f.caption || f.name);
        } }, icon('share', 18), 'Udostępnij / pobierz'),
        url && (f.mime === 'application/pdf') ? h('a', { class: 'btn btn-soft', href: url, target: '_blank', rel: 'noopener' }, icon('doc', 18), 'Otwórz') : null,
        h('button', { class: 'btn btn-ghost danger-text', onclick: async () => {
          if (await confirmDialog(`Usunąć plik „${f.name}”?`, { ok: 'Usuń', danger: true })) { await db.remove('files', f.id); s.close(); toast('Plik usunięty'); }
        } }, icon('trash', 18), 'Usuń')),
      form.el,
      h('p', { class: 'hint-line' }, `${fmtBytes(f.size)} · dodane ${new Date(f.createdAt).toLocaleDateString('pl-PL')} przez ${M.partnerName(f.createdBy) || '—'}`),
    ],
    footer: [
      h('button', { class: 'btn btn-ghost', onclick: () => s.close() }, 'Zamknij'),
      h('button', { class: 'btn btn-primary', onclick: async () => { await db.put('files', { id: f.id, ...form.read() }); s.close(); toast('Zapisano'); } }, 'Zapisz'),
    ],
  });
}

// ---------- Contact helpers ----------
export function contactActions(c) {
  const btn = (href, ic, label, ext) => h('a', { class: 'qa', href, target: ext ? '_blank' : null, rel: ext ? 'noopener' : null }, h('span', { class: 'qa-ic' }, icon(ic, 20)), h('span', null, label));
  return h('div', { class: 'quick-actions' },
    c.phone ? btn(`tel:${c.phone.replace(/[^\d+]/g, '')}`, 'phone', 'Zadzwoń') : null,
    c.phone ? btn(`sms:${c.phone.replace(/[^\d+]/g, '')}`, 'mail', 'SMS') : null,
    c.email ? btn(`mailto:${c.email}`, 'mail', 'E-mail') : null,
    c.instagram ? btn(M.instagramUrl(c.instagram), 'instagram', 'Instagram', true) : null,
    c.tiktok ? btn(M.tiktokUrl(c.tiktok), 'activity', 'TikTok', true) : null,
    c.website ? btn(M.webUrl(c.website), 'globe', 'WWW', true) : null);
}

export function contactRow(c) {
  return h('button', { class: 'list-row', onclick: () => navigate(`kontakt/${c.id}`) },
    avatar(c.name, { kind: c.kind }),
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title' }, c.name, c.kind === 'klient' && c.health && c.health !== 'dobra' ? h('span', { class: `dot dot-${c.health}`, title: c.health === 'uwaga' ? 'Wymaga uwagi' : 'Zagrożona' }) : null),
      h('div', { class: 'row-meta' }, M.contactSubtitle(c) || M.kindLabel(c.kind), c.rating ? stars(c.rating) : null)),
    icon('chevron', 18, 'muted'));
}

export function section(title, content, action) {
  return h('section', { class: 'section' },
    h('div', { class: 'section-head' }, h('h3', null, title), action || null),
    content);
}
