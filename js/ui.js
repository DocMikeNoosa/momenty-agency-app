// DOM helpers, icons, Polish date formatting, sheets, dialogs and toasts.

export function h(tag, props, ...children) {
  const el = tag === 'svg' || props?.svg ? document.createElementNS('http://www.w3.org/2000/svg', tag) : document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false || k === 'svg') continue;
      if (k === 'class') el.setAttribute('class', v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'value' && 'value' in el) el.value = v;
      else if (k === 'checked' || k === 'selected' || k === 'disabled') el[k] = !!v;
      else if (k === 'html') el.innerHTML = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

// ---------- Icons (24px stroke icons) ----------
const P = {
  today: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  projects: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M15 4v16"/>',
  contacts: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18.5 14.8c1.6.8 2.6 2.5 3 5.2"/>',
  files: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-4.5-4.5L5 21"/>',
  ai: '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  calendar: '<rect x="3" y="4.5" width="18" height="17" rx="2"/><path d="M16 2.5v4M8 2.5v4M3 10h18"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>',
  mail: '<rect x="2.5" y="4.5" width="19" height="15" rx="2"/><path d="m3 6 9 7 9-7"/>',
  instagram: '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r=".6" fill="currentColor"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4z"/>',
  share: '<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  key: '<path d="M7 15a4 4 0 1 1 3.9-5H22v3h-2v3h-3v-3h-6.1A4 4 0 0 1 7 15z"/><circle cx="7" cy="11" r="1" fill="currentColor"/>',
  faceid: '<path d="M7 3H5a2 2 0 0 0-2 2v2M17 3h2a2 2 0 0 1 2 2v2M7 21H5a2 2 0 0 1-2-2v-2M17 21h2a2 2 0 0 0 2-2v-2"/><path d="M8.5 9v1.5M15.5 9v1.5M12 9v4.5h-1M9 16.5c1.8 1.3 4.2 1.3 6 0"/>',
  doc: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h6"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  print: '<path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  star: '<path d="m12 2.5 2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  flag: '<path d="M4 22V4M4 4h13l-2 4 2 4H4"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-4.5-4.5L5 21"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/>',
  megaphone: '<path d="M3 11v3a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>',
  building: '<rect x="4" y="2" width="16" height="20" rx="1"/><path d="M9 22v-4h6v4M8 6h.01M12 6h.01M16 6h.01M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01"/>',
  sync: '<path d="M21 12a9 9 0 0 1-15.5 6.2L3 16M3 12a9 9 0 0 1 15.5-6.2L21 8M21 3v5h-5M3 21v-5h5"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  more: '<circle cx="12" cy="5" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="19" r="1.2" fill="currentColor"/>',
};

export function icon(name, size = 22, cls = '') {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', size);
  s.setAttribute('height', size);
  s.setAttribute('fill', 'none');
  s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '1.7');
  s.setAttribute('stroke-linecap', 'round');
  s.setAttribute('stroke-linejoin', 'round');
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('class', `ic ${cls}`);
  s.innerHTML = P[name] || P.more;
  return s;
}

