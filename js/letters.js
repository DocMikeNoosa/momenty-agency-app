// Letter templates (Polish). Written in the agency "we" voice so they read correctly for any sender.

import * as db from './db.js';
import * as M from './model.js';
import { fullDate, todayStr } from './ui.js';
import * as ai from './ai.js';

// Wording variants: every recipient gets a stable, different combination, so letters sent to
// different companies do not read the same.
const pick = (seed, salt, arr) => arr[ai.hash(`${seed}|${salt}`) % arr.length];

export const TEMPLATES = [
  { id: 'pitch', label: 'Propozycja tematu dla mediów', hint: 'Pitch do dziennikarza', to: ['media'] },
  { id: 'press', label: 'Informacja prasowa', hint: 'Gotowa struktura komunikatu', to: ['media'] },
  { id: 'followup', label: 'Follow-up', hint: 'Przypomnienie po wysłanej wiadomości', to: null },
  { id: 'brief', label: 'Brief dla influencera', hint: 'Zakres, terminy, przekazy', to: ['influencer'] },
  { id: 'invite', label: 'Zaproszenie na wydarzenie', hint: 'Dla mediów i influencerów', to: ['media', 'influencer', 'partner'] },
  { id: 'thanks', label: 'Podziękowanie za współpracę', hint: 'Po publikacji lub wydarzeniu', to: null },
  { id: 'offer', label: 'Oferta współpracy', hint: 'Dla nowego klienta', to: ['klient'] },
  { id: 'status', label: 'Podsumowanie dla klienta', hint: 'Postęp projektu na podstawie zadań', to: ['klient'] },
];

const firstName = (n = '') => n.trim().split(/\s+/)[0] || '';

function greeting(c, tone, seed) {
  if (tone === 'swobodny' && c?.name && c.kind !== 'klient') return `${pick(seed, 'hi', ['Cześć', 'Dzień dobry', 'Hej'])} ${firstName(c.name)},`;
  return pick(seed, 'hello', ['Dzień dobry,', 'Szanowni Państwo,', 'Dzień dobry,']);
}

function signature(tone, seed) {
  const me = M.partnerName(M.me());
  const close = tone === 'swobodny'
    ? pick(seed, 'close', ['Pozdrawiamy serdecznie', 'Ściskamy i pozdrawiamy', 'Do usłyszenia', 'Serdeczności'])
    : pick(seed, 'close', ['Z wyrazami szacunku', 'Z poważaniem', 'Łączymy wyrazy szacunku', 'Z serdecznymi pozdrowieniami']);
  return `${close},\n${me}\nMomenty Agency\noffice@momentyagency.com · www.momentyagency.com`;
}

