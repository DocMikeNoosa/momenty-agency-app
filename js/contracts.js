// Contract generator for a project: AI draft based on the project, pricing, client and agency details,
// with a solid template as a fallback. Always marked as a draft to be checked before signing.

import * as db from './db.js';
import * as M from './model.js';
import * as ai from './ai.js';
import { fullDate, todayStr } from './ui.js';
import { pricingOf, totals, pln } from './pricing.js';
import { agencyProfile } from './agency.js';

export const CONTRACT_OPTIONS = [
  { key: 'type', label: 'Rodzaj umowy', type: 'select', full: true, options: [['uslugi', 'Umowa o świadczenie usług'], ['dzielo', 'Umowa o dzieło (np. kampania, materiały)'], ['ramowa', 'Umowa ramowa / stała współpraca (retainer)']] },
  { key: 'rights', label: 'Prawa autorskie do materiałów', type: 'select', full: true, options: [['przeniesienie', 'Przeniesienie praw po zapłacie'], ['licencja', 'Licencja niewyłączna'], ['brak', 'Nie dotyczy']] },
  { key: 'payDays', label: 'Termin płatności (dni)', type: 'number', default: 14 },
  { key: 'confidential', label: 'Klauzula poufności', type: 'select', options: [['tak', 'Tak'], ['nie', 'Nie']] },
  { key: 'penalties', label: 'Kary umowne', type: 'select', options: [['nie', 'Nie'], ['tak', 'Tak (umiarkowane)']] },
  { key: 'place', label: 'Miejsce zawarcia', default: 'Warszawa' },
  { key: 'extra', label: 'Dodatkowe ustalenia', type: 'textarea', rows: 3, placeholder: 'np. dwie rundy poprawek, zaliczka 50%, akceptacja materiałów w 48 h' },
];

function facts(p, opts) {
  const a = agencyProfile();
  const c = db.get('contacts', p.clientId) || {};
  const pr = pricingOf(p);
  const t = totals(pr);
  return {
    agencja: { nazwa: a.legalName || 'Momenty Agency', adres: a.address || null, nip: a.nip || null, regon_krs: a.regon || null, reprezentant: a.representative || null, email: a.email || 'office@momentyagency.com', konto: a.bank || null },
    klient: { nazwa: c.legalName || c.name || null, adres: c.address || null, nip: c.nip || null, reprezentant: c.representative || c.person || null, email: c.email || null },
    projekt: { tytul: p.title, rodzaj: M.PROJECT_TYPES.find((x) => x[0] === p.type)?.[1], opis: p.description || null, cel: p.goal || null, start: p.start || null, termin: p.due || null },
    zakres: [...pr.items.map((i) => `${i.name} – ${i.qty} ${i.unit}`), ...db.all('tasks').filter((x) => x.projectId === p.id).map((x) => x.title)].slice(0, 40),
    wynagrodzenie: pr.items.length ? { netto: pln(t.net), vat_proc: pr.vat, vat: pln(t.vat), brutto: pln(t.gross), pozycje: pr.items.map((i) => ({ nazwa: i.name, ilosc: `${i.qty} ${i.unit}`, cena_netto: pln(i.price) })) } : null,
    opcje: opts,
  };
}

