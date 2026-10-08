// Project pricing (quote), AI price suggestion and printable quote.

import * as db from './db.js';
import * as M from './model.js';
import * as ai from './ai.js';
import { uid } from './db.js';
import { fullDate, todayStr, daysBetween } from './ui.js';
import { agencyProfile } from './agency.js';

export const UNITS = ['szt.', 'godz.', 'dzień', 'mies.', 'post', 'relacja', 'rolka', 'ryczałt'];

export function pricingOf(p) {
  const a = agencyProfile();
  return { items: [], vat: a.vat ?? 23, discount: 0, notes: '', ...(p.pricing || {}) };
}

export function totals(pr) {
  const sub = pr.items.reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.price) || 0), 0);
  const discount = sub * (Number(pr.discount) || 0) / 100;
  const net = sub - discount;
  const vat = net * (Number(pr.vat) || 0) / 100;
  return { sub, discount, net, vat, gross: net + vat };
}

export const pln = (n) => (Number(n) || 0).toLocaleString('pl-PL', { style: 'currency', currency: 'PLN', maximumFractionDigits: 2 });

export const newItem = (o = {}) => ({ id: uid(), name: '', qty: 1, unit: 'szt.', price: 0, ...o });

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['items', 'summary', 'assumptions', 'range_low', 'range_high'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['name', 'qty', 'unit', 'unit_price', 'note'],
        properties: { name: { type: 'string' }, qty: { type: 'number' }, unit: { type: 'string' }, unit_price: { type: 'number' }, note: { type: 'string' } },
      },
    },
    summary: { type: 'string' },
    assumptions: { type: 'array', items: { type: 'string' } },
    range_low: { type: 'number' },
    range_high: { type: 'number' },
  },
};

/** Asks AI for a price proposal for the project (net PLN). The user reviews and edits it before applying. */
export async function suggestPrice(p, extra = '') {
  const client = db.get('contacts', p.clientId);
  const infl = (p.influencerIds || []).map((id) => db.get('contacts', id)).filter(Boolean)
    .map((c) => ({ nazwa: c.name, obserwujacy: c.followers || null, zaangazowanie: c.engagement || null, stawki: c.rates || null }));
  const tasks = db.all('tasks').filter((t) => t.projectId === p.id).map((t) => t.title).slice(0, 40);
  const history = db.all('projects').filter((x) => x.id !== p.id && x.pricing?.items?.length)
    .slice(0, 12).map((x) => ({ rodzaj: M.PROJECT_TYPES.find((t) => t[0] === x.type)?.[1], tytul: x.title, netto: Math.round(totals(pricingOf(x)).net) }));
  const days = p.start && p.due ? daysBetween(p.start, p.due) : null;
  const prompt = `Przygotuj propozycję wyceny projektu butikowej agencji PR z Warszawy (Momenty Agency) dla klienta w Polsce.
Ceny netto w PLN, realistyczne dla polskiego rynku. Oddziel honorarium agencji (strategia, koordynacja, PR, content) od kosztów zewnętrznych (np. wynagrodzenia influencerów, produkcja, lokal), opisując koszty zewnętrzne jako szacunek.
Nie wymyślaj faktów o kliencie. Jeśli brakuje danych, przyjmij rozsądne założenia i wypisz je.

Projekt: ${JSON.stringify({
    tytul: p.title, rodzaj: M.PROJECT_TYPES.find((t) => t[0] === p.type)?.[1], opis: p.description || null, cel: p.goal || null,
    budzet_wskazany_przez_klienta: p.budget || null, czas_trwania_dni: days, klient: client ? { nazwa: client.name, branza: client.industry || null } : null,
    influencerzy: infl, zadania: tasks,
  })}
Wcześniejsze wyceny agencji (dla spójności): ${JSON.stringify(history)}
${extra ? `Dodatkowe wskazówki: ${extra}` : ''}
Pozycje mają być krótkie i zrozumiałe dla klienta (po polsku). Jednostki: ${UNITS.join(', ')}.`;
  return ai.askJSON({
    system: 'Jesteś doświadczonym dyrektorem finansowym agencji PR w Polsce. Tworzysz przejrzyste, uczciwe wyceny. Odpowiadasz wyłącznie w formacie JSON zgodnym ze schematem.',
    prompt, schema: SCHEMA, max_tokens: 6000,
  });
}

