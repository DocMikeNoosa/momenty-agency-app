import * as db from './db.js';
import * as auth from './auth.js';
import * as M from './model.js';
import {
  h, icon, clear, toast, openSheet, closeAllSheets, relDay, todayStr, buildForm,
} from './ui.js';
import { navigate, current, onRoute, back } from './router.js';
import {
  editTask, editProject, editContact, uploadFlow, avatar,
} from './components.js';
import { renderToday } from './views/today.js';
import { renderProjects, renderProject } from './views/projects.js';
import { renderContacts, renderContact } from './views/contacts.js';
import { renderFiles } from './views/files.js';
import { renderAssistant, renderLetter, renderDoc, renderMockup, sendCommand } from './views/assistant.js';
import * as ai from './ai.js';
import { renderSettings, loadDemo, deviceLabel } from './views/settings.js';
import * as cloud from './cloud.js';
import { joinForm, joinSheet } from './views/team.js';

const app = document.getElementById('app');
let unlocked = false;

const TABS = [
  ['dzis', 'Dziś', 'today'],
  ['projekty', 'Projekty', 'projects'],
  ['kontakty', 'Kontakty', 'contacts'],
  ['pliki', 'Pliki', 'files'],
  ['asystent', 'Asystent', 'ai'],
];
const TAB_OF = { projekt: 'projekty', kontakt: 'kontakty', dokument: 'asystent', ustawienia: '' };

