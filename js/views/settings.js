import * as db from '../db.js';
import * as M from '../model.js';
import * as auth from '../auth.js';
import {
  h, icon, toast, confirmDialog, openSheet, buildForm, download, fmtBytes, todayStr, addDays, dateTime,
} from '../ui.js';
import { section } from '../components.js';
import { navigate } from '../router.js';
import { APP_VERSION } from '../version.js';

export function renderSettings() {
  const ps = M.partners();
  const lockMin = db.kvGet('lockMinutes', 5);
  const last = db.kvGet('lastBackup');
  const keys = auth.passkeys();
  const hasDemo = db.all('contacts').some((c) => c.demo) || db.all('tasks').some((t) => t.demo);

  const storageEl = h('span', { class: 'muted' }, '…');
  if (navigator.storage?.estimate) {
    navigator.storage.estimate().then((e) => { storageEl.textContent = `${fmtBytes(e.usage || 0)} z ~${fmtBytes(e.quota || 0)}`; });
  }
  const persistEl = h('span', { class: 'muted' }, '…');
  if (navigator.storage?.persisted) navigator.storage.persisted().then((p) => { persistEl.textContent = p ? 'trwała (chroniona)' : 'standardowa'; });

  const row = (label, value, onclick, ic) => h(onclick ? 'button' : 'div', { class: 'set-row', onclick },
    ic ? h('span', { class: 'row-ic' }, icon(ic, 20)) : null,
    h('span', { class: 'set-label' }, label), h('span', { class: 'set-value' }, value),
    onclick ? icon('chevron', 18, 'muted') : null);

  return {
    title: 'Ustawienia',
    back: 'dzis',
    node: h('div', { class: 'page page-narrow' },
      section('Zespół', h('div', { class: 'set-group' },
        row('Osoby w agencji', ps.map((p) => p.name).join(' i '), editTeam, 'users'),
        row('Na tym urządzeniu pracuje', M.partnerName(M.me()), editTeam, 'contacts'))),

      section('Bezpieczeństwo', h('div', { class: 'set-group' },
        row('Zmień hasło', '', changePassword, 'lock'),
        row('Klucze dostępu (Face ID / Touch ID / Windows Hello)', keys.length ? `${keys.length} zapisane` : 'brak', managePasskeys, 'faceid'),
        h('label', { class: 'set-row' }, h('span', { class: 'row-ic' }, icon('clock', 20)), h('span', { class: 'set-label' }, 'Automatyczna blokada po'),
          h('select', { class: 'set-select', onchange: (e) => db.kvSet('lockMinutes', Number(e.target.value)).then(() => toast('Zapisano')) },
            [[1, '1 min'], [5, '5 min'], [15, '15 min'], [30, '30 min'], [60, '1 godz.']].map(([v, l]) => h('option', { value: v, selected: v === lockMin }, l)))),
        row('Zablokuj teraz', '', () => window.dispatchEvent(new Event('lock-now')), 'key'))),

      section('Kalendarz Google', h('div', { class: 'set-group' },
        h('div', { class: 'set-text' },
          h('p', null, 'Każde zadanie z datą ma przycisk „Dodaj do Kalendarza Google”. Możesz też pobrać wszystkie nadchodzące zadania naraz jako plik kalendarza (.ics) i zaimportować go w Kalendarzu Google (Ustawienia → Importuj i eksportuj).'),
          h('p', { class: 'muted small' }, 'Przypomnienia dobierane są do rodzaju zadania, np. termin/embargo: 2 dni i 1 dzień przed; spotkanie: 1 godz. i 15 min przed. Automatyczna synchronizacja z kalendarzem pojawi się w wersji 2.')),
        row('Pobierz nadchodzące zadania (.ics)', '', exportIcs, 'calendar'))),

      section('Kopia zapasowa', h('div', { class: 'set-group' },
        row('Ostatnia kopia', last ? dateTime(last) : 'nigdy', null, 'download'),
        row('Pobierz kopię (bez plików)', '', () => exportBackup(false), 'download'),
        row('Pobierz pełną kopię (z plikami i zdjęciami)', '', () => exportBackup(true), 'download'),
        row('Przywróć z kopii', '', importBackup, 'upload'),
        h('div', { class: 'set-text muted small' }, 'Dane są zapisane na tym urządzeniu. Zapisuj kopię regularnie (np. w iCloud Drive lub na Dysku Google). Synchronizacja w chmurze między Wami pojawi się po podłączeniu serwera (wersja 2).'))),

      section('Dane', h('div', { class: 'set-group' },
        row('Zajęte miejsce', storageEl, null, 'files'),
        row('Ochrona danych przed usunięciem przez przeglądarkę', persistEl, null, 'lock'),
        hasDemo ? row('Usuń dane przykładowe', '', removeDemo, 'trash')
          : row('Załaduj dane przykładowe', '', async () => { await loadDemo(); toast('Dodano dane przykładowe'); navigate('dzis'); }, 'ai'),
        h('button', { class: 'set-row danger-text', onclick: wipe }, h('span', { class: 'row-ic' }, icon('trash', 20)), h('span', { class: 'set-label' }, 'Usuń wszystkie dane z tego urządzenia')))),

      h('p', { class: 'hint-line center' }, `Momenty Agency · wersja ${APP_VERSION}`)),
  };
}

