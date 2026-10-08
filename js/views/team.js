// Settings sections: team & sync (pairing), integrations (Google Calendar, Canva, AI), agency details.

import * as db from '../db.js';
import * as M from '../model.js';
import * as cloud from '../cloud.js';
import * as auth from '../auth.js';
import { h, icon, toast, openSheet, buildForm, confirmDialog, dateTime, clear } from '../ui.js';
import { section } from '../components.js';
import { AGENCY_ID, agencyProfile } from '../agency.js';

const rerender = () => window.dispatchEvent(new Event('rerender'));

const row = (label, value, onclick, ic, cls = '') => h(onclick ? 'button' : 'div', { class: `set-row ${cls}`, onclick },
  ic ? h('span', { class: 'row-ic' }, icon(ic, 20)) : null,
  h('span', { class: 'set-label' }, label), value != null ? h('span', { class: 'set-value' }, value) : null,
  onclick ? icon('chevron', 18, 'muted') : null);

function syncLabel(st) {
  switch (st.phase) {
    case 'syncing': return 'synchronizacja…';
    case 'ok': return st.last ? `aktualne · ${dateTime(st.last)}` : 'aktualne';
    case 'offline': return 'brak internetu – zmiany wyślą się później';
    case 'error': return `błąd: ${st.error || ''}`;
    case 'signedout': return 'zaloguj się ponownie';
    default: return 'wyłączona';
  }
}

// ======================================================================= Team & sync
export function teamSection() {
  const c = cloud.config();
  if (!cloud.isLinked()) {
    return section('Zespół i synchronizacja', h('div', { class: 'set-group' },
      h('div', { class: 'set-text' },
        h('p', null, 'Połącz aplikację z bezpiecznym serwerem agencji, aby obie osoby widziały te same dane na wszystkich urządzeniach. Dostęp mają wyłącznie osoby zaproszone przez administratora.'),
        c?.url && !db.kvGet('cloudSession') ? h('p', { class: 'small muted' }, 'Ten telefon był połączony – zaloguj się ponownie.') : null),
      row(c?.url ? 'Zaloguj się do agencji' : 'Połącz z serwerem agencji', null, () => connectSheet(), 'sync'),
      row('Mam zaproszenie (link)', null, () => joinSheet(), 'link')));
  }
  const st = cloud.status();
  const list = h('div', { class: 'list' }, h('p', { class: 'muted pad' }, 'Wczytywanie…'));
  cloud.members().then((ms) => {
    clear(list);
    for (const m of ms) {
      const isMe = m.user_id === cloud.user()?.id;
      list.append(h('div', { class: 'list-row' },
        h('span', { class: 'owner owner-me' }, (m.display_name[0] || '?').toUpperCase()),
        h('div', { class: 'row-main' },
          h('div', { class: 'row-title' }, m.display_name, isMe ? h('span', { class: 'muted small' }, ' (Ty)') : null),
          h('div', { class: 'row-meta' }, `${m.role === 'admin' ? 'Administrator' : 'Członek zespołu'} · ${m.email || ''}`)),
        c.role === 'admin' && !isMe ? h('button', { class: 'icon-btn', 'aria-label': `Usuń ${m.display_name}`, onclick: async () => {
          if (!(await confirmDialog(`Odebrać dostęp osobie ${m.display_name}? Straci dostęp do danych agencji na wszystkich urządzeniach.`, { ok: 'Odbierz dostęp', danger: true }))) return;
          try { await cloud.removeMember(m.user_id); toast('Dostęp odebrany'); rerender(); } catch (e) { toast(e.message); }
        } }, icon('trash', 18)) : null));
    }
  }).catch((e) => { clear(list).append(h('p', { class: 'muted pad' }, e.message)); });

  return section('Zespół i synchronizacja', h('div', null,
    h('div', { class: 'set-group' },
      row('Agencja', c.agency || 'Momenty Agency', null, 'building'),
      row('Zalogowano jako', `${c.email || ''} · ${c.role === 'admin' ? 'administrator' : 'członek'}`, null, 'contacts'),
      row('Synchronizacja', syncLabel(st), async () => {
        try { await cloud.syncNow(); toast('Zsynchronizowano'); } catch (e) { toast(e.message); }
        rerender();
      }, 'sync'),
      c.role === 'admin' ? row('Zaproś osobę do agencji', null, inviteSheet, 'plus') : null,
      row('Wyloguj to urządzenie', null, async () => {
        if (!(await confirmDialog('Wylogować to urządzenie? Dane zostaną na tym urządzeniu, ale przestaną się synchronizować.', { ok: 'Wyloguj' }))) return;
        await cloud.signOut(); toast('Wylogowano'); rerender();
      }, 'lock')),
    h('div', { class: 'letter' }, 'Osoby z dostępem'),
    list));
}