// ---------- Boot ----------
async function boot() {
  try {
    await db.open();
  } catch (e) {
    app.append(h('div', { class: 'fatal' }, h('h1', null, 'Nie można otworzyć danych'),
      h('p', null, 'Przeglądarka blokuje zapis danych (np. tryb prywatny). Otwórz aplikację w zwykłym oknie.'), h('pre', null, String(e.message || e))));
    return;
  }
  if (!window.isSecureContext || !crypto.subtle) {
    app.append(h('div', { class: 'fatal' }, h('h1', null, 'Wymagane bezpieczne połączenie'), h('p', null, 'Otwórz aplikację przez adres https://.')));
    return;
  }
  cloud.setCalendarMapper(M.calendarEvents);
  const r = current();
  if (!auth.isSetUp()) {
    if (r.name === 'dolacz') showJoin(location.hash.replace(/^#\/?/, '')); else showSetup();
  } else showLock();
  registerSW();
}

// ---------- First run ----------
function brandScreen(...children) {
  return h('div', { class: 'brand-screen' },
    h('div', { class: 'brand-inner' },
      h('img', { class: 'brand-logo', src: 'assets/icons/logo-white.png', alt: 'momenty agency' }),
      ...children));
}

function showSetup() {
  clear(app);
  const form = buildForm([
    { key: 'me', label: 'Twoje imię', required: true, full: true, autocomplete: 'given-name', autocapitalize: 'words' },
    { key: 'other', label: 'Imię drugiej osoby w agencji', required: true, full: true, autocapitalize: 'words' },
    { key: 'pw', label: 'Hasło do aplikacji', type: 'password', required: true, full: true, autocomplete: 'new-password', hint: 'Min. 8 znaków, litery i co najmniej jedna cyfra.' },
    { key: 'pw2', label: 'Powtórz hasło', type: 'password', required: true, full: true, autocomplete: 'new-password' },
  ]);
  const err = h('p', { class: 'form-error', role: 'alert' });
  const btn = h('button', { class: 'btn btn-cream btn-block', type: 'submit' }, 'Dalej');
  const f = h('form', { class: 'brand-form', onsubmit: async (e) => {
    e.preventDefault();
    err.textContent = '';
    const v = form.read();
    if (!v.me || !v.other) { err.textContent = 'Podaj oba imiona.'; return; }
    const prob = auth.passwordProblem(v.pw);
    if (prob) { err.textContent = prob; return; }
    if (v.pw !== v.pw2) { err.textContent = 'Hasła nie są takie same.'; return; }
    btn.disabled = true; btn.textContent = 'Zapisywanie…';
    await db.kvSet('partners', [{ id: 'p1', name: v.me }, { id: 'p2', name: v.other }]);
    await db.kvSet('me', 'p1');
    await auth.setPassword(v.pw);
    db.setActor('p1');
    navigator.storage?.persist?.().catch(() => {});
    setupPasskeyStep();
  } }, form.el, err, btn);
  app.append(brandScreen(
    h('h1', { class: 'brand-title' }, 'Witamy'),
    h('p', { class: 'brand-sub' }, 'Skonfiguruj aplikację na tym urządzeniu. Hasło chroni dostęp do danych agencji.'),
    f,
    h('div', { class: 'or' }, 'lub'),
    h('button', { class: 'btn btn-outline-cream btn-block', onclick: () => showJoin('') }, icon('link', 18), 'Mam zaproszenie do agencji')));
}

// Second partner (or a new device): join the agency with an invite link.
function showJoin(prefill) {
  clear(app);
  app.append(brandScreen(
    h('h1', { class: 'brand-title' }, 'Dołącz do agencji'),
    h('p', { class: 'brand-sub' }, 'Wklej link zaproszenia od administratora i utwórz swoje konto. Dane agencji pobiorą się automatycznie.'),
    joinForm({
      prefill, dark: true, setLocalPassword: true,
      onDone: () => { navigator.storage?.persist?.().catch(() => {}); history.replaceState(null, '', '#/dzis'); setupPasskeyStep(true); },
    }),
    h('button', { class: 'btn btn-link-cream btn-block', onclick: showSetup }, 'Wróć')));
}

async function setupPasskeyStep(joined = false) {
  const next = joined ? () => enter() : setupDataStep;
  if (!(await auth.passkeyAvailable())) { next(); return; }
  clear(app);
  const err = h('p', { class: 'form-error', role: 'alert' });
  app.append(brandScreen(
    h('div', { class: 'brand-icon' }, icon('faceid', 56)),
    h('h1', { class: 'brand-title' }, 'Odblokowanie twarzą'),
    h('p', { class: 'brand-sub' }, 'Dodaj klucz dostępu, aby otwierać aplikację przez Face ID, Touch ID lub Windows Hello – bez wpisywania hasła.'),
    err,
    h('button', { class: 'btn btn-cream btn-block', onclick: async () => {
      try {
        await auth.registerPasskey(`${M.partnerName(M.me())} – Momenty`, deviceLabel());
        toast('Klucz dostępu dodany');
        next();
      } catch (e) { err.textContent = e.name === 'NotAllowedError' ? 'Anulowano. Możesz spróbować ponownie lub pominąć.' : (e.message || 'Nie udało się dodać klucza.'); }
    } }, icon('faceid', 20), 'Włącz klucz dostępu'),
    h('button', { class: 'btn btn-link-cream btn-block', onclick: next }, 'Pomiń – zrobię to później')));
}

function setupDataStep() {
  clear(app);
  app.append(brandScreen(
    h('h1', { class: 'brand-title' }, 'Gotowe'),
    h('p', { class: 'brand-sub' }, 'Możesz zacząć od pustej aplikacji albo najpierw obejrzeć ją z przykładowymi klientami, projektami i zadaniami (łatwo je potem usunąć w Ustawieniach).'),
    h('button', { class: 'btn btn-cream btn-block', onclick: () => enter() }, 'Zacznij od zera'),
    h('button', { class: 'btn btn-outline-cream btn-block', onclick: async () => { await db.loadRecords(); await loadDemo(); enter(); } }, 'Pokaż z przykładowymi danymi')));
}

// ---------- Lock ----------
async function showLock() {
  unlocked = false;
  closeAllSheets();
  clear(document.getElementById('toast-root'));
  clear(app);
  document.body.classList.remove('unlocked');
  const pw = h('input', { type: 'password', class: 'lock-input', placeholder: 'Hasło', autocomplete: 'current-password', 'aria-label': 'Hasło' });
  const err = h('p', { class: 'form-error', role: 'alert' });
  const btn = h('button', { class: 'btn btn-cream btn-block', type: 'submit' }, 'Odblokuj');
  const form = h('form', { class: 'brand-form', onsubmit: async (e) => {
    e.preventDefault();
    if (!pw.value) { err.textContent = 'Wpisz hasło.'; return; }
    btn.disabled = true; btn.textContent = 'Sprawdzanie…';
    const r = await auth.checkPassword(pw.value);
    btn.disabled = false; btn.textContent = 'Odblokuj';
    if (r.ok) enter(); else { err.textContent = r.error; pw.select(); }
  } }, pw, err, btn);

  const hasKeys = auth.passkeys().length > 0 && await auth.passkeyAvailable();
  const pkBtn = hasKeys ? h('button', { class: 'btn btn-outline-cream btn-block', onclick: tryPasskey }, icon('faceid', 20), 'Odblokuj kluczem dostępu') : null;
  async function tryPasskey() {
    err.textContent = '';
    try { await auth.unlockWithPasskey(); enter(); } catch (e) {
      err.textContent = e.name === 'NotAllowedError' ? 'Anulowano lub przekroczono czas.' : (e.message || 'Nie udało się.');
    }
  }
  const name = M.partnerName(M.me());
  app.append(brandScreen(
    h('p', { class: 'brand-sub' }, name ? `Witaj ponownie, ${name}` : 'Witaj ponownie'),
    pkBtn, pkBtn ? h('div', { class: 'or' }, 'lub') : null, form));
  if (!hasKeys && matchMedia('(pointer: fine)').matches) pw.focus();
}

async function enter() {
  await db.loadRecords();
  db.setActor(M.me());
  unlocked = true;
  lastActive = Date.now();
  document.body.classList.add('unlocked');
  buildShell();
  if (!location.hash || location.hash === '#' || location.hash === '#/') navigate('dzis', { replace: true });
  render();
  cloud.startAuto();
}

// auto-lock
let lastActive = Date.now();
let hiddenAt = null;
const lockMs = () => db.kvGet('lockMinutes', 5) * 60000;
['pointerdown', 'keydown', 'scroll', 'touchstart'].forEach((ev) => window.addEventListener(ev, () => { lastActive = Date.now(); }, { passive: true }));
setInterval(() => { if (unlocked && Date.now() - lastActive > lockMs()) showLock(); }, 15000);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) hiddenAt = Date.now();
  else if (unlocked && hiddenAt && Date.now() - hiddenAt > lockMs()) showLock();
});
window.addEventListener('lock-now', () => showLock());

