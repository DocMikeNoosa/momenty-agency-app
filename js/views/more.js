// "Więcej" – everything that is not a main tab, as big labelled tiles; plus the welcome walkthrough.
import * as db from '../db.js';
import * as cloud from '../cloud.js';
import { h, icon, openSheet, clear } from '../ui.js';
import { navigate } from '../router.js';
import { openAssist } from '../assist.js';

export function renderMore() {
  const tile = (ic, title, text, onclick) => h('button', { class: 'more-tile', onclick },
    h('span', { class: 'tool-ic' }, icon(ic, 24)),
    h('span', { class: 'more-text' }, h('span', { class: 'more-title' }, title), h('span', { class: 'more-sub' }, text)),
    icon('chevron', 18, 'muted'));
  const docs = db.all('docs').length;
  const files = db.all('files').length;
  return {
    title: 'Więcej',
    node: h('div', { class: 'page page-narrow' },
      h('button', { class: 'ask-card', onclick: () => openAssist() },
        h('span', { class: 'tab-ai-orb' }, icon('ai', 26)),
        h('span', null, h('strong', null, 'Zapytaj asystenta'), h('span', { class: 'small' }, 'Napisze pismo, zaplanuje zadania, przygotuje wycenę, umowę lub makietę.'))),
      h('div', { class: 'more-list' },
        tile('doc', 'Pisma i dokumenty', `${docs ? `${docs} zapisanych · ` : ''}e-maile, oferty, umowy`, () => navigate('asystent')),
        tile('files', 'Pliki i zdjęcia', files ? `${files} plików` : 'zdjęcia z wydarzeń, logotypy, briefy', () => navigate('pliki')),
        tile('instagram', 'Makieta posta', 'podgląd posta lub relacji dla klienta', () => navigate('asystent/makieta')),
        tile('search', 'Szukaj', 'klienci, projekty, zadania, dokumenty', () => window.dispatchEvent(new Event('open-search'))),
        tile('settings', 'Ustawienia', cloud.isLinked() ? 'zespół, połączenia, bezpieczeństwo, kopia' : 'połącz z zespołem, bezpieczeństwo, kopia', () => navigate('ustawienia')),
        tile('help', 'Jak korzystać z aplikacji', '3 krótkie wskazówki', () => showTour()))),
  };
}

const SLIDES = [
  ['today', 'Dziś', 'Tu zaczynasz dzień: zaległe sprawy, zadania na dziś i najbliższe dni. Przesuń zadanie w prawo – gotowe, w lewo – na jutro.'],
  ['ai', 'Przycisk ✦ – na każdym ekranie', 'Jedno miejsce do wszystkiego: powiedz lub napisz, co zrobić („przypomnij mi jutro o 10…”, „napisz maila do klienta”), albo dodaj zadanie, projekt, kontakt, zdjęcie. Na ekranie projektu asystent zna już cały projekt.'],
  ['projects', 'Projekt = wszystko w jednym miejscu', 'Przegląd z zadaniami, Wycena i umowa, Pliki i dokumenty. Przyciski ✦ na górze projektu piszą e-maile, wyceny, umowy i makiety jednym stuknięciem.'],
];

export function showTour() {
  let i = 0;
  const body = h('div', { class: 'tour' });
  const next = h('button', { class: 'btn btn-primary btn-block' });
  const draw = () => {
    const [ic, title, text] = SLIDES[i];
    clear(body).append(
      h('div', { class: 'tour-ic' }, icon(ic, 40)),
      h('h2', { class: 'tour-title' }, title),
      h('p', { class: 'tour-text' }, text),
      h('div', { class: 'tour-dots' }, SLIDES.map((_, k) => h('span', { class: `tour-dot ${k === i ? 'on' : ''}` }))));
    next.textContent = i < SLIDES.length - 1 ? 'Dalej' : 'Zaczynamy';
  };
  next.addEventListener('click', () => { if (i < SLIDES.length - 1) { i++; draw(); } else s.close(); });
  draw();
  const s = openSheet({ title: 'Witaj w Momenty', body, footer: [next], className: 'sheet-small', onClose: () => db.kvSet('tourDone', true) });
}

export function maybeTour() {
  if (!db.kvGet('tourDone')) setTimeout(showTour, 600);
}
