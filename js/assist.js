// The ✦ button: one place to ask the AI or add anything, available on every screen.
// It knows what is on screen (a project or a contact) and offers one-tap actions for it.

import * as db from './db.js';
import * as M from './model.js';
import * as ai from './ai.js';
import { createConversation, TOOL_LABELS, LABEL_PATH } from './agent.js';
import { h, icon, openSheet, toast, clear, relDay, todayStr } from './ui.js';
import { navigate, current } from './router.js';
import { editTask, editProject, editContact, uploadFlow } from './components.js';

const sessions = new Map(); // focus key → { convo, transcript }

/** What is on screen right now, so the assistant can act on it without asking. */
export function currentFocus() {
  const r = current();
  if (r.name === 'projekt' && db.get('projects', r.params[0])) return { kind: 'project', id: r.params[0] };
  if (r.name === 'kontakt' && db.get('contacts', r.params[0])) return { kind: 'contact', id: r.params[0] };
  return null;
}

/** One-tap suggestions for the current screen. */
export function suggestionsFor(focus) {
  if (focus?.kind === 'project') {
    return [
      ['mail', 'E-mail do klienta: postęp', 'Napisz e-mail do klienta z aktualnym statusem tego projektu: co zrobiliśmy, co dalej i czego potrzebujemy od klienta.'],
      ['money', 'Zaproponuj wycenę', 'Zaproponuj wycenę tego projektu.'],
      ['file', 'Przygotuj umowę', 'Przygotuj umowę dla tego projektu.'],
      ['instagram', 'Makieta posta na Instagram', 'Przygotuj makietę posta na Instagram dla tego projektu z dobrym opisem i hashtagami.'],
      ['calendar', 'Zaplanuj kolejne kroki', 'Zaplanuj kolejne kroki tego projektu jako zadania z datami (realistycznie do terminu projektu).'],
      ['megaphone', 'Informacja prasowa', 'Napisz informację prasową o tym projekcie.'],
    ];
  }
  if (focus?.kind === 'contact') {
    const c = db.get('contacts', focus.id);
    const byKind = {
      klient: [
        ['mail', 'Follow-up do klienta', 'Napisz follow-up do tego klienta nawiązujący do naszych projektów.'],
        ['doc', 'Propozycja współpracy', 'Napisz propozycję kolejnej współpracy dla tego klienta.'],
        ['projects', 'Nowy projekt dla klienta', 'Utwórz nowy projekt dla tego klienta – zapytaj mnie krótko o nazwę, jeśli jej nie podam.'],
      ],
      influencer: [
        ['doc', 'Brief współpracy', 'Napisz brief współpracy dla tego influencera do naszego aktualnego projektu.'],
        ['mail', 'Zapytanie o stawki i terminy', 'Napisz do tego influencera zapytanie o stawki i dostępność.'],
        ['instagram', 'Pokaż profil na Instagramie', 'Znajdź tę osobę na Instagramie.'],
      ],
      media: [
        ['megaphone', 'Pitch tematu', 'Napisz pitch tematu do tej osoby na podstawie naszego najbliższego projektu.'],
        ['mail', 'Zaproszenie na wydarzenie', 'Napisz zaproszenie na nasze najbliższe wydarzenie do tej osoby.'],
        ['calendar', 'Przypomnij o follow-upie', 'Dodaj mi przypomnienie o follow-upie do tej osoby za 3 dni o 10:00.'],
      ],
      partner: [
        ['mail', 'Zapytanie ofertowe', 'Napisz zapytanie ofertowe do tego partnera.'],
        ['calendar', 'Umów spotkanie', 'Zaplanuj spotkanie z tym partnerem w przyszłym tygodniu.'],
      ],
    };
    return byKind[c?.kind] || [];
  }
  return [
    ['today', 'Co mam dziś do zrobienia?', 'Co mam dziś do zrobienia? Wypisz krótko i podpowiedz, od czego zacząć.'],
    ['calendar', 'Zaplanuj spotkanie', 'Zaplanuj spotkanie '],
    ['mail', 'Napisz e-mail', 'Napisz e-mail do '],
    ['projects', 'Nowy projekt', 'Utwórz nowy projekt '],
  ];
}

function sessionFor(focus) {
  const key = focus ? `${focus.kind}:${focus.id}` : 'global';
  if (!sessions.has(key)) sessions.set(key, { convo: null, transcript: [], busy: null, focus });
  return sessions.get(key);
}