// ---------- Shell ----------
let shell = null;

function buildShell() {
  clear(app);
  const navItem = (key, label, ic) => h('a', { class: 'nav-item', href: `#/${key}`, dataset: { tab: key },
    onclick: (e) => { e.preventDefault(); navigate(key, { replace: true }); } }, icon(ic, 22), h('span', null, label));

  const sidebar = h('nav', { class: 'sidebar', 'aria-label': 'Nawigacja' },
    h('div', { class: 'side-brand' }, h('img', { src: 'assets/icons/logo-white.png', alt: 'momenty agency' })),
    h('button', { class: 'btn btn-cream side-add', onclick: quickAdd }, icon('plus', 18), 'Dodaj'),
    h('div', { class: 'side-nav' }, TABS.map(([k, l, i]) => navItem(k, l, i))),
    h('div', { class: 'side-bottom' },
      h('button', { class: 'nav-item', onclick: openSearch }, icon('search', 22), h('span', null, 'Szukaj'), h('kbd', null, '/')),
      h('a', { class: 'nav-item', href: '#/ustawienia', dataset: { tab: 'ustawienia' } }, icon('settings', 22), h('span', null, 'Ustawienia')),
      h('div', { class: 'side-user' }, avatar(M.partnerName(M.me()), { size: 32, kind: 'me' }), h('span', null, M.partnerName(M.me())),
        h('button', { class: 'icon-btn', 'aria-label': 'Zablokuj', title: 'Zablokuj', onclick: () => showLock() }, icon('lock', 18)))));

  const backBtn = h('button', { class: 'icon-btn back-btn', 'aria-label': 'Wstecz' }, icon('back', 24));
  const titleEl = h('h1', { class: 'top-title' });
  const actionsEl = h('div', { class: 'top-actions' });
  const topbar = h('header', { class: 'topbar' }, backBtn, titleEl, actionsEl);
  const content = h('main', { class: 'content', id: 'content', tabindex: '-1' });
  const tabbar = h('nav', { class: 'tabbar', 'aria-label': 'Nawigacja' }, TABS.map(([k, l, i]) => navItem(k, l, i)));
  const fab = h('button', { class: 'fab', 'aria-label': 'Dodaj', onclick: quickAdd }, icon('plus', 28));

  app.append(h('div', { class: 'shell' }, sidebar, h('div', { class: 'main' }, topbar, content)), tabbar, fab);
  shell = { content, titleEl, actionsEl, backBtn, sidebar, tabbar, fab };
}

