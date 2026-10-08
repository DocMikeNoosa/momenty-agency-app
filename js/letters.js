// Letter templates (Polish). Written in the agency "we" voice so they read correctly for any sender.

import * as db from './db.js';
import * as M from './model.js';
import { fullDate, todayStr } from './ui.js';

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

function greeting(c, tone) {
  if (tone === 'swobodny' && c?.name && c.kind !== 'klient') return `Cześć ${firstName(c.name)},`;
  return 'Dzień dobry,';
}

function signature(tone) {
  const me = M.partnerName(M.me());
  return `${tone === 'swobodny' ? 'Pozdrawiamy serdecznie' : 'Z wyrazami szacunku'},\n${me}\nMomenty Agency\noffice@momentyagency.com · www.momentyagency.com`;
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
  const g = greeting(c, tone);
  const details = (v.details || '').trim();
  const sig = signature(tone);

  switch (v.tpl) {
    case 'pitch': return {
      subject: `Propozycja tematu: ${topic}`,
      body: `${g}

piszemy z Momenty Agency – reprezentujemy markę ${brand}. Chcielibyśmy zaproponować temat, który może zainteresować ${c?.outlet ? `czytelników ${c.outlet}` : 'Państwa odbiorców'}: ${topic}.

${details || '[2–3 zdania: co jest nowego, dlaczego teraz i dlaczego to ciekawe dla odbiorców]'}

Możemy przygotować dodatkowe materiały: komentarz eksperta, zdjęcia w wysokiej rozdzielczości${client ? ` lub próbki produktów ${brand}` : ''}.${when ? ` Zależy nam na publikacji do ${when}.` : ''}

Czy temat wydaje się interesujący? Chętnie umówimy krótką rozmowę lub prześlemy więcej informacji.

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

${tone === 'swobodny' ? 'odzywamy się' : 'uprzejmie przypominamy się'} w sprawie naszej wiadomości dotyczącej: ${topic}.${details ? `\n\n${details}` : ''}

Czy mieli Państwo okazję się z nią zapoznać? Jeśli temat jest interesujący, chętnie prześlemy dodatkowe materiały${when ? ` – najlepiej do ${when}` : ''}.

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

bardzo dziękujemy za współpracę przy projekcie ${topic}${client ? ` dla marki ${brand}` : ''}. ${details || 'Efekt przerósł nasze oczekiwania – to była prawdziwa przyjemność.'}

Mamy nadzieję na kolejne wspólne projekty.

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
