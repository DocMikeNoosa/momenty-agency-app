// The in-app AI assistant: understands a spoken/typed instruction in Polish and carries it out
// with the app's own tools (tasks with calendar reminders, e-mail drafts, projects, contacts, search…).

import * as db from './db.js';
import * as M from './model.js';
import * as ai from './ai.js';
import * as cloud from './cloud.js';
import { todayStr, addDays, longDay } from './ui.js';
import { instagramLookup } from './instagram.js';
import { pricingOf, totals } from './pricing.js';
import { aiContract, templateContract } from './contracts.js';
import { agencyProfile } from './agency.js';

const TOOLS = [
  {
    name: 'create_task',
    description: 'Tworzy zadanie, przypomnienie, spotkanie, follow-up lub termin w aplikacji. Zadania z datą trafiają automatycznie do Kalendarza Google osoby przypisanej (z przypomnieniami), jeśli kalendarz jest połączony. Używaj do „przypomnij mi”, „zaplanuj”, „umów”, „dodaj do kalendarza”.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Krótki, konkretny tytuł po polsku' },
        due: { type: 'string', description: 'Data YYYY-MM-DD (oblicz z „jutro”, „w piątek” itp.)' },
        time: { type: 'string', description: 'Godzina HH:MM, jeśli podana' },
        owner: { type: 'string', description: 'Identyfikator osoby (np. p1, p2) albo "oba" dla obu osób. Domyślnie bieżący użytkownik.' },
        kind: { type: 'string', enum: ['zadanie', 'followup', 'spotkanie', 'wydarzenie', 'publikacja', 'termin'] },
        priority: { type: 'string', enum: ['normalny', 'wysoki', 'niski'] },
        project_id: { type: 'string' },
        contact_id: { type: 'string' },
        location: { type: 'string' },
        notes: { type: 'string' },
      },
      required: ['title'],
    },
  },
  {
    name: 'update_task',
    description: 'Zmienia istniejące zadanie (np. oznacza jako zrobione, przenosi termin, zmienia osobę).',
    input_schema: {
      type: 'object',
      properties: {
        task_id: { type: 'string' }, done: { type: 'boolean' }, due: { type: 'string' }, time: { type: 'string' },
        title: { type: 'string' }, owner: { type: 'string' },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'list_tasks',
    description: 'Zwraca zadania z zakresu dat (domyślnie zaległe + najbliższe 7 dni).',
    input_schema: {
      type: 'object',
      properties: { from: { type: 'string' }, to: { type: 'string' }, owner: { type: 'string' }, include_done: { type: 'boolean' } },
    },
  },
  {
    name: 'search',
    description: 'Szuka kontaktów (klienci, influencerzy, media, partnerzy), projektów, zadań i dokumentów po nazwie lub treści. Używaj, aby znaleźć identyfikatory przed innymi akcjami.',
    input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  },
  {
    name: 'draft_email',
    description: 'Przygotowuje kompletny, gotowy do wysłania e-mail lub pismo (zapisuje w Dokumentach; użytkownik wyśle je jednym stuknięciem). Pisz całość sam(a) na podstawie kontekstu projektu i kontaktu – profesjonalnie, po polsku, w imieniu Momenty Agency, z podpisem bieżącego użytkownika. Każda firma ma dostać oryginalnie sformułowany tekst (nie powtarzaj otwarć z listy „otwarcia_innych_listow”). Placeholdery [uzupełnij: …] tylko gdy brakuje faktów.',
    input_schema: {
      type: 'object',
      properties: {
        to_contact_id: { type: 'string' }, to_email: { type: 'string' },
        subject: { type: 'string' }, body: { type: 'string' }, project_id: { type: 'string' },
      },
      required: ['subject', 'body'],
    },
  },
  {
    name: 'create_project',
    description: 'Tworzy nowy projekt dla klienta.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' }, client_id: { type: 'string' },
        type: { type: 'string', enum: ['pr', 'influencer', 'event', 'content', 'strategia', 'specjalny'] },
        due: { type: 'string' }, budget: { type: 'string' }, description: { type: 'string' },
      },
      required: ['title'],
    },
  },
  {
    name: 'update_project',
    description: 'Zmienia projekt: etap, termin, budżet lub dopisuje notatkę do opisu.',
    input_schema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        stage: { type: 'string', enum: ['plan', 'przygotowanie', 'akceptacja', 'realizacja', 'raport', 'zakonczony'] },
        due: { type: 'string' }, budget: { type: 'string' }, note: { type: 'string' },
      },
      required: ['project_id'],
    },
  },
  {
    name: 'create_contact',
    description: 'Dodaje kontakt: klienta (firmę), influencera, dziennikarza (media) lub partnera/dostawcę. Nie wymyślaj danych, których użytkownik nie podał.',
    input_schema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['klient', 'influencer', 'media', 'partner'] },
        name: { type: 'string' }, email: { type: 'string' }, phone: { type: 'string' }, instagram: { type: 'string' },
        outlet: { type: 'string', description: 'Redakcja (dla mediów)' }, industry: { type: 'string' }, notes: { type: 'string' },
      },
      required: ['kind', 'name'],
    },
  },
  {
    name: 'propose_pricing',
    description: 'Otwiera zakładkę „Wycena i umowa” projektu i uruchamia propozycję wyceny AI (użytkownik ją sprawdzi i zatwierdzi). Używaj, gdy prosi o wycenę, cenę, budżet lub ofertę cenową.',
    input_schema: { type: 'object', properties: { project_id: { type: 'string' } }, required: ['project_id'] },
  },
  {
    name: 'create_contract',
    description: 'Przygotowuje projekt umowy dla projektu na podstawie danych projektu, wyceny, klienta i agencji; zapisuje go w Dokumentach.',
    input_schema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        type: { type: 'string', enum: ['uslugi', 'dzielo', 'ramowa'] },
        rights: { type: 'string', enum: ['przeniesienie', 'licencja', 'brak'] },
        extra: { type: 'string', description: 'Dodatkowe ustalenia podane przez użytkownika' },
      },
      required: ['project_id'],
    },
  },
  {
    name: 'prepare_mockup',
    description: 'Otwiera kreator makiety posta / relacji na Instagramie z gotowym opisem (napisz opis posta po polsku z hashtagami, pasujący do projektu i marki).',
    input_schema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' }, caption: { type: 'string' },
        format: { type: 'string', enum: ['square', 'portrait', 'story'] },
      },
      required: ['caption'],
    },
  },
  {
    name: 'instagram_lookup',
    description: 'Przygotowuje link do profilu na Instagramie (gdy znana nazwa konta) lub link do wyszukania osoby/marki na Instagramie.',
    input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  },
  {
    name: 'open_screen',
    description: 'Otwiera ekran aplikacji po zakończeniu (np. projekt, kontakt, listę zadań na dziś).',
    input_schema: {
      type: 'object',
      properties: {
        screen: { type: 'string', enum: ['dzis', 'projekty', 'kontakty', 'pliki', 'asystent', 'ustawienia', 'projekt', 'kontakt', 'dokument'] },
        id: { type: 'string' },
      },
      required: ['screen'],
    },
  },
];