function editTeam() {
  const ps = M.partners();
  const form = buildForm([
    { key: 'p1', label: 'Osoba 1', required: true },
    { key: 'p2', label: 'Osoba 2', required: true },
    { key: 'me', label: 'Na tym urządzeniu pracuje', type: 'select', options: ps.map((p) => [p.id, p.name]) },
  ], { p1: ps[0].name, p2: ps[1].name, me: M.me() });
  const sync = () => {
    const v = form.read();
    [...form.inputs.me.options].forEach((o) => { o.textContent = o.value === 'p1' ? v.p1 || 'Osoba 1' : v.p2 || 'Osoba 2'; });
  };
  form.inputs.p1.addEventListener('input', sync);
  form.inputs.p2.addEventListener('input', sync);
  const s = openSheet({
    title: 'Zespół',
    body: form.el,
    footer: [h('button', { class: 'btn btn-ghost', onclick: () => s.close() }, 'Anuluj'),
      h('button', { class: 'btn btn-primary', onclick: async () => {
        if (!form.validate()) return;
        const v = form.read();
        await db.kvSet('partners', [{ id: 'p1', name: v.p1 }, { id: 'p2', name: v.p2 }]);
        await db.kvSet('me', v.me);
        db.setActor(v.me);
        s.close(); toast('Zapisano'); window.dispatchEvent(new Event('rerender'));
      } }, 'Zapisz')],
  });
}

function changePassword() {
  const form = buildForm([
    { key: 'old', label: 'Obecne hasło', type: 'password', required: true, full: true, autocomplete: 'current-password' },
    { key: 'pw', label: 'Nowe hasło', type: 'password', required: true, full: true, autocomplete: 'new-password', hint: 'Min. 8 znaków, litery i cyfra.' },
    { key: 'pw2', label: 'Powtórz nowe hasło', type: 'password', required: true, full: true, autocomplete: 'new-password' },
  ]);
  const s = openSheet({
    title: 'Zmień hasło',
    body: form.el,
    footer: [h('button', { class: 'btn btn-ghost', onclick: () => s.close() }, 'Anuluj'),
      h('button', { class: 'btn btn-primary', onclick: async () => {
        if (!form.validate()) return;
        const v = form.read();
        const chk = await auth.checkPassword(v.old);
        if (!chk.ok) { toast(chk.error); return; }
        const prob = auth.passwordProblem(v.pw);
        if (prob) { toast(prob); return; }
        if (v.pw !== v.pw2) { toast('Hasła nie są takie same.'); return; }
        await auth.setPassword(v.pw);
        s.close(); toast('Hasło zmienione');
      } }, 'Zmień')],
  });
}

async function managePasskeys() {
  const available = await auth.passkeyAvailable();
  const draw = () => {
    const keys = auth.passkeys();
    return h('div', null,
      h('p', { class: 'muted' }, 'Klucz dostępu pozwala odblokować aplikację twarzą lub odciskiem palca (Face ID, Touch ID, Windows Hello) – bez wpisywania hasła. Klucz działa na urządzeniu, na którym został dodany.'),
      keys.length ? h('div', { class: 'list' }, keys.map((k) => h('div', { class: 'list-row' }, h('span', { class: 'row-ic' }, icon('faceid', 20)),
        h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, k.label || 'Klucz dostępu'), h('div', { class: 'row-meta' }, `Dodany ${dateTime(k.createdAt)}`)),
        h('button', { class: 'icon-btn', 'aria-label': 'Usuń klucz', onclick: async () => {
          if (await confirmDialog('Usunąć ten klucz dostępu?', { ok: 'Usuń', danger: true })) { await auth.removePasskey(k.id); s.close(); managePasskeys(); }
        } }, icon('trash', 18))))) : null,
      !available ? h('p', { class: 'notice small' }, 'To urządzenie lub przeglądarka nie obsługuje kluczy dostępu. Na iPhonie potrzebny jest iOS 16 lub nowszy i włączony kod blokady.') : null);
  };
  const s = openSheet({
    title: 'Klucze dostępu',
    body: draw(),
    footer: [h('button', { class: 'btn btn-ghost', onclick: () => s.close() }, 'Zamknij'),
      available ? h('button', { class: 'btn btn-primary', onclick: async () => {
        try {
          await auth.registerPasskey(`${M.partnerName(M.me())} – Momenty`, deviceLabel());
          s.close(); toast('Klucz dostępu dodany'); window.dispatchEvent(new Event('rerender'));
        } catch (e) { if (e.name !== 'NotAllowedError') toast(e.message || 'Nie udało się dodać klucza.'); else toast('Anulowano.'); }
      } }, icon('faceid', 18), 'Dodaj klucz dostępu') : null],
  });
}