let lastRouteKey = null;
let renderQueued = false;

function render(opts = {}) {
  if (!unlocked || !shell) return;
  const r = current();
  let view;
  try {
    switch (r.name) {
      case 'dzis': view = renderToday(); break;
      case 'projekty': view = renderProjects(); break;
      case 'projekt': view = renderProject(r.params[0], r.query); break;
      case 'kontakty': view = renderContacts(r.params[0]); break;
      case 'kontakt': view = renderContact(r.params[0]); break;
      case 'pliki': view = renderFiles(); break;
      case 'asystent':
        if (r.params[0] === 'pismo') view = renderLetter(r.query);
        else if (r.params[0] === 'makieta') view = renderMockup(r.query);
        else view = renderAssistant();
        break;
      case 'dokument': view = renderDoc(r.params[0]); break;
      case 'ustawienia': view = renderSettings(); break;
      case 'dolacz': {
        const prefill = r.raw;
        navigate('ustawienia', { replace: true });
        if (!cloud.isLinked()) setTimeout(() => joinSheet(prefill), 50); else toast('To urządzenie jest już połączone z agencją.');
        return;
      }
      default: navigate('dzis', { replace: true }); return;
    }
  } catch (e) {
    console.error(e);
    view = { title: 'Błąd', node: h('div', { class: 'page' }, h('p', null, 'Coś poszło nie tak przy wyświetlaniu tej strony.'), h('pre', { class: 'small muted' }, String(e.stack || e))) };
  }
  const routeKey = r.raw;
  const sameRoute = routeKey === lastRouteKey;
  // forms (letter, mock-up, document) keep their state: don't redraw them on background data changes
  if (sameRoute && opts.fromData && ['asystent/pismo', 'asystent/makieta', 'dokument'].some((p) => routeKey.startsWith(p))) return;
  if (sameRoute && opts.fromData && document.activeElement?.closest('[data-keep]')) return;
  const y = window.scrollY;
  clear(shell.content).append(view.node);
  shell.titleEl.textContent = view.title;
  document.title = `${view.title} · Momenty`;
  clear(shell.actionsEl);
  if (view.action) shell.actionsEl.append(view.action);
  if (cloud.isLinked()) shell.actionsEl.append(syncDot());
  if (!view.back) {
    shell.actionsEl.append(
      h('button', { class: 'icon-btn only-narrow', 'aria-label': 'Szukaj', onclick: openSearch }, icon('search')),
      h('button', { class: 'icon-btn only-narrow', 'aria-label': 'Ustawienia', onclick: () => navigate('ustawienia') }, icon('settings')));
  }
  shell.backBtn.hidden = !view.back;
  shell.backBtn.onclick = () => back(view.back);
  document.body.classList.toggle('has-back', !!view.back);
  const tab = TAB_OF[r.name] ?? r.name;
  document.querySelectorAll('.nav-item').forEach((el) => el.classList.toggle('on', el.dataset.tab === tab));
  shell.fab.hidden = r.name === 'ustawienia' || r.name === 'dokument' || (r.name === 'asystent' && r.params.length > 0);
  if (sameRoute) window.scrollTo(0, y);
  else { window.scrollTo(0, 0); lastRouteKey = routeKey; }
  if (opts.keepFocus) {
    const el = document.getElementById(opts.keepFocus);
    if (el) { el.focus({ preventScroll: true }); const n = el.value.length; try { el.setSelectionRange(n, n); } catch { /* search inputs */ } }
  }
}