const SYSTEM = `Jesteś asystentem w aplikacji agencji PR Momenty Agency (Warszawa) – „Tworzymy momenty, które budują marki”: strategia, content, produkcja, PR, influencer marketing, projekty specjalne.
Pomagasz dwóm wspólniczkom/wspólnikom prowadzić projekty, klientów, influencerów i media.

Zasady:
- Odpowiadaj zawsze po polsku, krótko i konkretnie.
- Wykonuj polecenia za pomocą narzędzi. Gdy brakuje identyfikatora klienta, projektu lub kontaktu, najpierw użyj „search”.
- Daty podawaj jako YYYY-MM-DD, licząc od dzisiejszej daty z kontekstu. „Rano” = 09:00, „po południu” = 15:00, „wieczorem” = 18:00.
- Domyślnie przypisuj zadania osobie, która wydaje polecenie. „My/obie/oboje/razem” = "oba".
- E-maile tylko przygotowujesz (draft_email) – nigdy nie twierdź, że zostały wysłane. Pisz jak doświadczona agencja PR: profesjonalnie, ciepło, konkretnie, bez sztampy.
- Nie wymyślaj adresów e-mail, telefonów ani faktów o osobach. Jeśli czegoś nie wiesz, zapytaj.
- Jeśli polecenie jest niejasne lub ryzykowne, dopytaj zamiast zgadywać.
- Jeśli w kontekście jest „biezacy_ekran” (projekt lub kontakt), polecenia typu „napisz maila”, „wycena”, „umowa”, „makieta” dotyczą właśnie jego – nie dopytuj, działaj.
- Pisma i e-maile piszesz od razu w całości, korzystając z briefu, przekazów marki, wyceny, zadań i historii – użytkownik ma tylko przeczytać i wysłać.
- Na koniec napisz jednym–dwoma zdaniami, co zrobiłeś(-aś).`;