function serverFields(c) {
  return [
    { key: 'url', label: 'Adres serwera (Project URL)', type: 'url', full: true, required: true, placeholder: 'https://xxxx.supabase.co', hint: 'Supabase → Project Settings → API' },
    { key: 'key', label: 'Klucz publiczny (anon / publishable)', full: true, required: true, placeholder: 'eyJ… lub sb_publishable_…', hint: 'To klucz publiczny – bezpieczny w aplikacji. Nigdy nie wpisuj tu klucza „service_role” / „secret”.' },
  ];
}

/** Admin: connect this device to the agency server; create the agency (first time) or sign in. */
export function connectSheet() {
  const c = cloud.config() || {};
  const srv = buildForm(serverFields(c), c);
  let mode = 'create';
  const modeSeg = h('div', { class: 'seg' }, [['create', 'Nowa agencja'], ['login', 'Mam już konto']].map(([k, l]) =>
    h('button', { type: 'button', class: `seg-btn ${k === mode ? 'on' : ''}`, onclick: (e) => {
      mode = k; modeSeg.querySelectorAll('.seg-btn').forEach((b) => b.classList.remove('on')); e.currentTarget.classList.add('on'); draw();
    } }, l)));
  const holder = h('div');
  let acc;
  const draw = () => {
    acc = buildForm([
      ...(mode === 'create' ? [{ key: 'name', label: 'Twoje imię', required: true, full: true, default: M.partnerName(M.me()) }] : []),
      { key: 'email', label: 'E-mail', type: 'email', required: true, full: true, autocomplete: 'username', default: c.email || '' },
      { key: 'pw', label: 'Hasło do konta', type: 'password', required: true, full: true, autocomplete: mode === 'create' ? 'new-password' : 'current-password', hint: mode === 'create' ? 'Min. 8 znaków, litery i cyfra. Może być takie samo jak hasło do aplikacji.' : null },
    ]);
    clear(holder).append(acc.el);
  };
  draw();
  const err = h('p', { class: 'form-error-dark', role: 'alert' });
  const btn = h('button', { class: 'btn btn-primary', onclick: go }, 'Połącz');
  const s = openSheet({
    title: 'Serwer agencji',
    body: [
      h('p', { class: 'muted' }, 'Dane konfiguracji znajdziesz w swoim projekcie Supabase (instrukcja w pliku SETUP.md w repozytorium). Robi to tylko administrator – druga osoba dołącza przez link zaproszenia.'),
      srv.el, modeSeg, holder, err,
    ],
    footer: [h('button', { class: 'btn btn-ghost', onclick: () => s.close() }, 'Anuluj'), btn],
  });
  async function go() {
    if (!srv.validate() || !acc.validate()) return;
    const v = { ...srv.read(), ...acc.read() };
    if (!/^https:\/\/|^http:\/\/(127\.0\.0\.1|localhost)/.test(v.url)) { err.textContent = 'Adres serwera musi zaczynać się od https://'; return; }
    if (mode === 'create') { const p = auth.passwordProblem(v.pw); if (p) { err.textContent = p; return; } }
    err.textContent = ''; btn.disabled = true; btn.textContent = 'Łączenie…';
    try {
      await cloud.saveConfig({ url: v.url, key: v.key });
      if (mode === 'create') {
        try { await cloud.signUp(v.email, v.pw); } catch (e) {
          if (/już istnieje/.test(e.message)) await cloud.signIn(v.email, v.pw); else throw e;
        }
        const st = await cloud.agencyStatus();
        if (st.member) await cloud.linkExisting();
        else await cloud.createAgency(v.name, M.me());
        await cloud.rpc('update_my_name', { p_name: v.name });
      } else {
        await cloud.signIn(v.email, v.pw);
        await cloud.linkExisting();
      }
      cloud.startAuto();
      await cloud.syncNow().catch(() => {});
      s.close();
      toast('Połączono – synchronizacja włączona');
      rerender();
    } catch (e) {
      err.textContent = e.message;
    } finally { btn.disabled = false; btn.textContent = 'Połącz'; }
  }
}

