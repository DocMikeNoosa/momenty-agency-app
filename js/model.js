// Domain definitions: partners, stages, contact types, task types, quick-add parser, calendar export.

import * as db from './db.js';
import { todayStr, addDays, dateStr, parseDate } from './ui.js';

// ---------- Partners ----------
export function partners() {
  return db.kvGet('partners', [{ id: 'p1', name: 'Osoba 1' }, { id: 'p2', name: 'Osoba 2' }]);
}
export function me() { return db.kvGet('me', 'p1'); }
export function partnerName(id) { return partners().find((p) => p.id === id)?.name || ''; }
export function otherPartner() { return partners().find((p) => p.id !== me()); }
export function partnerOptions(withEmpty = false) {
  const o = partners().map((p) => [p.id, p.name]);
  return withEmpty ? [['', '— nikt —'], ...o, ['oba', 'Obie osoby']] : [...o, ['oba', 'Obie osoby']];
}
export function ownerLabel(id) { return id === 'oba' ? 'Obie osoby' : partnerName(id); }

// ---------- Projects ----------
export const STAGES = [
  ['plan', 'Planowanie'],
  ['przygotowanie', 'Przygotowanie'],
  ['akceptacja', 'Akceptacja klienta'],
  ['realizacja', 'Realizacja'],
  ['raport', 'Raport'],
  ['zakonczony', 'Zakończony'],
];
export const stageLabel = (s) => STAGES.find(([k]) => k === s)?.[1] || 'Planowanie';
export const stageIndex = (s) => Math.max(0, STAGES.findIndex(([k]) => k === s));

export const PROJECT_TYPES = [
  ['pr', 'PR / media'], ['influencer', 'Influencer marketing'], ['event', 'Wydarzenie'],
  ['content', 'Content / produkcja'], ['strategia', 'Strategia'], ['specjalny', 'Projekt specjalny'],
];

export function projectProgress(p) {
  const ts = db.all('tasks').filter((t) => t.projectId === p.id);
  if (!ts.length) return p.stage === 'zakonczony' ? 100 : Math.round((stageIndex(p.stage) / (STAGES.length - 1)) * 100);
  return Math.round((ts.filter((t) => t.done).length / ts.length) * 100);
}

// ---------- Contacts ----------
export const CONTACT_KINDS = [
  ['klient', 'Klienci', 'Klient', 'building'],
  ['influencer', 'Influencerzy', 'Influencer', 'instagram'],
  ['media', 'Media', 'Dziennikarz / media', 'megaphone'],
  ['partner', 'Partnerzy', 'Partner / dostawca', 'users'],
];
export const kindLabel = (k) => CONTACT_KINDS.find((c) => c[0] === k)?.[2] || 'Kontakt';
export const kindIcon = (k) => CONTACT_KINDS.find((c) => c[0] === k)?.[3] || 'contacts';

const common = {
  email: { key: 'email', label: 'E-mail', type: 'email', inputmode: 'email' },
  phone: { key: 'phone', label: 'Telefon', type: 'tel', inputmode: 'tel' },
  instagram: { key: 'instagram', label: 'Instagram', placeholder: '@nazwa' },
  website: { key: 'website', label: 'Strona WWW', type: 'url', placeholder: 'https://' },
  city: { key: 'city', label: 'Miasto' },
  notes: { key: 'notes', label: 'Notatki', type: 'textarea' },
};