const bullets = (text) => (text || '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => (/^[-•–]/.test(l) ? l.replace(/^[-–]\s*/, '• ') : `• ${l}`)).join('\n');

export function generate(v) {
  const c = db.get('contacts', v.contactId);
  const project = db.get('projects', v.projectId);
  const client = db.get('contacts', v.clientId) || (project && db.get('contacts', project.clientId));
  const brand = client?.name || '[nazwa marki]';
  const topic = v.topic || project?.title || '[temat]';
  const when = v.date ? fullDate(v.date) : '';
  const tone = v.tone || 'formalny';
  const seed = v.contactId || v.clientId || topic;
  const g = greeting(c, tone, seed);
  const details = (v.details || '').trim();
  const sig = signature(tone, seed);
  const P = (salt, arr) => pick(seed, `${v.tpl}|${salt}`, arr);

  switch (v.tpl) {
    case 'pitch': return {
      subject: `Propozycja tematu: ${topic}`,
      body: `${g}

${P('open', [
  `piszemy z Momenty Agency – reprezentujemy markę ${brand}. Chcielibyśmy zaproponować temat, który może zainteresować ${c?.outlet ? `czytelników ${c.outlet}` : 'Państwa odbiorców'}: ${topic}.`,
  `w imieniu marki ${brand} zgłaszamy się z tematem, który – naszym zdaniem – dobrze wpisuje się w profil ${c?.outlet || 'Państwa redakcji'}: ${topic}.`,
  `śledzimy ${c?.outlet ? `publikacje ${c.outlet}` : 'Państwa publikacje'} i mamy temat, który może się w nie wpisać: ${topic}. Opiekujemy się komunikacją marki ${brand}.`,
  `jako agencja odpowiedzialna za komunikację ${brand} chcielibyśmy podzielić się z ${c?.outlet ? c.outlet : 'Państwem'} tematem: ${topic}.`,
])}

${details || '[2–3 zdania: co jest nowego, dlaczego teraz i dlaczego to ciekawe dla odbiorców]'}

${P('offer', [
  `Możemy przygotować dodatkowe materiały: komentarz eksperta, zdjęcia w wysokiej rozdzielczości${client ? ` lub próbki produktów ${brand}` : ''}.`,
  `Na życzenie udostępnimy zdjęcia, dane do artykułu${client ? `, produkty ${brand} do testów` : ''} oraz rozmowę z ekspertem.`,
  `Do dyspozycji mamy materiały wizualne, komentarz eksperta${client ? ` i próbki ${brand}` : ''} – wszystko w formie gotowej do publikacji.`,
])}${when ? ` ${P('when', [`Zależy nam na publikacji do ${when}.`, `Optymalny termin publikacji to ${when}.`, `Temat będzie najbardziej aktualny do ${when}.`])}` : ''}

${P('cta', [
  'Czy temat wydaje się interesujący? Chętnie umówimy krótką rozmowę lub prześlemy więcej informacji.',
  'Będzie nam miło, jeśli temat Państwa zainteresuje – odpowiemy na wszystkie pytania.',
  'Jeśli to dobry kierunek, prześlemy komplet materiałów jeszcze dziś.',
  'Prosimy o krótką informację, czy temat pasuje – dopasujemy materiały do formatu redakcji.',
])}

${sig}`,
    };
    case 'press': return {
      subject: `Informacja prasowa: ${topic}`,
      body: `INFORMACJA PRASOWA
${v.place || 'Warszawa'}, ${fullDate(v.date || todayStr())}

${topic.toUpperCase()}

${details || '[Lead: najważniejsza informacja w 2–3 zdaniach – kto, co, kiedy, gdzie i dlaczego.]'}

[Rozwinięcie: szczegóły, liczby, kontekst rynkowy.]

„[Cytat przedstawiciela marki ${brand}]” – mówi [imię i nazwisko, stanowisko].

O marce ${brand}
${client?.messages || '[Krótki opis marki – 3–4 zdania.]'}

Kontakt dla mediów:
${M.partnerName(M.me())}, Momenty Agency
office@momentyagency.com`,
    };
    case 'followup': return {
      subject: `Re: ${topic}`,
      body: `${g}

${tone === 'swobodny'
    ? P('fu', ['odzywamy się', 'wracamy z krótkim pytaniem', 'chcieliśmy jeszcze wrócić'])
    : P('fu', ['uprzejmie przypominamy się', 'pozwalamy sobie wrócić', 'wracamy do korespondencji'])} w sprawie naszej wiadomości dotyczącej: ${topic}.${details ? `\n\n${details}` : ''}

${P('ask', ['Czy mieli Państwo okazję się z nią zapoznać?', 'Czy temat jest wciąż aktualny po Państwa stronie?', 'Ciekawi nas, czy temat może się sprawdzić.'])} ${P('more', ['Jeśli temat jest interesujący, chętnie prześlemy dodatkowe materiały', 'W razie zainteresowania przygotujemy pakiet materiałów', 'Możemy od ręki przesłać zdjęcia i komentarz eksperta'])}${when ? ` – najlepiej do ${when}` : ''}.

${sig}`,
    };
    case 'brief': return {
      subject: `Brief: ${topic} × ${brand}`,
      body: `${g}

dziękujemy za chęć współpracy przy kampanii ${brand}! Poniżej przesyłamy brief.

KAMPANIA
${topic}

ZAKRES
${bullets(details) || '• [np. 1 post w feedzie + 3 relacje]'}

TERMINY
• Przesłanie materiałów do akceptacji: ${when || '[data]'}
• Publikacja: [data]

KLUCZOWE PRZEKAZY
${bullets(client?.messages) || '• [przekaz 1]\n• [przekaz 2]'}

OZNACZENIA
• Oznaczenie współpracy zgodnie z rekomendacjami UOKiK (np. „reklama” / „materiał reklamowy”)
• Oznaczenie konta marki${client?.instagram ? `: ${M.handle(client.instagram)}` : ''}
• Oznaczenie @momentyagency

Prosimy o przesłanie materiałów do akceptacji przed publikacją, a po publikacji – o link oraz statystyki po 7 dniach.

${sig}`,
    };
    case 'invite': return {
      subject: `Zaproszenie: ${topic}`,
      body: `${g}

w imieniu marki ${brand} oraz Momenty Agency mamy przyjemność zaprosić ${tone === 'swobodny' ? 'Cię' : 'Panią/Pana'} na wydarzenie: ${topic}.

Kiedy: ${when || '[data i godzina]'}
Gdzie: ${v.place || '[miejsce]'}
${details ? `\n${details}\n` : ''}
Będzie nam bardzo miło gościć ${tone === 'swobodny' ? 'Cię' : 'Panią/Pana'}. Prosimy o potwierdzenie obecności${v.date ? ` do ${fullDate(addDaysSafe(v.date, -3))}` : ''}.

${sig}`,
    };
    case 'thanks': return {
      subject: `Dziękujemy – ${topic}`,
      body: `${g}

${P('thx', ['bardzo dziękujemy za współpracę przy projekcie', 'chcemy serdecznie podziękować za zaangażowanie w projekt', 'dziękujemy za wspólną pracę nad projektem'])} ${topic}${client ? ` dla marki ${brand}` : ''}. ${details || P('praise', ['Efekt przerósł nasze oczekiwania – to była prawdziwa przyjemność.', 'Rezultaty mówią same za siebie – dziękujemy za profesjonalizm.', 'To była współpraca, którą będziemy dobrze wspominać.'])}

${P('next', ['Mamy nadzieję na kolejne wspólne projekty.', 'Liczymy, że to nie ostatni wspólny projekt.', 'Do zobaczenia przy następnej okazji!'])}

${sig}`,
    };
    case 'offer': return {
      subject: `Momenty Agency – propozycja współpracy dla ${c?.name || brand}`,
      body: `${g}

dziękujemy za rozmowę i zainteresowanie współpracą z Momenty Agency. Tworzymy momenty, które budują marki – łączymy strategię, content, produkcję, PR i influencer marketing.

Proponowany zakres:
${bullets(details) || '• Strategia komunikacji\n• Relacje z mediami\n• Kampania z influencerami\n• Produkcja contentu'}

${v.topic ? `Cel: ${v.topic}\n\n` : ''}Szczegółową wycenę przygotujemy po doprecyzowaniu potrzeb. Czy możemy umówić spotkanie${when ? ` – np. ${when}` : ''}?

${sig}`,
    };
    case 'status': {
      const tasks = project ? db.all('tasks').filter((t) => t.projectId === project.id) : [];
      const done = tasks.filter((t) => t.done).map((t) => `• ${t.title}`).join('\n');
      const next = tasks.filter((t) => !t.done).sort(M.sortTasks).slice(0, 8).map((t) => `• ${t.title}${t.due ? ` – ${fullDate(t.due)}` : ''}`).join('\n');
      return {
        subject: `Podsumowanie: ${project?.title || topic}`,
        body: `${g}

przesyłamy podsumowanie postępów${project ? ` projektu „${project.title}”` : ''}.

ETAP: ${project ? M.stageLabel(project.stage) : '[etap]'}${project ? ` (${M.projectProgress(project)}% zadań ukończonych)` : ''}

ZREALIZOWANE
${done || '• [brak ukończonych zadań]'}

KOLEJNE KROKI
${next || '• [brak zaplanowanych zadań]'}
${details ? `\nUWAGI\n${details}\n` : ''}
Chętnie omówimy szczegóły na spotkaniu.

${sig}`,
      };
    }
    default: return { subject: '', body: '' };
  }
}

function addDaysSafe(d, n) {
  const x = new Date(`${d}T12:00:00`);
  x.setDate(x.getDate() + n);
  return x.toISOString().slice(0, 10);
}

// ---------- AI letter ----------
const STYLES = [
  'zacznij od konkretnej obserwacji o odbiorcy lub jego branży, potem przejdź do propozycji',
  'zacznij od najważniejszej informacji (newsa), krótkie akapity, rzeczowo',
  'zacznij od korzyści dla odbiorcy, ciepły, partnerski ton',
  'zacznij od kontekstu rynkowego lub trendu, potem propozycja, elegancko i zwięźle',
  'zacznij od krótkiego, osobistego zdania, następnie konkret i jasne wezwanie do działania',
];

const LETTER_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['subject', 'body'],
  properties: { subject: { type: 'string' }, body: { type: 'string' } },
};