function context() {
  const today = todayStr();
  const me = M.me();
  const tasks = db.all('tasks').filter((t) => !t.done && (!t.due || t.due <= addDays(today, 14))).sort(M.sortTasks).slice(0, 60);
  return {
    dzis: `${today} (${longDay(today)})`,
    uzytkownik: { id: me, imie: M.partnerName(me) },
    osoby: M.partners().map((p) => ({ id: p.id, imie: p.name })),
    kalendarz_google_polaczony: !!cloud.connections().google?.connected,
    klienci: db.all('contacts').filter((c) => c.kind === 'klient').slice(0, 80).map((c) => ({ id: c.id, nazwa: c.name })),
    projekty: db.all('projects').filter((p) => p.stage !== 'zakonczony').slice(0, 60).map((p) => ({ id: p.id, tytul: p.title, klient: db.get('contacts', p.clientId)?.name || null, etap: M.stageLabel(p.stage), termin: p.due || null })),
    zadania: tasks.map((t) => ({ id: t.id, tytul: t.title, data: t.due || null, godz: t.time || null, osoba: t.owner, rodzaj: t.kind })),
  };
}

function focusContext(focus) {
  if (!focus) return null;
  const opening = (d) => (d.body || '').split('\n').filter((l) => l.trim()).slice(1, 3).join(' ').slice(0, 200);
  if (focus.kind === 'project') {
    const p = db.get('projects', focus.id);
    if (!p) return null;
    const c = db.get('contacts', p.clientId);
    const pr = pricingOf(p);
    const t = totals(pr);
    return {
      rodzaj: 'projekt', id: p.id, tytul: p.title, etap: M.stageLabel(p.stage), typ: M.PROJECT_TYPES.find((x) => x[0] === p.type)?.[1],
      opis_i_brief: p.description || null, cel: p.goal || null, start: p.start || null, termin: p.due || null, budzet: p.budget || null,
      klient: c ? { id: c.id, nazwa: c.name, osoba: c.person || null, email: c.email || null, branza: c.industry || null, instagram: c.instagram || null, przekazy_marki: c.messages || null } : null,
      wycena: pr.items.length ? { pozycje: pr.items.map((i) => `${i.name}: ${i.qty} ${i.unit} × ${i.price} zł`), netto: Math.round(t.net), brutto: Math.round(t.gross) } : null,
      zadania: db.all('tasks').filter((x) => x.projectId === p.id).sort(M.sortTasks).slice(0, 30).map((x) => ({ id: x.id, tytul: x.title, data: x.due || null, zrobione: !!x.done })),
      influencerzy: (p.influencerIds || []).map((i) => db.get('contacts', i)).filter(Boolean).map((x) => ({ id: x.id, nazwa: x.name, instagram: x.instagram || null, obserwujacy: x.followers || null, stawki: x.rates || null, email: x.email || null })),
      dokumenty: db.all('docs').filter((d) => d.projectId === p.id).slice(0, 10).map((d) => d.title),
      otwarcia_innych_listow: db.all('docs').filter((d) => d.contactId && d.contactId !== p.clientId).slice(-6).map(opening),
    };
  }
  if (focus.kind === 'contact') {
    const c = db.get('contacts', focus.id);
    if (!c) return null;
    const { id, kind, name, email, phone, instagram, outlet, role, beat, niche, followers, rates, industry, person, messages, notes, preferences } = c;
    return {
      rodzaj: 'kontakt', id, typ: M.kindLabel(kind), nazwa: name, email, telefon: phone, instagram, redakcja: outlet, stanowisko: role,
      tematyka: beat || niche, obserwujacy: followers, stawki: rates, branza: industry, osoba: person, przekazy_marki: messages, notatki: notes, preferencje: preferences,
      projekty: db.all('projects').filter((p) => p.clientId === c.id || (p.influencerIds || []).includes(c.id)).map((p) => ({ id: p.id, tytul: p.title, etap: M.stageLabel(p.stage) })),
      ostatnie_pisma: db.all('docs').filter((d) => d.contactId === c.id).slice(-5).map((d) => d.title),
      otwarcia_innych_listow: db.all('docs').filter((d) => d.contactId && d.contactId !== c.id).slice(-6).map(opening),
    };
  }
  return null;
}