export function contactFields(kind) {
  switch (kind) {
    case 'klient': return [
      { key: 'name', label: 'Nazwa firmy / marki', required: true, full: true },
      { key: 'industry', label: 'Branża' },
      { key: 'status', label: 'Status', type: 'select', options: [['aktywny', 'Aktywny'], ['potencjalny', 'Potencjalny klient'], ['wstrzymany', 'Wstrzymany'], ['zakonczony', 'Współpraca zakończona']] },
      { key: 'person', label: 'Osoba kontaktowa' },
      { key: 'role', label: 'Stanowisko' },
      common.email, common.phone, common.instagram, common.website,
      { key: 'lead', label: 'Opiekun klienta', type: 'select', options: () => partnerOptions(true) },
      { key: 'health', label: 'Kondycja relacji', type: 'select', options: [['dobra', 'Dobra'], ['uwaga', 'Wymaga uwagi'], ['ryzyko', 'Zagrożona']] },
      { key: 'retainer', label: 'Budżet / retainer', placeholder: 'np. 8 000 zł / mies.' },
      { key: 'contractEnd', label: 'Koniec umowy', type: 'date' },
      { key: 'messages', label: 'Kluczowe przekazy marki', type: 'textarea', rows: 3, placeholder: 'Najważniejsze komunikaty, ton, słowa do unikania…' },
      { key: 'legalName', label: 'Pełna nazwa firmy (do umów)', full: true },
      { key: 'address', label: 'Adres siedziby', full: true },
      { key: 'nip', label: 'NIP', inputmode: 'numeric' },
      { key: 'representative', label: 'Osoba reprezentująca (do umów)' },
      common.notes,
    ];
    case 'influencer': return [
      { key: 'name', label: 'Imię i nazwisko / pseudonim', required: true, full: true },
      common.instagram,
      { key: 'tiktok', label: 'TikTok', placeholder: '@nazwa' },
      { key: 'youtube', label: 'YouTube', placeholder: 'nazwa kanału' },
      { key: 'niche', label: 'Tematyka', placeholder: 'np. beauty, moda, lifestyle' },
      { key: 'followers', label: 'Liczba obserwujących', type: 'number', inputmode: 'numeric' },
      { key: 'engagement', label: 'Zaangażowanie (%)', type: 'number', inputmode: 'decimal', step: '0.1' },
      common.city,
      { key: 'rates', label: 'Stawki', placeholder: 'np. post 3 000 zł, relacja 1 200 zł' },
      { key: 'manager', label: 'Agent / manager' },
      common.email, common.phone,
      { key: 'rating', label: 'Ocena współpracy', type: 'rating' },
      common.notes,
    ];
    case 'media': return [
      { key: 'name', label: 'Imię i nazwisko', required: true, full: true },
      { key: 'outlet', label: 'Redakcja / medium' },
      { key: 'role', label: 'Stanowisko', placeholder: 'np. redaktorka działu beauty' },
      { key: 'beat', label: 'Tematyka', placeholder: 'np. moda, biznes, kultura' },
      common.email, common.phone, common.instagram, common.city,
      { key: 'preferences', label: 'Preferencje kontaktu', placeholder: 'np. tylko e-mail, nie w piątki' },
      common.notes,
    ];
    default: return [
      { key: 'name', label: 'Nazwa / imię i nazwisko', required: true, full: true },
      { key: 'service', label: 'Usługa', placeholder: 'np. fotograf, catering, lokal' },
      { key: 'person', label: 'Osoba kontaktowa' },
      common.email, common.phone, common.instagram, common.website, common.city,
      { key: 'rates', label: 'Stawki' },
      { key: 'rating', label: 'Ocena', type: 'rating' },
      common.notes,
    ];
  }
}

export function contactSubtitle(c) {
  switch (c.kind) {
    case 'klient': return [c.industry, c.person].filter(Boolean).join(' · ');
    case 'influencer': return [c.instagram && handle(c.instagram), c.followers ? `${fmtShortNum(c.followers)} obs.` : '', c.niche].filter(Boolean).join(' · ');
    case 'media': return [c.outlet, c.beat].filter(Boolean).join(' · ');
    default: return [c.service, c.city].filter(Boolean).join(' · ');
  }
}