// ---------- Dates (stored as YYYY-MM-DD, times as HH:MM) ----------
const pad = (n) => String(n).padStart(2, '0');
export function dateStr(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
export function todayStr() { return dateStr(new Date()); }
export function parseDate(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
export function addDays(s, n) { const d = parseDate(s); d.setDate(d.getDate() + n); return dateStr(d); }
export function daysBetween(a, b) { return Math.round((parseDate(b) - parseDate(a)) / 86400000); }

const fmtDay = new Intl.DateTimeFormat('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' });
const fmtShort = new Intl.DateTimeFormat('pl-PL', { weekday: 'short', day: 'numeric', month: 'short' });
const fmtFull = new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' });
const fmtDT = new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export function longDay(s) { return fmtDay.format(parseDate(s)); }
export function fullDate(s) { return s ? fmtFull.format(parseDate(s)) : ''; }
export function dateTime(iso) { return fmtDT.format(new Date(iso)); }

export function relDay(s) {
  if (!s) return '';
  const diff = daysBetween(todayStr(), s);
  if (diff === 0) return 'Dziś';
  if (diff === 1) return 'Jutro';
  if (diff === 2) return 'Pojutrze';
  if (diff === -1) return 'Wczoraj';
  if (diff < -1 && diff > -7) return `${-diff} dni temu`;
  const d = parseDate(s);
  const txt = fmtShort.format(d);
  return d.getFullYear() !== new Date().getFullYear() ? `${txt} ${d.getFullYear()}` : txt;
}

export function timeAgo(iso) {
  const s = Math.round((Date.now() - new Date(iso)) / 1000);
  if (s < 60) return 'przed chwilą';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min temu`;
  const hrs = Math.round(m / 60);
  if (hrs < 24) return `${hrs} godz. temu`;
  return dateTime(iso);
}

export function plural(n, one, few, many) {
  if (n === 1) return `${n} ${one}`;
  const m10 = n % 10, m100 = n % 100;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return `${n} ${few}`;
  return `${n} ${many}`;
}

export function initials(name = '') {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase() || '?';
}

export function fmtNumber(n) {
  if (n == null || n === '') return '';
  const v = Number(n);
  if (!isFinite(v)) return String(n);
  if (v >= 1e6) return `${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1).replace('.', ',')} mln`;
  if (v >= 1e4) return `${Math.round(v / 1e3)} tys.`;
  return v.toLocaleString('pl-PL');
}

export function fmtBytes(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1048576).toFixed(1).replace('.', ',')} MB`;
}

// ---------- Toasts ----------
export function toast(msg, { action, onAction, timeout = 3200 } = {}) {
  const root = document.getElementById('toast-root');
  const el = h('div', { class: 'toast' }, h('span', null, msg),
    action ? h('button', { class: 'toast-btn', onclick: () => { onAction?.(); el.remove(); } }, action) : null);
  root.append(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, timeout);
}

// ---------- Sheets (bottom sheet on phones, dialog on computers) ----------
const openSheets = [];