export async function aiContract(p, opts) {
  const f = facts(p, opts);
  const res = await ai.ask({
    system: `Jesteś doświadczonym prawnikiem współpracującym z agencjami PR w Polsce. Przygotowujesz projekty umów po polsku, zgodne z polskim prawem (Kodeks cywilny, ustawa o prawie autorskim i prawach pokrewnych, RODO), jasne i wyważone dla obu stron.
Piszesz w paragrafach (§ 1, § 2…), z nagłówkiem, oznaczeniem stron, datą i miejscem, oraz miejscem na podpisy. Brakujące dane oznaczasz jako [uzupełnij: …]. Nie wymyślaj numerów NIP, adresów ani kwot.
Zwracasz wyłącznie treść umowy jako czysty tekst (bez Markdown, bez komentarzy).`,
    messages: [{ role: 'user', content: `Przygotuj projekt umowy na podstawie danych (JSON):\n${JSON.stringify(f)}\n\nUwzględnij: przedmiot i zakres usług, terminy i harmonogram, sposób akceptacji materiałów, wynagrodzenie (netto, VAT, brutto, termin płatności ${opts.payDays || 14} dni, numer konta), obowiązki stron, ${opts.rights === 'brak' ? '' : `prawa autorskie (${opts.rights === 'licencja' ? 'licencja niewyłączna' : 'przeniesienie autorskich praw majątkowych po zapłacie'} z wymienieniem pól eksploatacji), `}${opts.confidential === 'tak' ? 'poufność, ' : ''}${opts.penalties === 'tak' ? 'umiarkowane kary umowne, ' : ''}ochronę danych osobowych, odpowiedzialność, rozwiązanie umowy i postanowienia końcowe.` }],
    max_tokens: 12000, effort: 'medium',
  });
  return ai.textOf(res);
}

const LOCATIVE = { warszawa: 'w Warszawie', 'kraków': 'w Krakowie', krakow: 'w Krakowie', 'wrocław': 'we Wrocławiu', 'poznań': 'w Poznaniu', 'gdańsk': 'w Gdańsku', 'łódź': 'w Łodzi', katowice: 'w Katowicach', lublin: 'w Lublinie', szczecin: 'w Szczecinie', gdynia: 'w Gdyni', sopot: 'w Sopocie' };
function placeLocative(place) {
  const p = (place || 'Warszawa').trim();
  return LOCATIVE[p.toLowerCase()] || `w miejscowości ${p}`;
}