function inviteSheet() {
  const form = buildForm([
    { key: 'name', label: 'Imię osoby zapraszanej', required: true, full: true, default: M.partners().find((p) => !p.userId)?.name || '' },
    { key: 'role', label: 'Uprawnienia', type: 'select', full: true, options: [['admin', 'Administrator (może zapraszać i usuwać osoby)'], ['member', 'Członek zespołu']] },
  ]);
  const out = h('div');
  const s = openSheet({
    title: 'Zaproś do agencji',
    body: [h('p', { class: 'muted' }, 'Zaproszenie działa jeden raz i wygasa po 7 dniach. Wyślij link tylko tej osobie (np. SMS-em lub w WhatsAppie).'), form.el, out],
    footer: [h('button', { class: 'btn btn-ghost', onclick: () => s.close() }, 'Zamknij'),
      h('button', { class: 'btn btn-primary', onclick: async (e) => {
        if (!form.validate()) return;
        const v = form.read();
        e.currentTarget.disabled = true;
        try {
          const link = await cloud.createInvite(v.name, v.role);
          clear(out).append(
            h('label', { class: 'field field-full' }, h('span', { class: 'field-label' }, 'Link zaproszenia'),
              h('textarea', { class: 'invite-link', rows: 4, readonly: true, onclick: (ev) => ev.target.select() }, link)),
            h('div', { class: 'sheet-actions' },
              navigator.share ? h('button', { class: 'btn btn-soft', onclick: () => navigator.share({ title: 'Zaproszenie – Momenty Agency', text: `Zaproszenie do aplikacji Momenty Agency dla ${v.name}:`, url: link }).catch(() => {}) }, icon('share', 18), 'Wyślij') : null,
              h('button', { class: 'btn btn-soft', onclick: async () => { try { await navigator.clipboard.writeText(link); toast('Skopiowano link'); } catch { toast('Zaznacz i skopiuj link ręcznie'); } } }, icon('copy', 18), 'Kopiuj')),
            h('p', { class: 'hint-line' }, 'Na iPhonie: najpierw otwórz link w Safari, dodaj aplikację do ekranu początkowego, a potem w aplikacji wybierz „Mam zaproszenie” i wklej ten link.'));
        } catch (err) { toast(err.message); e.currentTarget.disabled = false; }
      } }, 'Utwórz zaproszenie')],
  });
}

/** Joining with an invite link from inside an already set-up app. */
export function joinSheet(prefill = '') {
  const holder = h('div');
  const s = openSheet({ title: 'Dołącz do agencji', body: holder });
  holder.append(joinForm({ prefill, dark: false, onDone: () => { s.close(); toast('Dołączono do agencji'); rerender(); } }));
}

/**
 * Join form used on the first-run screen and in Settings.
 * onDone(result) is called after the account is paired and the first sync finished.
 */