function syncDot() {
  const st = cloud.status();
  const label = { syncing: 'Synchronizacja…', ok: 'Zsynchronizowano', offline: 'Offline – zmiany zostaną wysłane później', error: `Błąd synchronizacji: ${st.error || ''}`, signedout: 'Zaloguj się ponownie (Ustawienia)' }[st.phase] || 'Synchronizacja';
  return h('button', { class: `icon-btn sync-dot sync-${st.phase}`, 'aria-label': label, title: label, onclick: () => {
    if (st.phase === 'signedout') { navigate('ustawienia'); return; }
    cloud.syncNow().then(() => toast('Zsynchronizowano')).catch((e) => toast(e.message));
  } }, icon('sync', 20));
}
cloud.onStatus(() => {
  const el = document.querySelector('.sync-dot');
  if (el) el.replaceWith(syncDot());
});

function queueRender(opts) {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; render(opts); });
}

onRoute(() => { closeAllSheets(); render(); });
db.onChange(() => queueRender({ fromData: true }));
window.addEventListener('rerender', (e) => render(e.detail || {}));

// ---------- Quick add ----------
function quickAdd() {
  const input = h('input', { type: 'text', class: 'qa-input', placeholder: 'np. Zadzwonić do Magazynu Styl jutro o 15', autocomplete: 'off', enterkeyhint: 'done', 'aria-label': 'Nowe zadanie' });
  const preview = h('div', { class: 'qa-preview' });
  let owner = M.me();
  const ownerSeg = h('div', { class: 'seg' }, M.partnerOptions(false).map(([id, name]) =>
    h('button', { type: 'button', class: `seg-btn ${id === owner ? 'on' : ''}`, onclick: (e) => {
      owner = id; ownerSeg.querySelectorAll('.seg-btn').forEach((b) => b.classList.remove('on')); e.currentTarget.classList.add('on');
    } }, id === 'oba' ? 'Obie osoby' : name.split(' ')[0])));
  const upd = () => {
    const p = M.parseQuick(input.value);
    clear(preview);
    if (p.due) preview.append(h('span', { class: 'chip' }, icon('calendar', 14), relDay(p.due), p.time ? ` · ${p.time}` : ''));
    else if (input.value.trim()) preview.append(h('span', { class: 'chip chip-muted' }, icon('calendar', 14), 'Dziś (domyślnie)'));
  };
  input.addEventListener('input', upd);
  const save = async (more = false) => {
    const p = M.parseQuick(input.value);
    if (!p.title) { input.focus(); toast('Wpisz treść zadania.'); return; }
    const vals = { title: p.title, due: p.due || todayStr(), time: p.time || '', owner, kind: 'zadanie', priority: 'normalny', done: false };
    s.close();
    if (more) { editTask(null, vals); return; }
    const t = await db.put('tasks', vals);
    db.logActivity(`dodał(a) zadanie: ${t.title}`, { col: 'tasks', id: t.id });
    toast(`Dodano: ${relDay(t.due).toLowerCase()}${t.time ? ` ${t.time}` : ''}`);
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });

  const sc = (ic, label, fn) => h('button', { class: 'shortcut', onclick: () => { s.close(); fn(); } }, h('span', { class: 'sc-ic' }, icon(ic, 22)), h('span', null, label));
  const s = openSheet({
    title: 'Dodaj',
    body: [
      h('div', { class: 'qa-box' }, input, preview),
      h('div', { class: 'qa-owner' }, h('span', { class: 'field-label' }, 'Dla kogo'), ownerSeg),
      h('div', { class: 'qa-row' },
        h('button', { class: 'btn btn-ghost', onclick: () => save(true) }, 'Więcej opcji'),
        ai.available() ? h('button', { class: 'btn btn-soft', title: 'Asystent AI wykona polecenie (np. e-mail, kilka zadań naraz)', onclick: () => {
          const text = input.value.trim();
          if (!text) { input.focus(); toast('Wpisz lub podyktuj polecenie.'); return; }
          s.close(); navigate('asystent'); sendCommand(text);
        } }, icon('ai', 16), 'Z AI') : null,
        h('button', { class: 'btn btn-primary', onclick: () => save() }, 'Dodaj zadanie')),
      h('p', { class: 'hint-line' }, 'Rozpoznaję daty: dziś, jutro, pojutrze, w piątek, 12.10, za 3 dni, o 15, 15:30.'),
      h('div', { class: 'shortcuts' },
        sc('camera', 'Zdjęcie', () => uploadFlow({ camera: true })),
        sc('upload', 'Plik', () => uploadFlow()),
        sc('projects', 'Projekt', () => editProject()),
        sc('contacts', 'Kontakt', () => editContact(null, db.kvGet('contactKind', 'klient'))),
        sc('doc', 'Pismo', () => navigate('asystent/pismo')),
        sc('instagram', 'Makieta', () => navigate('asystent/makieta'))),
    ],
  });
  input.focus({ preventScroll: true });
}

