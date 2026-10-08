import test from 'node:test';
import assert from 'node:assert/strict';
import { parseQuick, buildIcs, reminderMinutes } from '../js/model.js';
import { plural, addDays } from '../js/ui.js';

const base = '2026-10-08'; // Thursday

test('quick add: relative days', () => {
  assert.deepEqual(parseQuick('Zadzwonić do Ani jutro', base), { title: 'Zadzwonić do Ani', due: '2026-10-09', time: null });
  assert.deepEqual(parseQuick('raport dziś', base), { title: 'Raport', due: base, time: null });
  assert.equal(parseQuick('wysyłka pojutrze', base).due, '2026-10-10');
  assert.equal(parseQuick('brief za 3 dni', base).due, '2026-10-11');
  assert.equal(parseQuick('podsumowanie za tydzień', base).due, '2026-10-15');
});

test('quick add: times', () => {
  const r = parseQuick('Zadzwonić do Magazynu Styl jutro o 15', base);
  assert.deepEqual(r, { title: 'Zadzwonić do Magazynu Styl', due: '2026-10-09', time: '15:00' });
  assert.equal(parseQuick('spotkanie 9:30', base).time, '09:30');
  assert.equal(parseQuick('spotkanie 9:30', base).due, base);
  assert.equal(parseQuick('call o 14.45 w piątek', base).time, '14:45');
});

test('quick add: weekdays and dates', () => {
  assert.equal(parseQuick('call w piątek', base).due, '2026-10-09');
  assert.equal(parseQuick('call w czwartek', base).due, '2026-10-15'); // same weekday -> next week
  assert.equal(parseQuick('event w środę', base).due, '2026-10-14');
  assert.equal(parseQuick('event w niedzielę', base).due, '2026-10-11');
  assert.equal(parseQuick('premiera 12.10', base).due, '2026-10-12');
  assert.equal(parseQuick('premiera 3.01', base).due, '2027-01-03'); // past date -> next year
  assert.equal(parseQuick('premiera 12.10.2027', base).due, '2027-10-12');
  assert.equal(parseQuick('kolacja dla 2 osób jutro', base).time, null);
  assert.equal(parseQuick('kolacja dla 2 osób jutro', base).title, 'Kolacja dla 2 osób');
});

test('quick add: no date', () => {
  assert.deepEqual(parseQuick('Przygotować moodboard', base), { title: 'Przygotować moodboard', due: null, time: null });
});

test('polish plurals', () => {
  assert.equal(plural(1, 'zadanie', 'zadania', 'zadań'), '1 zadanie');
  assert.equal(plural(3, 'zadanie', 'zadania', 'zadań'), '3 zadania');
  assert.equal(plural(5, 'zadanie', 'zadania', 'zadań'), '5 zadań');
  assert.equal(plural(12, 'zadanie', 'zadania', 'zadań'), '12 zadań');
  assert.equal(plural(22, 'zadanie', 'zadania', 'zadań'), '22 zadania');
});

test('dates', () => {
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-03-28', 2), '2026-03-30'); // across DST change
});

test('ics export with reminders', () => {
  const ics = buildIcs([
    { id: 'a1', title: 'Embargo; premiera, serum', due: '2026-10-12', time: '09:00', kind: 'termin' },
    { id: 'a2', title: 'Raport', due: '2026-10-13', kind: 'zadanie' },
  ]);
  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.match(ics, /DTSTART;TZID=Europe\/Warsaw:20261012T090000/);
  assert.ok(ics.includes('SUMMARY:Embargo\\; premiera\\, serum'));
  assert.match(ics, /DTSTART;VALUE=DATE:20261013/);
  assert.match(ics, /DTEND;VALUE=DATE:20261014/);
  assert.equal((ics.match(/BEGIN:VALARM/g) || []).length, reminderMinutes({ kind: 'termin', time: '09:00' }).length + reminderMinutes({ kind: 'zadanie' }).length);
  assert.match(ics, /TRIGGER:-PT960M/); // all-day: 08:00 the day before
  for (const line of ics.split('\r\n')) assert.ok(line.length <= 75, `line too long: ${line}`);
});

test('letters to different companies are worded differently', async () => {
  const { generate } = await import('../js/letters.js');
  const opening = (contactId) => generate({ tpl: 'pitch', contactId, topic: 'Premiera serum', tone: 'formalny' }).body.split('\n\n')[1];
  const ids = ['a1', 'b2', 'c3', 'd4', 'e5', 'f6', 'g7', 'h8'];
  const variants = new Set(ids.map(opening));
  assert.ok(variants.size >= 3, `expected varied openings, got ${variants.size}`);
  assert.equal(opening('a1'), opening('a1'), 'same company always gets the same wording');
  const fu = new Set(ids.map((id) => generate({ tpl: 'followup', contactId: id, topic: 'X', tone: 'formalny' }).body));
  assert.ok(fu.size >= 3);
});

test('instagram lookup', async () => {
  const { instagramLookup } = await import('../js/instagram.js');
  assert.equal(instagramLookup('@ola.beauty').profileUrl, 'https://instagram.com/ola.beauty');
  assert.equal(instagramLookup('https://www.instagram.com/kuba.eats/').handle, '@kuba.eats');
  const r = instagramLookup('Ola Kamińska');
  assert.equal(r.handle, null);
  assert.match(r.searchUrl, /site%3Ainstagram\.com%20Ola%20Kami/);
});

test('google reminders for all-day tasks count back from midnight', async () => {
  const { googleReminders } = await import('../js/model.js');
  assert.deepEqual(googleReminders({ kind: 'termin', time: '09:00' }), [2880, 1440, 120]);
  assert.deepEqual(googleReminders({ kind: 'zadanie' }), [960]); // 08:00 the day before
  assert.deepEqual(googleReminders({ kind: 'termin' }), [2400, 960]); // 2 days and 1 day before at 08:00
});

test('pricing totals', async () => {
  const { totals } = await import('../js/pricing.js');
  const t = totals({ items: [{ qty: 2, price: 1000 }, { qty: 1, price: 500 }], vat: 23, discount: 10 });
  assert.equal(t.sub, 2500);
  assert.equal(t.net, 2250);
  assert.equal(Math.round(t.gross * 100) / 100, 2767.5);
});