export function joinForm({ prefill = '', dark = true, onDone, setLocalPassword = false }) {
  const inv = cloud.parseInvite(prefill);
  let mode = 'new';
  const linkInput = h('textarea', { rows: 3, placeholder: 'Wklej tutaj link zaproszenia', 'aria-label': 'Link zaproszenia' });
  linkInput.value = prefill || '';
  const linkLabel = h('label', { class: 'field field-full' }, h('span', { class: 'field-label' }, 'Link zaproszenia'), linkInput);
  const linkField = inv
    ? h('div', { class: 'invite-ok' }, icon('check', 18), h('span', null, `Zaproszenie do Momenty Agency${inv.name ? ` dla: ${inv.name}` : ''}`),
      h('button', { type: 'button', class: 'link-btn', onclick: (e) => { e.currentTarget.parentElement.replaceWith(linkLabel); } }, 'zmień'))
    : linkLabel;
  const seg = h('div', { class: 'seg' }, [['new', 'Nowe konto'], ['have', 'Mam już konto']].map(([k, l]) =>
    h('button', { type: 'button', class: `seg-btn ${k === mode ? 'on' : ''}`, onclick: (e) => {
      mode = k; seg.querySelectorAll('.seg-btn').forEach((b) => b.classList.remove('on')); e.currentTarget.classList.add('on'); draw();
    } }, l)));
  const holder = h('div');
  let form;
  const draw = () => {
    form = buildForm([
      { key: 'name', label: 'Twoje imię', required: true, full: true, default: cloud.parseInvite(linkInput.value)?.name || inv?.name || '' },
      { key: 'email', label: 'E-mail', type: 'email', required: true, full: true, autocomplete: 'username' },
      { key: 'pw', label: 'Hasło', type: 'password', required: true, full: true, autocomplete: mode === 'new' ? 'new-password' : 'current-password', hint: mode === 'new' ? 'Min. 8 znaków, litery i cyfra. Tym hasłem odblokujesz też aplikację.' : null },
      ...(mode === 'new' ? [{ key: 'pw2', label: 'Powtórz hasło', type: 'password', required: true, full: true, autocomplete: 'new-password' }] : []),
    ]);
    clear(holder).append(form.el);
  };
  draw();
  const err = h('p', { class: dark ? 'form-error' : 'form-error-dark', role: 'alert' });
  const btn = h('button', { class: `btn ${dark ? 'btn-cream' : 'btn-primary'} btn-block`, type: 'submit' }, 'Dołącz');
  const el = h('form', { class: dark ? 'brand-form' : 'join-form', onsubmit: async (e) => {
    e.preventDefault();
    err.textContent = '';
    const parsed = cloud.parseInvite(linkInput.value);
    if (!parsed) { err.textContent = 'To nie wygląda na prawidłowy link zaproszenia.'; return; }
    if (!form.validate()) return;
    const v = form.read();
    if (mode === 'new') {
      const p = auth.passwordProblem(v.pw);
      if (p) { err.textContent = p; return; }
      if (v.pw !== v.pw2) { err.textContent = 'Hasła nie są takie same.'; return; }
    }
    btn.disabled = true; btn.textContent = 'Dołączanie…';
    try {
      await cloud.saveConfig({ url: parsed.url, key: parsed.key });
      if (mode === 'new') await cloud.signUp(v.email, v.pw); else await cloud.signIn(v.email, v.pw);
      const st = await cloud.agencyStatus();
      if (!st.member) await cloud.join(parsed.code, v.name); else await cloud.linkExisting();
      if (setLocalPassword || !auth.isSetUp()) await auth.setPassword(v.pw);
      await db.loadRecords();
      await cloud.syncNow().catch(() => {});
      cloud.startAuto();
      onDone?.(st);
    } catch (e2) {
      err.textContent = e2.message;
    } finally { btn.disabled = false; btn.textContent = 'Dołącz'; }
  } },
  linkField, seg, holder, err, btn);
  return el;
}