/** Template used without AI (or as a starting point). */
export function templateContract(p, opts) {
  const f = facts(p, opts);
  const A = f.agencja; const K = f.klient;
  const u = (v, what) => v || `[uzupełnij: ${what}]`;
  const kind = { uslugi: 'UMOWA O ŚWIADCZENIE USŁUG', dzielo: 'UMOWA O DZIEŁO', ramowa: 'UMOWA RAMOWA O WSPÓŁPRACY' }[opts.type] || 'UMOWA O ŚWIADCZENIE USŁUG';
  let n = 0;
  const par = (title, body) => `§ ${++n}. ${title}\n${body}\n`;
  const scope = f.zakres.length ? f.zakres.map((s, i) => `${i + 1}) ${s}`).join('\n') : '[uzupełnij: zakres prac]';
  const parts = [
    `${kind}\nzawarta w dniu ${fullDate(todayStr())} ${placeLocative(opts.place)} pomiędzy:\n`,
    `${u(A.nazwa, 'nazwa agencji')}, ${u(A.adres, 'adres agencji')}, NIP ${u(A.nip, 'NIP agencji')}, reprezentowaną przez ${u(A.reprezentant, 'osoba reprezentująca')}, zwaną dalej „Agencją”,\na\n${u(K.nazwa, 'nazwa klienta')}, ${u(K.adres, 'adres klienta')}, NIP ${u(K.nip, 'NIP klienta')}, reprezentowaną przez ${u(K.reprezentant, 'osoba reprezentująca klienta')}, zwaną dalej „Klientem”.\n`,
    par('Przedmiot umowy', `1. Klient zleca, a Agencja zobowiązuje się do realizacji projektu „${p.title}”${f.projekt.opis ? ` – ${f.projekt.opis}` : ''}.\n2. Zakres prac obejmuje:\n${scope}`),
    par('Termin realizacji', `Projekt zostanie zrealizowany w terminie od ${f.projekt.start ? fullDate(f.projekt.start) : '[uzupełnij]'} do ${f.projekt.termin ? fullDate(f.projekt.termin) : '[uzupełnij]'}, zgodnie z harmonogramem uzgodnionym przez Strony.`),
    par('Akceptacja materiałów', 'Agencja przedstawia Klientowi materiały do akceptacji. Klient zgłasza uwagi lub akceptuje materiały w terminie 2 dni roboczych; brak uwag w tym terminie oznacza akceptację. Cena obejmuje dwie rundy poprawek.'),
    par('Wynagrodzenie', f.wynagrodzenie
      ? `1. Za realizację umowy Klient zapłaci Agencji wynagrodzenie w wysokości ${f.wynagrodzenie.netto} netto, powiększone o VAT (${f.wynagrodzenie.vat_proc}%), tj. ${f.wynagrodzenie.brutto} brutto.\n2. Płatność nastąpi przelewem na rachunek ${u(A.konto, 'numer konta')} w terminie ${opts.payDays || 14} dni od doręczenia faktury.\n3. Koszty zewnętrzne (np. wynagrodzenia influencerów, produkcja) nieujęte w wycenie wymagają uprzedniej akceptacji Klienta.`
      : `1. Wynagrodzenie Agencji wynosi [uzupełnij] zł netto plus VAT.\n2. Płatność w terminie ${opts.payDays || 14} dni od doręczenia faktury na rachunek ${u(A.konto, 'numer konta')}.`),
    par('Obowiązki Stron', '1. Agencja realizuje prace z należytą starannością, zgodnie z najlepszą praktyką branżową.\n2. Klient przekazuje informacje i materiały niezbędne do realizacji projektu oraz wyznacza osobę do kontaktu.'),
    opts.rights !== 'brak' ? par('Prawa autorskie', opts.rights === 'licencja'
      ? 'Z chwilą zapłaty wynagrodzenia Agencja udziela Klientowi niewyłącznej licencji do korzystania z materiałów powstałych w ramach umowy na polach eksploatacji: utrwalanie i zwielokrotnianie, wprowadzanie do pamięci komputera, publikacja w internecie i mediach społecznościowych, wykorzystanie w materiałach prasowych i promocyjnych, bez ograniczeń terytorialnych, na czas nieoznaczony.'
      : 'Z chwilą zapłaty wynagrodzenia Agencja przenosi na Klienta autorskie prawa majątkowe do materiałów powstałych w ramach umowy na polach eksploatacji: utrwalanie i zwielokrotnianie dowolną techniką, wprowadzanie do obrotu, wprowadzanie do pamięci komputera, publiczne udostępnianie w internecie i mediach społecznościowych, wykorzystanie w materiałach prasowych, reklamowych i promocyjnych. Prawa do materiałów stron trzecich (np. twórców internetowych) są określane odrębnie.') : '',
    opts.confidential === 'tak' ? par('Poufność', 'Strony zobowiązują się zachować w tajemnicy informacje uzyskane w związku z realizacją umowy, także przez 2 lata po jej zakończeniu, z wyjątkiem informacji publicznie dostępnych lub ujawnianych na podstawie przepisów prawa.') : '',
    opts.penalties === 'tak' ? par('Kary umowne', 'W razie zwłoki w realizacji etapu z przyczyn leżących po stronie Agencji Klient może naliczyć karę umowną w wysokości 0,2% wynagrodzenia netto za każdy dzień zwłoki, nie więcej niż 10% wynagrodzenia netto.') : '',
    par('Ochrona danych osobowych', 'Strony przetwarzają dane osobowe wyłącznie w celu realizacji umowy, zgodnie z RODO. W razie potrzeby Strony zawrą odrębną umowę powierzenia przetwarzania danych.'),
    par('Rozwiązanie umowy', 'Każda ze Stron może wypowiedzieć umowę z zachowaniem 30-dniowego okresu wypowiedzenia. Klient zapłaci za prace wykonane do dnia rozwiązania umowy.'),
    opts.extra ? par('Dodatkowe ustalenia', opts.extra) : '',
    par('Postanowienia końcowe', 'Zmiany umowy wymagają formy pisemnej lub dokumentowej pod rygorem nieważności. W sprawach nieuregulowanych stosuje się przepisy Kodeksu cywilnego oraz ustawy o prawie autorskim i prawach pokrewnych. Spory rozstrzyga sąd właściwy dla siedziby Agencji. Umowę sporządzono w dwóch jednobrzmiących egzemplarzach, po jednym dla każdej ze Stron.'),
    '\n\n______________________\t\t\t______________________\n           Agencja\t\t\t\t\t    Klient',
  ];
  return parts.filter(Boolean).join('\n');
}