function actionView(a, close) {
  const path = a.col && LABEL_PATH[a.col] ? `${LABEL_PATH[a.col]}/${a.id}` : null;
  const btns = [];
  if (a.email) {
    const q = (o) => Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    btns.push(h('a', { class: 'btn btn-primary', href: `mailto:${a.email.to || ''}?${q({ subject: a.email.subject, body: a.email.body })}` }, 'Wyślij'));
    btns.push(h('a', { class: 'btn btn-soft', href: `https://mail.google.com/mail/?view=cm&fs=1&${q({ to: a.email.to || '', su: a.email.subject, body: a.email.body })}`, target: '_blank', rel: 'noopener' }, 'Gmail'));
  }
  if (a.col === 'tasks') {
    const t = db.get('tasks', a.id);
    if (t) btns.push(h('button', { class: 'btn btn-soft', onclick: () => editTask(t) }, 'Otwórz'));
  } else if (path) btns.push(h('button', { class: 'btn btn-soft', onclick: () => { close?.(); navigate(path); } }, a.col === 'docs' ? 'Czytaj i edytuj' : 'Otwórz'));
  if (a.href) btns.push(h('a', { class: 'btn btn-soft', href: a.href, target: '_blank', rel: 'noopener' }, 'Otwórz'));
  if (a.undo) btns.push(h('button', { class: 'btn btn-ghost', onclick: async () => { await a.undo(); toast('Cofnięto'); } }, 'Cofnij'));
  else if (a.col && a.id && db.get(a.col, a.id) && a.col !== 'docs') {
    btns.push(h('button', { class: 'btn btn-ghost', onclick: async () => { await db.remove(a.col, a.id); toast('Usunięto'); } }, 'Cofnij'));
  }
  return h('div', { class: 'act' }, icon(a.icon || 'check', 18), h('span', null, a.label), h('span', { class: 'act-btns' }, btns));
}

/**
 * The assistant panel (used in the ✦ sheet and on the full Asystent page).
 * Returns { el, send } – `send(text)` runs a command as if typed.
 */
export function assistantPanel({ focus = null, onNavigate, onClose } = {}) {
  const sess = sessionFor(focus);
  const el = h('div', { class: 'agent' });
  const aiOn = ai.available();
  const ta = h('textarea', {
    placeholder: aiOn ? 'Powiedz lub napisz, co zrobić…' : 'np. Zadzwonić do Magazynu Styl jutro o 15',
    'aria-label': aiOn ? 'Polecenie dla asystenta' : 'Nowe zadanie', rows: 2, id: 'agent-input', enterkeyhint: 'send',
  });
  const preview = h('div', { class: 'qa-preview' });
  ta.addEventListener('input', () => {
    clear(preview);
    if (aiOn) return;
    const p = M.parseQuick(ta.value);
    if (p.due) preview.append(h('span', { class: 'chip' }, icon('calendar', 14), relDay(p.due), p.time ? ` · ${p.time}` : ''));
  });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && matchMedia('(pointer: fine)').matches) { e.preventDefault(); primary(); }
  });

  async function quickTask(text) {
    const p = M.parseQuick(text);
    if (!p.title) { ta.focus(); toast('Wpisz treść zadania.'); return; }
    const t = await db.put('tasks', { title: p.title, due: p.due || todayStr(), time: p.time || '', owner: M.me(), kind: 'zadanie', priority: 'normalny', done: false,
      ...(focus?.kind === 'project' ? { projectId: focus.id, contactId: db.get('projects', focus.id)?.clientId || '' } : {}),
      ...(focus?.kind === 'contact' ? { contactId: focus.id } : {}) });
    db.logActivity(`dodał(a) zadanie: ${t.title}`, { col: 'tasks', id: t.id });
    ta.value = ''; clear(preview);
    toast(`Dodano zadanie: ${relDay(t.due).toLowerCase()}${t.time ? ` ${t.time}` : ''}`);
  }

  async function send(text) {
    text = String(text || '').trim();
    if (!text || sess.busy) return;
    if (!aiOn) { await quickTask(text); return; }
    sess.convo = sess.convo || createConversation({ focus });
    sess.transcript.push({ role: 'user', text });
    sess.busy = 'Myślę…';
    ta.value = '';
    draw();
    try {
      const r = await sess.convo.send(text, { onStep: (name) => { sess.busy = TOOL_LABELS[name] || 'Pracuję…'; const b = sess.el.querySelector('.thinking span:last-child'); if (b) b.textContent = sess.busy; } });
      sess.transcript.push({ role: 'ai', text: r.text, actions: r.actions });
      sess.busy = null;
      const nav = r.actions.find((a) => a.navigate);
      if (nav) { onNavigate?.(); navigate(nav.navigate); return; }
    } catch (e) {
      sess.transcript.push({ role: 'ai', text: e.message, actions: [] });
    }
    sess.busy = null;
    // the page may have been redrawn meanwhile (e.g. a new task) – update the panel that is on screen now
    sess.draw();
  }
  const primary = () => send(ta.value);

  let stop = null;
  const mic = ai.canDictate() ? h('button', { class: 'mic', type: 'button', 'aria-label': 'Dyktuj', onclick: () => {
    if (stop) { stop(); return; }
    mic.classList.add('rec');
    const base = ta.value ? `${ta.value} ` : '';
    stop = ai.dictate({ onText: (t) => { ta.value = base + t; }, onEnd: () => { mic.classList.remove('rec'); stop = null; } });
  } }, icon('mic', 22)) : null;

  function draw() {
    clear(el);
    for (const m of sess.transcript) {
      el.append(m.role === 'user'
        ? h('div', { class: 'msg msg-user' }, m.text)
        : h('div', { class: 'msg msg-ai' }, m.text || 'Gotowe.', m.actions?.length ? h('div', { class: 'actions' }, m.actions.filter((a) => !a.navigate).map((a) => actionView(a, onClose))) : null));
    }
    if (sess.busy) el.append(h('div', { class: 'msg msg-ai thinking' }, h('span', { class: 'spinner' }), h('span', null, sess.busy)));
    el.append(h('div', { class: 'agent-box', dataset: { keep: '1' } }, ta, preview,
      h('div', { class: 'agent-bar' },
        mic || h('span', { class: 'small muted dictate-hint' }, '🎙 dyktuj klawiaturą'),
        sess.transcript.length ? h('button', { class: 'btn btn-ghost btn-sm', onclick: () => { sess.transcript.length = 0; sess.convo = null; draw(); } }, 'Nowa rozmowa') : null,
        aiOn ? h('button', { class: 'btn btn-ghost btn-sm', title: 'Dodaj jako zadanie bez AI', onclick: () => quickTask(ta.value) }, 'Tylko zadanie') : null,
        h('button', { class: 'btn btn-primary', disabled: !!sess.busy, onclick: primary }, aiOn ? 'Wykonaj' : 'Dodaj zadanie'))));
    if (!aiOn) el.append(h('p', { class: 'hint-line' }, 'Rozpoznaję daty: dziś, jutro, w piątek, 12.10, o 15. Asystent AI zacznie działać po połączeniu z serwerem agencji (Więcej → Ustawienia).'));
    if (aiOn && !sess.transcript.length) {
      el.append(h('div', { class: 'chips' }, suggestionsFor(focus).map(([ic, label, prompt]) => h('button', {
        class: 'chip-btn', onclick: () => {
          if (prompt.endsWith(' ')) { ta.value = prompt; ta.focus(); return; } // needs a few more words
          send(prompt);
        },
      }, icon(ic, 16), label))));
    }
  }
  sess.el = el; sess.draw = draw; // the newest panel for this session is the one on screen
  draw();
  return { el, send, focusInput: () => ta.focus({ preventScroll: true }) };
}