export function printQuote(p) {
  const pr = pricingOf(p);
  const t = totals(pr);
  const a = agencyProfile();
  const client = db.get('contacts', p.clientId);
  const esc = (s) => String(s ?? '').replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));
  const rows = pr.items.map((i, n) => `<tr><td>${n + 1}</td><td>${esc(i.name)}${i.note ? `<div class="note">${esc(i.note)}</div>` : ''}</td><td class="r">${esc(i.qty)} ${esc(i.unit)}</td><td class="r">${pln(i.price)}</td><td class="r">${pln((Number(i.qty) || 0) * (Number(i.price) || 0))}</td></tr>`).join('');
  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.write(`<!doctype html><html lang="pl"><head><meta charset="utf-8"><title>Oferta – ${esc(p.title)}</title>
<style>@page{margin:18mm}body{font:10.5pt/1.5 Helvetica,Arial,sans-serif;color:#1b1716;max-width:180mm;margin:0 auto;padding:10mm 0}
.head{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #5C0100;padding-bottom:10px;margin-bottom:22px}
.logo{background:#5C0100;padding:10px 16px;border-radius:4px}.logo img{height:30px;display:block}.meta{font-size:9pt;color:#6f6763;text-align:right}
h1{font:500 22pt Georgia,serif;margin:0 0 4px}table{width:100%;border-collapse:collapse;margin:18px 0}th,td{padding:7px 6px;border-bottom:1px solid #e5e1db;vertical-align:top}
th{text-align:left;font-size:9pt;color:#6f6763;text-transform:uppercase;letter-spacing:.04em}.r{text-align:right;white-space:nowrap}.note{font-size:9pt;color:#6f6763}
.tot td{border:0;padding:3px 6px}.tot .g td{font-weight:700;font-size:12pt;border-top:2px solid #5C0100;padding-top:8px}.small{font-size:9pt;color:#6f6763}</style></head><body>
<div class="head"><div class="logo"><img src="${new URL('assets/icons/logo-white.png', location.href)}" alt="Momenty Agency"></div>
<div class="meta">${esc(a.legalName || 'Momenty Agency')}<br>${esc(a.address || '')}${a.nip ? `<br>NIP ${esc(a.nip)}` : ''}<br>${esc(a.email || 'office@momentyagency.com')}</div></div>
<h1>Oferta: ${esc(p.title)}</h1>
<div class="small">Dla: ${esc(client?.legalName || client?.name || '—')} · Data: ${fullDate(todayStr())} · Ważna 30 dni</div>
<table><thead><tr><th>#</th><th>Pozycja</th><th class="r">Ilość</th><th class="r">Cena netto</th><th class="r">Wartość netto</th></tr></thead><tbody>${rows}</tbody></table>
<table class="tot">${pr.discount ? `<tr><td class="r">Rabat ${esc(pr.discount)}%</td><td class="r" style="width:35mm">−${pln(t.discount)}</td></tr>` : ''}
<tr><td class="r">Razem netto</td><td class="r" style="width:35mm">${pln(t.net)}</td></tr>
<tr><td class="r">VAT ${esc(pr.vat)}%</td><td class="r">${pln(t.vat)}</td></tr>
<tr class="g"><td class="r">Razem brutto</td><td class="r">${pln(t.gross)}</td></tr></table>
${pr.notes ? `<p class="small">${esc(pr.notes).replace(/\n/g, '<br>')}</p>` : ''}
<script>window.onload=()=>setTimeout(()=>window.print(),300)<\/script></body></html>`);
  w.document.close();
  return true;
}