function fmtShortNum(n) {
  n = Number(n);
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace('.0', '').replace('.', ',')} mln`;
  if (n >= 1e3) return `${Math.round(n / 1e3)} tys.`;
  return String(n);
}

export function handle(s) {
  if (!s) return '';
  const m = String(s).trim().match(/(?:instagram\.com\/|tiktok\.com\/@?)?@?([A-Za-z0-9._]+)/);
  return m ? `@${m[1]}` : s;
}
export function instagramUrl(s) { const hnd = handle(s).slice(1); return hnd ? `https://instagram.com/${hnd}` : null; }
export function tiktokUrl(s) { const hnd = handle(s).slice(1); return hnd ? `https://www.tiktok.com/@${hnd}` : null; }
export function webUrl(s) { if (!s) return null; return /^https?:\/\//i.test(s) ? s : `https://${s}`; }

// ---------- Tasks ----------
export const TASK_KINDS = [
  ['zadanie', 'Zadanie', 'check'],
  ['followup', 'Follow-up', 'mail'],
  ['spotkanie', 'Spotkanie', 'users'],
  ['wydarzenie', 'Wydarzenie', 'flag'],
  ['publikacja', 'Publikacja influencera', 'instagram'],
  ['termin', 'Termin / embargo', 'clock'],
];
export const taskKindLabel = (k) => TASK_KINDS.find((t) => t[0] === k)?.[1] || 'Zadanie';
export const taskKindIcon = (k) => TASK_KINDS.find((t) => t[0] === k)?.[2] || 'check';
export const PRIORITIES = [['normalny', 'Normalny'], ['wysoki', 'Wysoki'], ['niski', 'Niski']];

// Calendar reminders (minutes before) chosen per task type.
export function reminderMinutes(t) {
  switch (t.kind) {
    case 'termin': return t.time ? [2880, 1440, 120] : [2880, 1440];
    case 'wydarzenie': return t.time ? [1440, 120] : [1440];
    case 'spotkanie': return t.time ? [60, 15] : [1440];
    case 'publikacja': return t.time ? [1440, 60] : [1440];
    case 'followup': return t.time ? [30] : [0];
    default: return t.time ? [1440, 60] : [1440];
  }
}

export function reminderText(t) {
  return reminderMinutes(t).map((m) => {
    if (m === 0) return 'rano w dniu';
    if (m < 60) return `${m} min przed`;
    if (m < 1440) return `${m / 60} godz. przed`;
    return m === 1440 ? '1 dzień przed' : `${m / 1440} dni przed`;
  }).join(', ');
}

export function visibleFor(t, filter) {
  if (filter === 'all') return true;
  if (filter === 'me') return t.owner === me() || t.owner === 'oba' || !t.owner;
  return t.owner === filter || t.owner === 'oba';
}

export function sortTasks(a, b) {
  if (a.done !== b.done) return a.done ? 1 : -1;
  if ((a.due || '9') !== (b.due || '9')) return (a.due || '9').localeCompare(b.due || '9');
  if ((a.time || '99') !== (b.time || '99')) return (a.time || '99').localeCompare(b.time || '99');
  const pr = { wysoki: 0, normalny: 1, niski: 2 };
  return (pr[a.priority] ?? 1) - (pr[b.priority] ?? 1);
}

// ---------- Quick add (Polish natural language) ----------
// No \b here: JS word boundaries are ASCII-only and break on Polish letters (ś, ę).
const WEEKDAYS = [
  [/niedziel[aęi]/i, 0], [/poniedzia[łl](?:ek|ku)/i, 1], [/wtor(?:ek|ku)/i, 2],
  [/[śs]rod[aęy]/i, 3], [/czwart(?:ek|ku)/i, 4], [/pi[ąa]t(?:ek|ku)/i, 5], [/sobot[aęy]/i, 6],
];

export function parseQuick(text, base = todayStr()) {
  let s = ` ${text} `;
  let due = null;
  let time = null;
  const take = (re, fn) => { const m = s.match(re); if (m) { fn(m); s = s.replace(m[0], ' '); return true; } return false; };

  const setTime = (hh, mm) => { if (hh < 24 && mm < 60) time = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`; };
  take(/\s(?:o|godz\.?)\s*(\d{1,2})[:.](\d{2})(?=\s)/i, (m) => setTime(+m[1], +m[2])) ||
    take(/\s(\d{1,2}):(\d{2})(?=\s)/, (m) => setTime(+m[1], +m[2])) ||
    take(/\s(?:o|godz\.?)\s*(\d{1,2})(?=\s)/i, (m) => setTime(+m[1], 0));

  if (!take(/\s(dzi[śs]|dzisiaj)(?=\s)/i, () => { due = base; })) {
    if (!take(/\s(pojutrze)(?=\s)/i, () => { due = addDays(base, 2); })) {
      if (!take(/\s(jutro)(?=\s)/i, () => { due = addDays(base, 1); })) {
        if (!take(/\sza\s+(\d{1,2})\s+(dni|dzie[ńn]|tydzie[ńn]|tygodnie|tygodni)(?=\s)/i, (m) => {
          const n = +m[1]; due = addDays(base, /tyg|tydz/i.test(m[2]) ? n * 7 : n);
        })) {
          if (!take(/\s(?:za\s+tydzie[ńn])(?=\s)/i, () => { due = addDays(base, 7); })) {
            take(/\s(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?(?=\s)/, (m) => {
              const d = +m[1], mo = +m[2];
              let y = m[3] ? +m[3] : parseDate(base).getFullYear();
              if (y < 100) y += 2000;
              if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12) {
                let cand = dateStr(new Date(y, mo - 1, d));
                if (!m[3] && cand < base) cand = dateStr(new Date(y + 1, mo - 1, d));
                due = cand;
              }
            });
            if (!due) {
              for (const [re, wd] of WEEKDAYS) {
                const rx = new RegExp(`\\s(?:w\\s+|we\\s+|na\\s+|do\\s+)?(?:${re.source})(?=\\s)`, 'i');
                if (take(rx, () => {
                  const cur = parseDate(base).getDay();
                  let diff = (wd - cur + 7) % 7;
                  if (diff === 0) diff = 7;
                  due = addDays(base, diff);
                })) break;
              }
            }
          }
        }
      }
    }
  }
  if (time && !due) due = base;
  const title = s.replace(/\s+/g, ' ').trim().replace(/^[,.\-–]\s*/, '').replace(/\s*[,.\-–]$/, '');
  return { title: title ? title[0].toUpperCase() + title.slice(1) : '', due, time };
}

// ---------- Calendar ----------
const icsDate = (d, t) => (t ? `${d.replace(/-/g, '')}T${t.replace(':', '')}00` : d.replace(/-/g, ''));

function taskDetails(t) {
  const p = db.get('projects', t.projectId);
  const c = db.get('contacts', t.contactId) || (p && db.get('contacts', p.clientId));
  return [
    p ? `Projekt: ${p.title}` : '', c ? `Kontakt: ${c.name}` : '',
    t.owner ? `Osoba: ${ownerLabel(t.owner)}` : '', t.notes || '', '— Momenty Agency',
  ].filter(Boolean).join('\n');
}

function endTime(time, mins) {
  const [hh, mm] = time.split(':').map(Number);
  const tot = Math.min(hh * 60 + mm + mins, 23 * 60 + 59);
  return `${String(Math.floor(tot / 60)).padStart(2, '0')}:${String(tot % 60).padStart(2, '0')}`;
}

export function googleCalendarUrl(t) {
  const dates = t.time
    ? `${icsDate(t.due, t.time)}/${icsDate(t.due, endTime(t.time, t.kind === 'wydarzenie' ? 120 : 60))}`
    : `${icsDate(t.due)}/${icsDate(addDays(t.due, 1))}`;
  const q = new URLSearchParams({ action: 'TEMPLATE', text: t.title, dates, details: taskDetails(t), ctz: 'Europe/Warsaw' });
  if (t.location) q.set('location', t.location);
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}

const esc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (m) => `\\${m}`);
function fold(line) {
  const out = [];
  while (line.length > 74) { out.push(line.slice(0, 74)); line = ` ${line.slice(74)}`; }
  out.push(line);
  return out.join('\r\n');
}

export function buildIcs(tasks) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Momenty Agency//Aplikacja//PL', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Momenty Agency', 'X-WR-TIMEZONE:Europe/Warsaw',
    'BEGIN:VTIMEZONE', 'TZID:Europe/Warsaw',
    'BEGIN:DAYLIGHT', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0200', 'TZNAME:CEST', 'DTSTART:19700329T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'END:DAYLIGHT',
    'BEGIN:STANDARD', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100', 'TZNAME:CET', 'DTSTART:19701025T030000', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'END:STANDARD',
    'END:VTIMEZONE'];
  for (const t of tasks) {
    if (!t.due) continue;
    lines.push('BEGIN:VEVENT', `UID:${t.id}@momentyagency`, `DTSTAMP:${stamp}`);
    if (t.time) {
      lines.push(`DTSTART;TZID=Europe/Warsaw:${icsDate(t.due, t.time)}`, `DTEND;TZID=Europe/Warsaw:${icsDate(t.due, endTime(t.time, 60))}`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${icsDate(t.due)}`, `DTEND;VALUE=DATE:${icsDate(addDays(t.due, 1))}`);
    }
    lines.push(`SUMMARY:${esc(t.title)}`, `DESCRIPTION:${esc(taskDetails(t))}`);
    if (t.done) lines.push('STATUS:CANCELLED');
    for (const m of reminderMinutes(t)) {
      const trig = t.time ? `-PT${m}M` : (m === 0 ? 'PT8H' : `-PT${m - 480}M`); // all-day: relative to 08:00
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(t.title)}`, `TRIGGER:${trig}`, 'END:VALARM');
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

// ---------- Google Calendar (server sync) ----------
// Timed tasks: reminders as chosen per task type. All-day tasks: Google counts minutes back from
// midnight, so "1 day before" becomes 08:00 the day before (and "morning of" also becomes 08:00 the day before).
export function googleReminders(t) {
  const mins = reminderMinutes(t);
  if (t.time) return mins;
  return [...new Set(mins.map((m) => (m <= 0 ? 960 : Math.max(0, m - 480))))];
}

/** Tasks that belong in this person's Google Calendar: their own and shared ones, not done, with a date. */
export function calendarEvents() {
  const from = addDays(todayStr(), -1);
  return db.all('tasks')
    .filter((t) => !t.done && t.due && t.due >= from && (t.owner === me() || t.owner === 'oba'))
    .map((t) => ({
      id: t.id, title: t.title, date: t.due, time: t.time || undefined,
      durationMin: t.kind === 'wydarzenie' ? 120 : 60,
      description: taskDetails(t), location: t.location || undefined, reminders: googleReminders(t),
    }));
}