export function deviceLabel() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Komputer z Windows';
  if (/Android/.test(ua)) return 'Android';
  return 'To urządzenie';
}

function exportIcs() {
  const tasks = db.all('tasks').filter((t) => !t.done && t.due && t.due >= addDays(todayStr(), -1));
  if (!tasks.length) { toast('Brak nadchodzących zadań z datą.'); return; }
  download(new Blob([M.buildIcs(tasks)], { type: 'text/calendar;charset=utf-8' }), `momenty-zadania-${todayStr()}.ics`);
  toast(`Pobrano ${tasks.length} wydarzeń`);
}

function blobToB64(b) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(b); });
}

async function exportBackup(withFiles) {
  toast('Przygotowywanie kopii…', { timeout: 1500 });
  const records = await db.allRecordsRaw();
  const out = { app: 'momenty-agency', version: 1, exportedAt: new Date().toISOString(), partners: M.partners(), records };
  if (withFiles) {
    out.blobs = [];
    for (const f of records.filter((r) => r.col === 'files' && !r.deleted)) {
      for (const id of [f.blobId, f.thumbId].filter(Boolean)) {
        const b = await db.getBlob(id);
        if (b) out.blobs.push({ id, type: b.type, data: await blobToB64(b) });
      }
    }
  }
  download(new Blob([JSON.stringify(out)], { type: 'application/json' }), `momenty-kopia-${todayStr()}${withFiles ? '-pelna' : ''}.json`);
  await db.kvSet('lastBackup', new Date().toISOString());
  toast('Kopia zapisana');
  window.dispatchEvent(new Event('rerender'));
}

async function importBackup() {
  const input = h('input', { type: 'file', accept: 'application/json,.json', style: { display: 'none' } });
  document.body.append(input);
  input.addEventListener('change', async () => {
    const f = input.files[0];
    input.remove();
    if (!f) return;
    let data;
    try { data = JSON.parse(await f.text()); } catch { toast('To nie jest prawidłowy plik kopii.'); return; }
    if (data.app !== 'momenty-agency' || !Array.isArray(data.records)) { toast('To nie jest kopia aplikacji Momenty.'); return; }
    if (!(await confirmDialog(`Przywrócić dane z kopii z ${dateTime(data.exportedAt)}? Nowsze zmiany na tym urządzeniu zostaną zachowane.`, { ok: 'Przywróć' }))) return;
    let nb = 0;
    for (const b of data.blobs || []) {
      if (await db.getBlob(b.id)) continue;
      const bin = Uint8Array.from(atob(b.data), (c) => c.charCodeAt(0));
      await db.putBlob(b.id, new Blob([bin], { type: b.type }));
      nb++;
    }
    const n = await db.importRecords(data.records);
    toast(`Przywrócono ${n} wpisów${nb ? ` i ${nb} plików` : ''}`);
  });
  input.click();
}

async function wipe() {
  if (!(await confirmDialog('Wszystkie dane, pliki, hasło i klucze dostępu zostaną trwale usunięte z tego urządzenia. Zrób wcześniej kopię zapasową!', { title: 'Usunąć wszystko?', ok: 'Dalej', danger: true }))) return;
  if (!(await confirmDialog('Tej operacji nie można cofnąć. Na pewno?', { title: 'Ostatnie potwierdzenie', ok: 'Usuń wszystko', danger: true }))) return;
  await db.wipeAll();
  location.hash = '';
  location.reload();
}

async function removeDemo() {
  if (!(await confirmDialog('Usunąć wszystkie dane przykładowe?', { ok: 'Usuń', danger: true }))) return;
  for (const col of ['contacts', 'projects', 'tasks', 'docs']) {
    for (const r of db.all(col).filter((x) => x.demo)) await db.put(col, { id: r.id, deleted: true }, { silent: true });
  }
  for (const a of db.all('activity').filter((x) => x.demo)) await db.put('activity', { id: a.id, deleted: true }, { silent: true });
  toast('Usunięto dane przykładowe');
  window.dispatchEvent(new Event('rerender'));
}