/** Opens the ✦ sheet. `prompt` runs immediately (e.g. from a one-tap action on a project). */
export function openAssist({ prompt } = {}) {
  const focus = currentFocus();
  const fp = focus?.kind === 'project' ? db.get('projects', focus.id) : null;
  const fc = focus?.kind === 'contact' ? db.get('contacts', focus.id) : null;
  let s;
  const panel = assistantPanel({ focus, onNavigate: () => s?.close(), onClose: () => s?.close() });
  const tile = (ic, label, fn) => h('button', { class: 'shortcut', onclick: () => { s.close(); fn(); } }, h('span', { class: 'sc-ic' }, icon(ic, 22)), h('span', null, label));
  const links = fp ? { projectId: fp.id, clientId: fp.clientId || '' } : fc ? { clientId: fc.id } : {};
  s = openSheet({
    title: 'Asystent',
    className: 'sheet-assist',
    body: [
      fp || fc ? h('div', { class: 'focus-chip' }, icon(fp ? 'projects' : M.kindIcon(fc.kind), 15), fp ? `Projekt: ${fp.title}` : `${M.kindLabel(fc.kind)}: ${fc.name}`) : null,
      panel.el,
      h('div', { class: 'letter' }, 'Dodaj'),
      h('div', { class: 'shortcuts' },
        tile('check', 'Zadanie', () => editTask(null, fp ? { projectId: fp.id, contactId: fp.clientId || '' } : fc ? { contactId: fc.id } : {})),
        tile('projects', 'Projekt', () => editProject(null, fc?.kind === 'klient' ? { clientId: fc.id } : {})),
        tile('contacts', 'Kontakt', () => editContact(null, db.kvGet('contactKind', 'klient'))),
        tile('camera', 'Zdjęcie', () => uploadFlow({ camera: true, links })),
        tile('doc', 'Pismo', () => navigate(`asystent/pismo${fp ? `?projekt=${fp.id}` : fc ? `?kontakt=${fc.id}` : ''}`)),
        tile('instagram', 'Makieta', () => navigate(`asystent/makieta${fp ? `?projekt=${fp.id}` : ''}`))),
    ],
  });
  if (prompt) panel.send(prompt); else panel.focusInput();
  return s;
}