const ok = (o) => JSON.stringify({ ok: true, ...o });
const fail = (msg) => JSON.stringify({ ok: false, error: msg });
const validDate = (d) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : '');
const validTime = (t) => (t && /^\d{1,2}:\d{2}$/.test(t) ? t.padStart(5, '0') : '');
const ownerOf = (o) => {
  if (!o) return M.me();
  if (o === 'oba' || o === 'both') return 'oba';
  const p = M.partners().find((x) => x.id === o || x.name.toLowerCase() === String(o).toLowerCase());
  return p ? p.id : M.me();
};

/** Runs one tool call. Returns [resultString, action|null]. */
async function run(name, input) {
  switch (name) {
    case 'create_task': {
      if (!input.title) return [fail('Brak tytułu')];
      const t = await db.put('tasks', {
        title: input.title.trim(), due: validDate(input.due), time: validTime(input.time), owner: ownerOf(input.owner),
        kind: input.kind || 'zadanie', priority: input.priority || 'normalny', done: false,
        projectId: db.get('projects', input.project_id) ? input.project_id : '',
        contactId: db.get('contacts', input.contact_id) ? input.contact_id : '',
        location: input.location || '', notes: input.notes || '',
      });
      db.logActivity(`dodał(a) zadanie (AI): ${t.title}`, { col: 'tasks', id: t.id });
      return [ok({ task_id: t.id, reminders: t.due ? M.reminderText(t) : null }),
        { icon: M.taskKindIcon(t.kind), label: `Zadanie: ${t.title}${t.due ? ` · ${t.due}${t.time ? ` ${t.time}` : ''}` : ''}`, col: 'tasks', id: t.id }];
    }
    case 'update_task': {
      const t = db.get('tasks', input.task_id);
      if (!t) return [fail('Nie znaleziono zadania')];
      const patch = { id: t.id };
      if (typeof input.done === 'boolean') { patch.done = input.done; patch.doneAt = input.done ? new Date().toISOString() : null; }
      if (input.due) patch.due = validDate(input.due);
      if (input.time !== undefined) patch.time = validTime(input.time);
      if (input.title) patch.title = input.title;
      if (input.owner) patch.owner = ownerOf(input.owner);
      const prev = { ...t };
      await db.put('tasks', patch);
      return [ok({}), { icon: 'check', label: `Zmieniono: ${t.title}`, col: 'tasks', id: t.id, undo: () => db.put('tasks', prev) }];
    }
    case 'list_tasks': {
      const from = validDate(input.from) || '0000';
      const to = validDate(input.to) || addDays(todayStr(), 7);
      const list = db.all('tasks').filter((t) => (input.include_done || !t.done) && t.due && t.due >= from && t.due <= to && (!input.owner || t.owner === ownerOf(input.owner) || t.owner === 'oba'))
        .sort(M.sortTasks).slice(0, 80).map((t) => ({ id: t.id, tytul: t.title, data: t.due, godz: t.time || null, osoba: M.ownerLabel(t.owner), zrobione: !!t.done, projekt: db.get('projects', t.projectId)?.title || null }));
      return [JSON.stringify({ ok: true, zadania: list })];
    }
    case 'search': {
      const q = String(input.query || '').toLowerCase();
      const has = (o, keys) => keys.some((k) => String(o[k] || '').toLowerCase().includes(q));
      return [JSON.stringify({
        ok: true,
        kontakty: db.all('contacts').filter((c) => has(c, ['name', 'instagram', 'outlet', 'industry', 'person', 'email', 'niche'])).slice(0, 10)
          .map((c) => ({ id: c.id, nazwa: c.name, rodzaj: c.kind, email: c.email || null, instagram: c.instagram || null, redakcja: c.outlet || null })),
        projekty: db.all('projects').filter((p) => has(p, ['title', 'description'])).slice(0, 10).map((p) => ({ id: p.id, tytul: p.title, klient: db.get('contacts', p.clientId)?.name || null })),
        zadania: db.all('tasks').filter((t) => has(t, ['title', 'notes'])).slice(0, 10).map((t) => ({ id: t.id, tytul: t.title, data: t.due || null, zrobione: !!t.done })),
        dokumenty: db.all('docs').filter((d) => has(d, ['title'])).slice(0, 5).map((d) => ({ id: d.id, tytul: d.title })),
      })];
    }
    case 'draft_email': {
      const c = db.get('contacts', input.to_contact_id);
      const to = input.to_email || c?.email || '';
      const d = await db.put('docs', {
        title: input.subject, body: input.body, kind: 'email', to,
        contactId: c?.id || '', projectId: db.get('projects', input.project_id) ? input.project_id : '',
      });
      db.logActivity(`przygotował(a) e-mail (AI): ${d.title}`, { col: 'docs', id: d.id });
      return [ok({ doc_id: d.id, to: to || null }), { icon: 'mail', label: `E-mail: ${d.title}${to ? ` → ${to}` : ''}`, col: 'docs', id: d.id, email: { to, subject: d.title, body: d.body } }];
    }
    case 'create_project': {
      const p = await db.put('projects', {
        title: input.title, clientId: db.get('contacts', input.client_id) ? input.client_id : '', type: input.type || 'pr',
        stage: 'plan', owner: M.me(), start: todayStr(), due: validDate(input.due), budget: input.budget || '',
        description: input.description || '', influencerIds: [],
      });
      db.logActivity(`utworzył(a) projekt (AI): ${p.title}`, { col: 'projects', id: p.id });
      return [ok({ project_id: p.id }), { icon: 'projects', label: `Projekt: ${p.title}`, col: 'projects', id: p.id }];
    }
    case 'update_project': {
      const p = db.get('projects', input.project_id);
      if (!p) return [fail('Nie znaleziono projektu')];
      const prev = { ...p };
      const patch = { id: p.id };
      if (input.stage) patch.stage = input.stage;
      if (input.due) patch.due = validDate(input.due);
      if (input.budget) patch.budget = input.budget;
      if (input.note) patch.description = `${p.description ? `${p.description}\n\n` : ''}${todayStr()}: ${input.note}`;
      await db.put('projects', patch);
      return [ok({}), { icon: 'projects', label: `Zmieniono projekt: ${p.title}`, col: 'projects', id: p.id, undo: () => db.put('projects', prev) }];
    }
    case 'create_contact': {
      if (!['klient', 'influencer', 'media', 'partner'].includes(input.kind)) return [fail('Zły rodzaj kontaktu')];
      const c = await db.put('contacts', {
        kind: input.kind, name: input.name, email: input.email || '', phone: input.phone || '',
        instagram: input.instagram ? M.handle(input.instagram) : '', outlet: input.outlet || '', industry: input.industry || '', notes: input.notes || '',
        ...(input.kind === 'klient' ? { status: 'aktywny', health: 'dobra', lead: M.me() } : {}),
      });
      db.logActivity(`dodał(a) kontakt (AI): ${c.name}`, { col: 'contacts', id: c.id });
      return [ok({ contact_id: c.id }), { icon: M.kindIcon(c.kind), label: `Kontakt: ${c.name}`, col: 'contacts', id: c.id }];
    }
    case 'propose_pricing': {
      const p = db.get('projects', input.project_id);
      if (!p) return [fail('Nie znaleziono projektu')];
      return [ok({ info: 'Propozycja wyceny jest przygotowywana na ekranie projektu.' }), { navigate: `projekt/${p.id}?tab=pieniadze&ai=1` }];
    }
    case 'create_contract': {
      const p = db.get('projects', input.project_id);
      if (!p) return [fail('Nie znaleziono projektu')];
      const opts = { type: input.type || 'uslugi', rights: input.rights || 'przeniesienie', payDays: agencyProfile().paymentDays || 14, confidential: 'tak', penalties: 'nie', place: 'Warszawa', extra: input.extra || '' };
      let body;
      try { body = await aiContract(p, opts); } catch { body = templateContract(p, opts); }
      const d = await db.put('docs', { title: `Umowa – ${p.title}`, body, kind: 'contract', projectId: p.id, contactId: p.clientId || '' });
      db.logActivity(`przygotował(a) umowę (AI): ${p.title}`, { col: 'docs', id: d.id });
      return [ok({ doc_id: d.id }), { icon: 'file', label: `Umowa: ${p.title} (projekt do sprawdzenia)`, col: 'docs', id: d.id }];
    }
    case 'prepare_mockup': {
      const q = new URLSearchParams({ caption: input.caption || '', format: input.format || 'portrait' });
      if (db.get('projects', input.project_id)) q.set('projekt', input.project_id);
      return [ok({}), { navigate: `asystent/makieta?${q}` }];
    }
    case 'instagram_lookup': {
      const r = instagramLookup(input.query);
      return [ok(r), { icon: 'instagram', label: r.handle ? `Instagram: ${r.handle}` : `Szukaj na Instagramie: ${input.query}`, href: r.profileUrl || r.searchUrl }];
    }
    case 'open_screen': {
      const map = { projekt: 'projekt', kontakt: 'kontakt', dokument: 'dokument' };
      const path = map[input.screen] ? (input.id ? `${map[input.screen]}/${input.id}` : null) : input.screen;
      return [ok({}), path ? { navigate: path } : null];
    }
    default:
      return [fail(`Nieznane narzędzie ${name}`)];
  }
}