// ======================================================================= Integrations
export function integrationsSection() {
  const linked = cloud.isLinked();
  const conns = cloud.connections();
  const box = h('div', { class: 'set-group' });
  const g = conns.google || {};
  const cv = conns.canva || {};
  if (!linked) {
    box.append(h('div', { class: 'set-text muted' }, 'Kalendarz Google, Canva i asystent AI działają po połączeniu z serwerem agencji (sekcja powyżej).'));
  } else {
    box.append(
      row('Kalendarz Google', g.connected ? `połączony · ${g.account || ''}` : 'niepołączony',
        () => (g.connected ? googleSheet(g) : connectProviderSheet('google')), 'calendar'),
      row('Canva', cv.connected ? `połączona · ${cv.account || ''}` : 'niepołączona',
        () => (cv.connected ? canvaSheet(cv) : connectProviderSheet('canva')), 'image'),
      row('Odśwież status połączeń', null, async () => { await cloud.refreshConnections(); rerender(); }, 'sync'));
    if (!conns.google && !conns.canva) cloud.refreshConnections().then(rerender).catch(() => {});
  }
  return section('Integracje', box);
}

const PROVIDER = {
  google: {
    title: 'Kalendarz Google',
    text: 'Każda osoba łączy swój własny Kalendarz Google. Twoje zadania (i wspólne „Obie osoby”) z datą pojawią się w Twoim kalendarzu z przypomnieniami dobranymi do rodzaju zadania. Na iPhonie powiadomienia pokaże aplikacja Kalendarz Google lub Kalendarz iOS (jeśli dodasz w nim konto Google).',
  },
  canva: {
    title: 'Canva',
    text: 'Po połączeniu możesz przeglądać swoje projekty z Canvy, importować je do projektów w aplikacji (PNG / PDF) i tworzyć nowe projekty, które otwierają się do edycji w Canvie.',
  },
};

export function connectProviderSheet(provider) {
  const p = PROVIDER[provider];
  const status = h('p', { class: 'muted' });
  const link = h('a', { class: 'btn btn-primary btn-block', target: '_blank', rel: 'noopener', href: '#', hidden: true }, 'Otwórz i zatwierdź dostęp');
  const ctl = new AbortController();
  const s = openSheet({
    title: `Połącz: ${p.title}`,
    body: [h('p', null, p.text), status, link,
      h('p', { class: 'hint-line' }, 'Otworzy się strona logowania. Po zatwierdzeniu wróć do aplikacji – połączenie zostanie wykryte automatycznie.')],
    onClose: () => ctl.abort(),
  });
  status.textContent = 'Przygotowywanie…';
  cloud.startConnect(provider).then((url) => {
    link.href = url; link.hidden = false; status.textContent = '';
    link.addEventListener('click', async () => {
      status.textContent = 'Czekam na zatwierdzenie…';
      const r = await cloud.waitConnected(provider, { signal: ctl.signal });
      if (r) {
        s.close(); toast(`${p.title}: połączono`);
        if (provider === 'google') cloud.calendarSync({ force: true }).then((x) => x && toast(`Kalendarz: ${x.created} nowych wydarzeń`)).catch((e) => toast(e.message));
        rerender();
      } else if (!ctl.signal.aborted) status.textContent = 'Nie wykryto połączenia. Spróbuj ponownie.';
    });
  }).catch((e) => { status.textContent = e.message; });
}

function googleSheet(g) {
  const s = openSheet({
    title: 'Kalendarz Google',
    body: [
      h('p', null, `Połączono z kontem ${g.account || 'Google'}. Zadania przypisane do Ciebie i do „Obie osoby” są wysyłane do kalendarza automatycznie po każdej zmianie.`),
      h('p', { class: 'small muted' }, 'Przypomnienia: termin/embargo – 2 dni, 1 dzień i 2 godz. przed; spotkanie – 1 godz. i 15 min przed; publikacja – dzień i godzinę przed; zadanie – dzień i godzinę przed. Ukończone zadania znikają z kalendarza.'),
      h('div', { class: 'sheet-actions' },
        h('button', { class: 'btn btn-soft', onclick: async () => {
          try { const r = await cloud.calendarSync({ force: true }); toast(`Wysłano: ${r.created} nowych, ${r.updated} zmienionych${r.errors?.length ? `, błędy: ${r.errors.length}` : ''}`); } catch (e) { toast(e.message); }
        } }, icon('sync', 18), 'Wyślij wszystko ponownie'),
        h('button', { class: 'btn btn-ghost danger-text', onclick: async () => {
          if (!(await confirmDialog('Odłączyć Kalendarz Google? Wydarzenia już utworzone zostaną w kalendarzu.', { ok: 'Odłącz', danger: true }))) return;
          await cloud.disconnectProvider('google'); s.close(); toast('Odłączono'); rerender();
        } }, 'Odłącz')),
    ],
  });
}