export async function loadDemo() {
  const T = todayStr();
  const me = M.me();
  const other = M.otherPartner()?.id || 'p2';
  const d = { demo: true };
  const put = (col, rec) => db.put(col, { ...rec, ...d }, { silent: true });
  const c1 = await put('contacts', { kind: 'klient', name: 'Atelier Lumière', industry: 'Kosmetyki naturalne', status: 'aktywny', person: 'Joanna Wiśniewska', role: 'Dyrektor marketingu', email: 'joanna@example.com', phone: '+48 600 100 200', instagram: '@atelierlumiere', lead: me, health: 'dobra', retainer: '9 000 zł / mies.', contractEnd: addDays(T, 24), messages: 'Naturalne składniki z polskich upraw.\nLuksus bez kompromisów.\nUnikamy słowa „tani”.' });
  const c2 = await put('contacts', { kind: 'klient', name: 'Villa Nova Restauracja', industry: 'Gastronomia', status: 'aktywny', person: 'Marek Zieliński', email: 'marek@example.com', phone: '+48 600 300 400', lead: other, health: 'uwaga', retainer: '6 500 zł / mies.' });
  const i1 = await put('contacts', { kind: 'influencer', name: 'Ola Kamińska', instagram: '@ola.beauty', niche: 'beauty, pielęgnacja', followers: 184000, engagement: 4.2, city: 'Warszawa', rates: 'post 4 500 zł, relacja 1 500 zł', rating: 5, email: 'ola@example.com' });
  const i2 = await put('contacts', { kind: 'influencer', name: 'Kuba Nowicki', instagram: '@kuba.eats', tiktok: '@kubaeats', niche: 'jedzenie, lifestyle', followers: 92000, engagement: 6.1, city: 'Kraków', rates: 'reel 3 000 zł', rating: 4 });
  const m1 = await put('contacts', { kind: 'media', name: 'Anna Lewandowska', outlet: 'Magazyn Styl', role: 'Redaktorka działu beauty', beat: 'beauty, moda', email: 'anna@example.com', preferences: 'Tylko e-mail, najlepiej rano' });
  await put('contacts', { kind: 'partner', name: 'Studio Foto Kadr', service: 'Fotograf eventowy', person: 'Piotr', phone: '+48 600 500 600', city: 'Warszawa', rates: '2 500 zł / dzień', rating: 5 });
  const p1 = await put('projects', { title: 'Premiera serum jesiennego', clientId: c1.id, type: 'influencer', stage: 'realizacja', owner: me, start: addDays(T, -14), due: addDays(T, 9), budget: '40 000 zł', goal: '8 publikacji, 1 mln zasięgu', description: 'Kampania premierowa nowego serum. Wysyłka paczek PR do 15 influencerek, event prasowy, publikacje w mediach beauty.', influencerIds: [i1.id] });
  const p2 = await put('projects', { title: 'Kolacja degustacyjna dla mediów', clientId: c2.id, type: 'event', stage: 'przygotowanie', owner: other, start: addDays(T, -5), due: addDays(T, 16), description: 'Kolacja dla 20 dziennikarzy i twórców kulinarnych z okazji nowej karty.', influencerIds: [i2.id] });
  const tasks = [
    { title: 'Wysłać paczki PR do influencerek', due: T, time: '10:00', owner: me, projectId: p1.id, priority: 'wysoki', kind: 'zadanie' },
    { title: 'Follow-up: Magazyn Styl – recenzja serum', due: T, owner: me, projectId: p1.id, contactId: m1.id, kind: 'followup' },
    { title: 'Akceptacja menu degustacyjnego z szefem kuchni', due: T, time: '15:30', owner: other, projectId: p2.id, kind: 'spotkanie' },
    { title: 'Publikacja Oli – post w feedzie', due: addDays(T, 2), time: '18:00', owner: me, projectId: p1.id, contactId: i1.id, kind: 'publikacja' },
    { title: 'Embargo informacji prasowej', due: addDays(T, 4), time: '09:00', owner: 'oba', projectId: p1.id, kind: 'termin' },
    { title: 'Lista gości – potwierdzenia', due: addDays(T, 3), owner: other, projectId: p2.id, kind: 'zadanie' },
    { title: 'Raport miesięczny dla Atelier Lumière', due: addDays(T, -1), owner: me, contactId: c1.id, priority: 'wysoki', kind: 'zadanie' },
    { title: 'Rezerwacja fotografa na kolację', due: addDays(T, 1), owner: other, projectId: p2.id, kind: 'zadanie' },
    { title: 'Brief dla Kuby Nowickiego', due: addDays(T, 5), owner: other, projectId: p2.id, contactId: i2.id, kind: 'zadanie' },
    { title: 'Moodboard sesji zdjęciowej', due: addDays(T, -6), owner: me, projectId: p1.id, kind: 'zadanie', done: true, doneAt: new Date(Date.now() - 5 * 864e5).toISOString() },
  ];
  for (const t of tasks) await put('tasks', { done: false, priority: 'normalny', ...t });
  await db.put('activity', { text: 'dodał(a) dane przykładowe', at: new Date().toISOString(), by: me, demo: true });
}