export async function aiLetter(v) {
  const c = db.get('contacts', v.contactId);
  const project = db.get('projects', v.projectId);
  const client = db.get('contacts', v.clientId) || (project && db.get('contacts', project.clientId));
  const tpl = TEMPLATES.find((t) => t.id === v.tpl);
  const seed = v.contactId || v.clientId || v.topic || '';
  const style = STYLES[ai.hash(`${seed}|${v.tpl}`) % STYLES.length];
  // openings already used for other recipients – the new letter must not repeat them
  const used = db.all('docs').filter((d) => d.body && d.contactId !== v.contactId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 8).map((d) => d.body.split('\n').filter((l) => l.trim()).slice(1, 3).join(' ').slice(0, 220));
  const me = M.partnerName(M.me());
  const prompt = `Napisz: ${tpl?.label || 'pismo'} (${tpl?.hint || ''}).
Odbiorca: ${JSON.stringify(c ? { nazwa: c.name, rodzaj: M.kindLabel(c.kind), redakcja: c.outlet || null, stanowisko: c.role || null, tematyka: c.beat || c.niche || null, preferencje: c.preferences || null, instagram: c.instagram || null } : null)}
Marka / klient: ${JSON.stringify(client ? { nazwa: client.name, branza: client.industry || null, przekazy: client.messages || null, instagram: client.instagram || null } : null)}
Projekt: ${JSON.stringify(project ? { tytul: project.title, opis: project.description || null, cel: project.goal || null, termin: project.due || null } : null)}
Temat: ${v.topic || '—'} · Data: ${v.date ? fullDate(v.date) : '—'} · Miejsce: ${v.place || '—'}
Szczegóły od użytkownika: ${v.details || '—'}
Ton: ${v.tone === 'swobodny' ? 'swobodny, ciepły (na „Ty” tylko wobec influencerów i znajomych dziennikarzy)' : 'formalny, profesjonalny'}.
Styl tego listu: ${style}.
Nie powtarzaj sformułowań z poniższych listów wysłanych do innych firm (każda firma ma dostać inny, oryginalny tekst):
${used.map((u) => `- ${u}`).join('\n') || '- (brak)'}
Podpis: ${me}, Momenty Agency, office@momentyagency.com · www.momentyagency.com
Jeśli czegoś brakuje (np. daty), wstaw [uzupełnij: …] zamiast zmyślać.`;
  return ai.askJSON({
    system: 'Jesteś starszym konsultantem PR w Momenty Agency (Warszawa). Piszesz po polsku listy, maile i komunikaty, które brzmią profesjonalnie i pewnie, jak od agencji, która zna się na rzeczy – konkretnie, bez korpomowy i przesadnych przymiotników, z jasnym następnym krokiem. Używasz formy „my” w imieniu agencji. Zwracasz JSON: temat i treść (treść jako czysty tekst z akapitami).',
    prompt, schema: LETTER_SCHEMA, max_tokens: 4000,
  });
}