export const LABEL_PATH = { tasks: null, projects: 'projekt', contacts: 'kontakt', docs: 'dokument' };

/**
 * Conversation with the assistant. Keeps history so follow-up questions work.
 * send(text) → { text, actions[] }
 */
export function createConversation({ focus = null } = {}) {
  const messages = [];
  let first = true;
  async function send(text, { onStep } = {}) {
    const ctx = { ...context(), biezacy_ekran: focusContext(focus) };
    const content = first
      ? `Kontekst aplikacji (JSON):\n${JSON.stringify(ctx)}\n\nPolecenie użytkownika:\n${text}`
      : text;
    first = false;
    messages.push({ role: 'user', content });
    const actions = [];
    for (let turn = 0; turn < 8; turn++) {
      const res = await ai.ask({ system: SYSTEM, messages, tools: TOOLS, max_tokens: 8000, effort: 'medium' });
      messages.push({ role: 'assistant', content: res.content });
      if (res.stop_reason !== 'tool_use') return { text: ai.textOf(res), actions };
      const results = [];
      for (const block of res.content.filter((b) => b.type === 'tool_use')) {
        onStep?.(block.name);
        let out;
        try {
          const [r, action] = await run(block.name, block.input || {});
          out = r;
          if (action) actions.push(action);
        } catch (e) { out = fail(e.message); }
        results.push({ type: 'tool_result', tool_use_id: block.id, content: out });
      }
      messages.push({ role: 'user', content: results });
    }
    return { text: 'Przerwałem po kilku krokach – sprawdź, co zostało zrobione, i doprecyzuj polecenie.', actions };
  }
  return { send, reset: () => { messages.length = 0; first = true; } };
}

export const TOOL_LABELS = {
  create_task: 'Dodaję zadanie…', update_task: 'Zmieniam zadanie…', list_tasks: 'Sprawdzam zadania…', search: 'Szukam…',
  draft_email: 'Piszę e-mail…', create_project: 'Tworzę projekt…', update_project: 'Aktualizuję projekt…',
  create_contact: 'Dodaję kontakt…', instagram_lookup: 'Szukam na Instagramie…', open_screen: 'Otwieram…',
  propose_pricing: 'Przygotowuję wycenę…', create_contract: 'Piszę umowę…', prepare_mockup: 'Przygotowuję makietę…',
};