export function openSheet({ title, body, footer, onClose, wide = false, className = '' }) {
  const root = document.getElementById('sheet-root');
  const prevFocus = document.activeElement;
  const closeBtn = h('button', { class: 'icon-btn', 'aria-label': 'Zamknij', onclick: () => close() }, icon('close'));
  const panel = h('div', { class: `sheet ${wide ? 'sheet-wide' : ''} ${className}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title || 'Okno' },
    h('div', { class: 'sheet-grip' }),
    title != null ? h('div', { class: 'sheet-head' }, h('h2', { class: 'sheet-title' }, title), closeBtn) : null,
    h('div', { class: 'sheet-body' }, body),
    footer ? h('div', { class: 'sheet-foot' }, footer) : null);
  const backdrop = h('div', { class: 'sheet-backdrop', onclick: (e) => { if (e.target === backdrop) close(); } }, panel);
  root.append(backdrop);
  document.body.classList.add('no-scroll');
  requestAnimationFrame(() => backdrop.classList.add('show'));
  const onKey = (e) => { if (e.key === 'Escape' && openSheets[openSheets.length - 1] === api) close(); };
  document.addEventListener('keydown', onKey);
  let closed = false;
  function close(result) {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    backdrop.classList.remove('show');
    openSheets.splice(openSheets.indexOf(api), 1);
    if (!openSheets.length) document.body.classList.remove('no-scroll');
    setTimeout(() => backdrop.remove(), 260);
    onClose?.(result);
    if (prevFocus && prevFocus.focus) prevFocus.focus({ preventScroll: true });
  }
  const api = { close, panel };
  openSheets.push(api);
  // focus first field on computers only (avoid popping the keyboard on phones)
  if (matchMedia('(pointer: fine)').matches) {
    setTimeout(() => panel.querySelector('input:not([type=hidden]),textarea,select')?.focus(), 60);
  }
  return api;
}

export function closeAllSheets() { [...openSheets].reverse().forEach((s) => s.close()); }

export function confirmDialog(message, { title = 'Potwierdź', ok = 'OK', danger = false } = {}) {
  return new Promise((resolve) => {
    let result = false;
    const s = openSheet({
      title,
      body: h('p', { class: 'confirm-text' }, message),
      footer: [
        h('button', { class: 'btn btn-ghost', onclick: () => s.close() }, 'Anuluj'),
        h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, onclick: () => { result = true; s.close(); } }, ok),
      ],
      onClose: () => resolve(result),
      className: 'sheet-small',
    });
  });
}

// ---------- Forms ----------
// fields: [{ key, label, type, options:[[value,label]], placeholder, required, full, hint }]
export function buildForm(fields, values = {}) {
  const inputs = {};
  const grid = h('div', { class: 'form-grid' });
  for (const f of fields) {
    const id = `f-${f.key}-${Math.random().toString(36).slice(2, 7)}`;
    let input;
    const v = values[f.key] ?? f.default ?? '';
    if (f.type === 'textarea') {
      input = h('textarea', { id, rows: f.rows || 4, placeholder: f.placeholder || '' });
      input.value = v;
    } else if (f.type === 'select') {
      input = h('select', { id }, (typeof f.options === 'function' ? f.options() : f.options).map(([val, lab]) =>
        h('option', { value: val, selected: String(val) === String(v) }, lab)));
    } else if (f.type === 'rating') {
      input = ratingInput(Number(v) || 0);
      input.id = id;
    } else {
      const t = f.type || 'text';
      input = h('input', {
        id, type: t, placeholder: f.placeholder || '',
        inputmode: f.inputmode, autocomplete: f.autocomplete || 'off', autocapitalize: t === 'email' || t === 'url' ? 'off' : f.autocapitalize,
        step: f.step, min: f.min, max: f.max,
      });
      input.value = v;
    }
    if (f.required) input.required = true;
    inputs[f.key] = input;
    grid.append(h('label', { class: `field ${f.full || f.type === 'textarea' ? 'field-full' : ''}`, for: id },
      h('span', { class: 'field-label' }, f.label, f.required ? h('span', { class: 'req' }, ' *') : null),
      input,
      f.hint ? h('span', { class: 'field-hint' }, f.hint) : null));
  }
  function read() {
    const out = {};
    for (const f of fields) {
      const el = inputs[f.key];
      let v = f.type === 'rating' ? el.value : el.value;
      if (typeof v === 'string') v = v.trim();
      if (f.type === 'number') v = v === '' ? null : Number(String(v).replace(',', '.'));
      out[f.key] = v;
    }
    return out;
  }
  function validate() {
    for (const f of fields) {
      if (f.required && !String(inputs[f.key].value || '').trim()) {
        inputs[f.key].focus();
        toast(`Uzupełnij pole „${f.label}”.`);
        return false;
      }
    }
    return true;
  }
  return { el: grid, inputs, read, validate };
}

function ratingInput(value) {
  const wrap = h('div', { class: 'rating', role: 'radiogroup', 'aria-label': 'Ocena' });
  wrap.value = value;
  const draw = () => {
    clear(wrap);
    for (let i = 1; i <= 5; i++) {
      wrap.append(h('button', {
        type: 'button', class: `star ${i <= wrap.value ? 'on' : ''}`, 'aria-label': `${i} na 5`,
        onclick: () => { wrap.value = wrap.value === i ? 0 : i; draw(); },
      }, icon('star', 24)));
    }
  };
  draw();
  return wrap;
}

export function stars(n) {
  if (!n) return null;
  return h('span', { class: 'stars', 'aria-label': `Ocena ${n} na 5` }, Array.from({ length: 5 }, (_, i) => icon('star', 14, i < n ? 'on' : '')));
}

export function emptyState(text, actionLabel, onAction, ic = 'today') {
  return h('div', { class: 'empty' },
    h('div', { class: 'empty-ic' }, icon(ic, 28)),
    h('p', null, text),
    actionLabel ? h('button', { class: 'btn btn-soft', onclick: onAction }, actionLabel) : null);
}

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// Shares a file on phones (share sheet) or downloads it on computers.
export async function shareOrDownload(blob, filename, title) {
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] }) && matchMedia('(pointer: coarse)').matches) {
    try { await navigator.share({ files: [file], title }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  download(blob, filename);
}