// ---------- Search ----------
function openSearch() {
  const input = h('input', { type: 'search', class: 'qa-input', placeholder: 'Szukaj klientów, projektów, zadań…', 'aria-label': 'Szukaj' });
  const results = h('div', { class: 'search-results' });
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l');
  const run = () => {
    const q = norm(input.value.trim());
    clear(results);
    if (q.length < 2) { results.append(h('p', { class: 'muted pad' }, 'Wpisz co najmniej 2 znaki.')); return; }
    const match = (o, keys) => keys.some((k) => norm(o[k]).includes(q));
    const groups = [
      ['Kontakty', db.all('contacts').filter((c) => match(c, ['name', 'instagram', 'outlet', 'industry', 'niche', 'person', 'email', 'city', 'notes'])),
        (c) => [avatar(c.name, { kind: c.kind, size: 32 }), c.name, M.contactSubtitle(c) || M.kindLabel(c.kind), `kontakt/${c.id}`]],
      ['Projekty', db.all('projects').filter((p) => match(p, ['title', 'description', 'goal'])),
        (p) => [h('span', { class: 'row-ic' }, icon('projects', 20)), p.title, M.stageLabel(p.stage), `projekt/${p.id}`]],
      ['Zadania', db.all('tasks').filter((t) => match(t, ['title', 'notes'])).sort(M.sortTasks),
        (t) => [h('span', { class: 'row-ic' }, icon(t.done ? 'check' : M.taskKindIcon(t.kind), 20)), t.title, `${t.due ? relDay(t.due) : 'Bez terminu'}${t.done ? ' · ukończone' : ''}`, null, t]],
      ['Dokumenty', db.all('docs').filter((d) => match(d, ['title', 'body'])),
        (d) => [h('span', { class: 'row-ic' }, icon('doc', 20)), d.title, 'Dokument', `dokument/${d.id}`]],
    ];
    let any = false;
    for (const [label, items, fmt] of groups) {
      if (!items.length) continue;
      any = true;
      results.append(h('div', { class: 'letter' }, label), h('div', { class: 'list' }, items.slice(0, 8).map((it) => {
        const [ic, title, sub, path, task] = fmt(it);
        return h('button', { class: 'list-row', onclick: () => { s.close(); if (task) editTask(task); else navigate(path); } },
          ic, h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, title), h('div', { class: 'row-meta' }, sub)));
      })));
    }
    if (!any) results.append(h('p', { class: 'muted pad' }, 'Brak wyników.'));
  };
  input.addEventListener('input', run);
  const s = openSheet({ title: 'Szukaj', body: [input, results], className: 'sheet-search' });
  run();
  input.focus({ preventScroll: true }); // synchronously, so the first typed keys are not lost
}

document.addEventListener('keydown', (e) => {
  if (!unlocked) return;
  const tag = document.activeElement?.tagName;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || document.querySelector('.sheet-backdrop')) return;
  if (e.key === '/' || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) { e.preventDefault(); openSearch(); }
  else if (e.key.toLowerCase() === 'n' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); quickAdd(); }
});

// ---------- Service worker ----------
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  let reloading = false;
  const hadController = !!navigator.serviceWorker.controller; // first install must not reload mid-setup
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloading) { reloading = true; location.reload(); } });
  navigator.serviceWorker.register('sw.js').then((reg) => {
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      nw?.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) {
          toast('Dostępna jest nowa wersja aplikacji.', { action: 'Odśwież', onAction: () => nw.postMessage('skipWaiting'), timeout: 30000 });
        }
      });
    });
  }).catch((e) => console.warn('SW', e));
}

boot();