function canvaSheet(cv) {
  const s = openSheet({
    title: 'Canva',
    body: [
      h('p', null, `Połączono z kontem Canva${cv.account ? `: ${cv.account}` : ''}. Projekty z Canvy zaimportujesz w zakładce „Pliki” każdego projektu.`),
      h('button', { class: 'btn btn-ghost danger-text', onclick: async () => {
        if (!(await confirmDialog('Odłączyć Canvę?', { ok: 'Odłącz', danger: true }))) return;
        await cloud.disconnectProvider('canva'); s.close(); toast('Odłączono'); rerender();
      } }, 'Odłącz'),
    ],
  });
}

// ======================================================================= Agency details (for contracts & quotes)
export { AGENCY_ID, agencyProfile };

export function agencySection() {
  const a = agencyProfile();
  return section('Dane agencji (do umów i ofert)', h('div', { class: 'set-group' },
    row(a.legalName || 'Uzupełnij dane firmy', a.nip ? `NIP ${a.nip}` : 'potrzebne do umów', editAgency, 'building')));
}

export function editAgency() {
  const a = agencyProfile();
  const form = buildForm([
    { key: 'legalName', label: 'Pełna nazwa firmy', full: true, required: true, default: 'Momenty Agency' },
    { key: 'address', label: 'Adres siedziby', full: true, placeholder: 'ul. …, 00-000 Warszawa' },
    { key: 'nip', label: 'NIP', inputmode: 'numeric' },
    { key: 'regon', label: 'REGON / KRS' },
    { key: 'representative', label: 'Reprezentowana przez', full: true, placeholder: 'imię i nazwisko, funkcja' },
    { key: 'email', label: 'E-mail', type: 'email', default: 'office@momentyagency.com' },
    { key: 'phone', label: 'Telefon', type: 'tel' },
    { key: 'bank', label: 'Numer konta bankowego', full: true },
    { key: 'paymentDays', label: 'Domyślny termin płatności (dni)', type: 'number', default: 14 },
    { key: 'vat', label: 'Stawka VAT (%)', type: 'number', default: 23, hint: 'Ustaw 0, jeśli firma nie jest płatnikiem VAT.' },
  ], a);
  const s = openSheet({
    title: 'Dane agencji',
    body: form.el,
    footer: [h('button', { class: 'btn btn-ghost', onclick: () => s.close() }, 'Anuluj'),
      h('button', { class: 'btn btn-primary', onclick: async () => {
        if (!form.validate()) return;
        await db.put('meta', { id: AGENCY_ID, kind: 'agency', ...form.read() });
        s.close(); toast('Zapisano'); rerender();
      } }, 'Zapisz')],
  });
}

// ======================================================================= Install on iPhone (no App Store)
export function installSection() {
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  return section('Instalacja na telefonie', h('div', { class: 'set-group' },
    h('div', { class: 'set-text' },
      standalone ? h('p', null, '✓ Aplikacja jest zainstalowana na ekranie początkowym.') : null,
      h('p', null, h('strong', null, 'iPhone (bez App Store): '), 'otwórz adres aplikacji w Safari → przycisk Udostępnij (kwadrat ze strzałką) → „Do ekranu początk.” → Dodaj. Aplikacja otwiera się wtedy na pełnym ekranie, działa offline i odblokowuje się Face ID.'),
      h('p', null, h('strong', null, 'Mac / PC: '), 'w Chrome lub Edge kliknij ikonę instalacji w pasku adresu; w Safari na Macu: Plik → Dodaj do Docka.'),
      h('p', { class: 'small muted' }, 'Na iPhonie dyktowanie działa przez mikrofon na klawiaturze (w polu tekstowym stuknij ikonę 🎙).'))));
}
