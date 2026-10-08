// End-to-end: AI assistant (tools), AI pricing, contracts, AI letters, Google Calendar and Canva connections,
// Instagram lookup – on an iPhone-sized screen, against the local backend with fake AI/Google/Canva servers.
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require('/opt/node-tools/node_modules/playwright'); }

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shots = process.argv[2] || path.join(root, 'tests', 'screenshots');
fs.mkdirSync(shots, { recursive: true });
const ANON = fs.readFileSync('/tmp/momenty-backend-logs/anon.key', 'utf8').trim();
const SUPA = 'http://127.0.0.1:54321';
const MOCK = 'http://127.0.0.1:54340';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(root, p);
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const APP = `http://localhost:${server.address().port}/`;

let failures = 0;
const ok = (c, m) => { if (c) console.log(`  ✓ ${m}`); else { failures++; console.log(`  ✗ ${m}`); } };
const step = (s) => console.log(`\n▸ ${s}`);
const errors = [];
const script = (arr) => fetch(`${MOCK}/__ai/script`, { method: 'POST', body: JSON.stringify(arr) });
const mockLog = async () => (await fetch(`${MOCK}/__log`)).json();
const tomorrow = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); })();

await fetch(`${MOCK}/__reset`);
const browser = await playwright.chromium.launch();
const ctx = await browser.newContext({ ...playwright.devices['iPhone 13'], locale: 'pl-PL', timezoneId: 'Europe/Warsaw', acceptDownloads: true });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
ctx.on('page', (p) => p.close().catch(() => {})); // ignore tabs opened for print/OAuth

step('Przygotowanie: aplikacja + połączenie z serwerem');
await page.goto(APP);
await page.waitForSelector('.brand-form');
const i = page.locator('.brand-form input');
await i.nth(0).fill('Kasia'); await i.nth(1).fill('Ola'); await i.nth(2).fill('momenty2026'); await i.nth(3).fill('momenty2026');
await page.locator('.brand-form button[type=submit]').click();
await page.locator('button:has-text("Pokaż z przykładowymi danymi")').click();
await page.waitForSelector('.hero');
await page.waitForSelector('.tour', { timeout: 5000 }).then(() => page.locator('.sheet [aria-label=Zamknij]').first().click()).catch(() => {});
await page.waitForTimeout(400);
await page.goto(`${APP}#/ustawienia/zespol`);
await page.locator('.set-row:has-text("Połącz z serwerem agencji")').click();
await page.locator('.sheet .field:has-text("Adres serwera") input').fill(SUPA);
await page.locator('.sheet .field:has-text("Klucz publiczny") input').fill(ANON);
await page.locator('.sheet .field:has-text("E-mail") input').fill(`ai-${Date.now()}@example.com`);
await page.locator('.sheet .field:has-text("Hasło do konta") input').fill('Momenty-2026');
await page.locator('.sheet-foot button:has-text("Połącz")').click();
await page.waitForSelector('text=Połączono – synchronizacja włączona', { timeout: 20000 });
ok(true, 'połączono z serwerem');

step('Asystent AI wykonuje polecenie (zadanie + e-mail)');
await script([
  { stop_reason: 'tool_use', content: [
    { type: 'text', text: 'Już się tym zajmuję.' },
    { type: 'tool_use', id: 'tu_1', name: 'create_task', input: { title: 'Zadzwonić do Magazynu Styl', due: tomorrow, time: '10:00', kind: 'followup', priority: 'wysoki' } },
    { type: 'tool_use', id: 'tu_2', name: 'draft_email', input: { to_email: 'anna@example.com', subject: 'Premiera serum – zaproszenie do testów', body: 'Dzień dobry,\n\nzapraszamy do przetestowania nowego serum.\n\nZ wyrazami szacunku,\nKasia' } },
  ] },
  { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Dodałam zadanie na jutro o 10:00 i przygotowałam e-mail do Anny.' }] },
]);
await page.goto(`${APP}#/asystent`);
await page.waitForSelector('#agent-input');
await page.screenshot({ path: `${shots}/50-asystent.png`, fullPage: true });
await page.locator('#agent-input').fill('Przypomnij mi jutro o 10 zadzwonić do Magazynu Styl i przygotuj maila do Anny z zaproszeniem do testów serum');
await page.locator('button:has-text("Wykonaj")').click();
await page.waitForSelector('.msg-ai:has-text("Dodałam zadanie")', { timeout: 20000 });
ok(await page.locator('.act:has-text("Zadanie: Zadzwonić do Magazynu Styl")').count() === 1, 'akcja: zadanie utworzone');
ok(await page.locator('.act:has-text("E-mail: Premiera serum")').count() === 1, 'akcja: e-mail przygotowany');
const mailHref = await page.locator('.act:has-text("E-mail") a:has-text("Wyślij")').getAttribute('href');
ok(mailHref.startsWith('mailto:anna@example.com?subject='), 'przycisk „Wyślij” otwiera pocztę z gotową treścią');
ok((await page.locator('.act:has-text("E-mail") a:has-text("Gmail")').getAttribute('href')).startsWith('https://mail.google.com/mail/?view=cm'), 'przycisk Gmail');
await page.screenshot({ path: `${shots}/51-asystent-wynik.png`, fullPage: true });
const log1 = await mockLog();
const aiCalls = log1.filter((l) => l.path === '/v1/messages').map((l) => JSON.parse(l.body));
ok(aiCalls.length === 2, 'dwie tury rozmowy z AI');
ok(aiCalls[0].tools?.some((t) => t.name === 'create_task') && aiCalls[0].model === 'claude-opus-5-5', 'AI dostało narzędzia aplikacji');
const second = aiCalls[1].messages;
ok(second.at(-1).role === 'user' && second.at(-1).content.filter((c) => c.type === 'tool_result').length === 2, 'wyniki obu akcji odesłane do AI w jednej wiadomości');
await page.goto(`${APP}#/dzis`);
await page.waitForSelector('.hero');
ok(await page.locator('.task:has-text("Zadzwonić do Magazynu Styl")').count() === 1, 'zadanie widoczne na ekranie Dziś');

step('Wycena projektu z propozycją AI');
await script([{ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({
  items: [
    { name: 'Strategia i koordynacja kampanii', qty: 1, unit: 'ryczałt', unit_price: 8000, note: 'plan, harmonogram, raport' },
    { name: 'Wysyłka paczek PR', qty: 15, unit: 'szt.', unit_price: 250, note: '' },
    { name: 'Influencerzy – publikacje', qty: 8, unit: 'post', unit_price: 3500, note: 'szacunek kosztów zewnętrznych' },
  ],
  summary: 'Kampania premierowa z influencerami i działaniami prasowymi.', assumptions: ['8 publikacji', 'paczki bez kosztów produktu'], range_low: 38000, range_high: 48000,
}) }] }]);
await page.goto(`${APP}#/projekty`);
await page.locator('.cards.only-narrow .pcard-full:has-text("Premiera serum")').click();
await page.waitForSelector('.tabs');
await page.screenshot({ path: `${shots}/52-projekt-przeglad.png`, fullPage: true });
await page.locator('.tab:has-text("Wycena")').click();
await page.locator('button:has-text("Zaproponuj cenę (AI)")').click();
await page.waitForSelector('.ai-proposal', { timeout: 20000 });
ok((await page.locator('.ai-proposal').textContent()).replace(/\s/g, ' ').includes('38 000'), 'propozycja z zakresem cen');
await page.screenshot({ path: `${shots}/53-wycena-ai.png`, fullPage: true });
await page.locator('button:has-text("Zastosuj")').click();
await page.waitForTimeout(800);
ok(await page.locator('.price-item').count() === 3, 'pozycje wstawione do wyceny');
const grand = await page.locator('.tot-row.grand').textContent();
ok(grand.replace(/\s/g, '').includes('48892,50'), `brutto = (8000 + 15×250 + 8×3500) × 1,23 = 48 892,50 → ${grand.trim()}`);
await page.locator('.price-item').nth(1).locator('.pi-price').fill('300');
await page.waitForTimeout(900);
ok((await page.locator('.tot-row.grand').textContent()).replace(/\s/g, '').includes('49815,00'), 'edycja ceny przelicza sumy (15×300)');
await page.screenshot({ path: `${shots}/54-wycena.png`, fullPage: true });
await page.reload();
await page.waitForSelector('.lock-input');
await page.locator('.lock-input').fill('momenty2026');
await page.locator('.brand-form button[type=submit]').click();
await page.waitForSelector('.price-item');
ok(await page.locator('.price-item').nth(1).locator('.pi-price').inputValue() === '300', 'wycena zapisana');

step('Umowa (szablon i AI)');
await page.locator('.tab:has-text("Wycena")').click();
await page.locator('.btn:has-text("Przygotuj umowę")').click();
await page.waitForSelector('.sheet:has-text("Umowa do projektu")');
await page.screenshot({ path: `${shots}/55-umowa-opcje.png` });
await page.locator('.sheet-foot button:has-text("Z szablonu")').click();
await page.waitForSelector('.page-narrow .out-body');
const contract = await page.locator('.out-body').inputValue();
ok(contract.includes('UMOWA O ŚWIADCZENIE USŁUG') && contract.includes('Prawa autorskie') && contract.includes('w Warszawie') && /49\s?815/.test(contract), 'umowa z szablonu z kwotą z wyceny (49 815 zł brutto)');
ok(contract.includes('[uzupełnij: NIP agencji]'), 'brakujące dane oznaczone [uzupełnij]');
ok(await page.locator('.notice:has-text("Projekt umowy")').count() === 1, 'ostrzeżenie: sprawdzić przed podpisaniem');
await page.screenshot({ path: `${shots}/56-umowa.png`, fullPage: true });
await script([{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'UMOWA O ŚWIADCZENIE USŁUG\n§ 1. Przedmiot umowy\n(tekst z AI)' }] }]);
await page.goBack();
await page.waitForSelector('.tabs');
await page.locator('.tab:has-text("Wycena")').click();
ok(await page.locator('.list-row:has-text("Umowa")').count() >= 1, 'umowa widoczna przy wycenie projektu');
await page.locator('.btn:has-text("Nowa wersja umowy")').click();
await page.locator('.sheet-foot button:has-text("Napisz z AI")').click();
await page.waitForSelector('.page-narrow .out-body', { timeout: 20000 });
ok((await page.locator('.out-body').inputValue()).includes('(tekst z AI)'), 'umowa napisana przez AI');
const cprompt = (await mockLog()).filter((l) => l.path === '/v1/messages').map((l) => JSON.parse(l.body)).at(-1);
ok(JSON.stringify(cprompt.messages).includes('Premiera serum') && /40\s500/.test(JSON.stringify(cprompt.messages).replace(/\\u00a0/g, ' ')), 'AI dostało dane projektu i wyceny (40 500 zł netto)');

step('Pismo z AI – inne dla każdej firmy');
await script([{ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ subject: 'Nowe serum Atelier Lumière – temat dla Magazynu Styl', body: 'Dzień dobry,\n\nobserwujemy działy beauty…\n\nZ poważaniem,\nKasia' }) }] }]);
await page.goto(`${APP}#/asystent/pismo`);
await page.waitForSelector('.out-body');
await page.locator('.field:has-text("Do kogo") select').selectOption({ label: 'Anna Lewandowska (dziennikarz / media)' });
await page.locator('#content button:has-text("Napisz z AI")').click();
await page.waitForFunction(() => document.querySelector('.out-subject')?.value.includes('Magazynu Styl'), null, { timeout: 20000 });
ok(true, 'pismo wygenerowane przez AI');
const lprompt = (await mockLog()).filter((l) => l.path === '/v1/messages').map((l) => JSON.parse(l.body)).at(-1);
const ltext = JSON.stringify(lprompt.messages);
ok(ltext.includes('Nie powtarzaj') && ltext.includes('Styl tego listu'), 'AI dostało instrukcję unikania powtórzeń i styl dla tej firmy');
ok(lprompt.output_config?.format?.type === 'json_schema', 'odpowiedź w ustrukturyzowanym JSON');
await page.screenshot({ path: `${shots}/57-pismo-ai.png`, fullPage: true });

step('Kalendarz Google – połączenie i wysyłka zadań');
await page.goto(`${APP}#/ustawienia/polaczenia`);
await page.locator('.set-row:has-text("Kalendarz Google")').click();
await page.waitForSelector('.sheet a:has-text("Otwórz i zatwierdź")');
const gHref = await page.locator('.sheet a:has-text("Otwórz i zatwierdź")').getAttribute('href');
ok(gHref.includes('/google/auth?') && gHref.includes('access_type=offline'), 'link logowania Google');
await page.screenshot({ path: `${shots}/58-google-polacz.png` });
await page.locator('.sheet a:has-text("Otwórz i zatwierdź")').click();
const state = new URL(gHref).searchParams.get('state');
await fetch(`${SUPA}/functions/v1/google/callback?code=good-code&state=${state}`); // what Google does after approval
await page.waitForSelector('text=Kalendarz Google: połączono', { timeout: 15000 });
await page.waitForTimeout(2500);
const gEvents = await (await fetch(`${MOCK}/__google/events`)).json();
ok(gEvents.some((e) => e.summary === 'Zadzwonić do Magazynu Styl' && e.reminders.overrides.length > 0), `zadania w Kalendarzu Google z przypomnieniami (${gEvents.length} wydarzeń)`);
ok(!gEvents.some((e) => e.summary === 'Akceptacja menu degustacyjnego z szefem kuchni'), 'zadania drugiej osoby nie trafiają do mojego kalendarza');

step('Canva – połączenie, przeglądanie i import do projektu');
await page.goto(`${APP}#/ustawienia/polaczenia`);
await page.locator('.set-row:has-text("Canva")').first().click();
await page.waitForSelector('.sheet a:has-text("Otwórz i zatwierdź")');
const cHref = await page.locator('.sheet a:has-text("Otwórz i zatwierdź")').getAttribute('href');
await page.locator('.sheet a:has-text("Otwórz i zatwierdź")').click();
await fetch(`${SUPA}/functions/v1/canva/callback?code=canva-code&state=${new URL(cHref).searchParams.get('state')}`);
await page.waitForSelector('text=Canva: połączono', { timeout: 15000 });
await page.goto(`${APP}#/projekty`);
await page.locator('.cards.only-narrow .pcard-full:has-text("Premiera serum")').click();
await page.locator('.tab:has-text("Pliki")').click();
await page.locator('.upload-btn:has-text("Z Canvy")').click();
await page.waitForSelector('.canva-card');
ok(await page.locator('.canva-card').count() === 2, 'projekty z Canvy widoczne');
await page.screenshot({ path: `${shots}/59-canva.png` });
await page.locator('.canva-card:has-text("Premiera serum") button:has-text("PNG")').click();
await page.waitForSelector('.tile img', { timeout: 15000 });
ok(await page.locator('.tile-cap:has-text("Post – Premiera serum")').count() === 1, 'grafika z Canvy zaimportowana do projektu');
ok(await page.locator('.list-row:has-text("Post – Premiera serum") a:has-text("Edytuj")').count() === 1, 'link „Edytuj w Canvie” zapisany w projekcie');
await page.screenshot({ path: `${shots}/60-projekt-pliki.png`, fullPage: true });
await page.waitForTimeout(800);
const editHref = await page.locator('.list-row:has-text("Post – Premiera serum") a:has-text("Edytuj w Canvie")').getAttribute('href');
ok(editHref.startsWith('https://www.canva.com/api/design/fresh/edit') && editHref.includes('correlation_state='), 'link do edycji w Canvie (świeży, z powrotem do projektu)');
const projectId = page.url().match(/projekt\/([^?]+)/)[1];
const retState = Buffer.from(JSON.stringify({ p: projectId })).toString("base64url");
const before = await page.locator('.tile').count();
await page.goto(`${APP}#/canva-powrot?design=DAF1&s=${retState}`);
await page.waitForSelector('text=Zaktualizowano z Canvy', { timeout: 15000 }).then(() => ok(true, 'powrót z Canvy pobiera nową wersję grafiki')).catch(() => ok(false, 'powrót z Canvy pobiera nową wersję grafiki'));
ok(page.url().includes(`projekt/${projectId}`) && (await page.locator('.tile').count()) === before, 'grafika zaktualizowana (bez duplikatu)');

step('Asystent na ekranie projektu – jedno stuknięcie');
await page.goto(`${APP}#/projekt/${projectId}`);
await page.waitForSelector('.ai-strip');
await script([
  { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tu_p', name: 'propose_pricing', input: { project_id: projectId } }] },
  { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Otwieram wycenę.' }] },
  { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ items: [{ name: 'Koordynacja kampanii', qty: 1, unit: 'ryczałt', unit_price: 9000, note: '' }], summary: 'Wycena z kontekstu projektu.', assumptions: [], range_low: 9000, range_high: 12000 }) }] },
]);
await page.locator('.ai-chip:has-text("Zaproponuj wycenę")').click();
await page.waitForSelector('.ai-proposal', { timeout: 20000 });
ok(page.url().includes('tab=pieniadze'), 'przycisk „Zaproponuj wycenę” otwiera wycenę projektu');
ok((await page.locator('.ai-proposal').textContent()).includes('Koordynacja kampanii'), 'propozycja AI gotowa do sprawdzenia');
const pcalls = (await mockLog()).filter((l) => l.path === '/v1/messages').map((l) => JSON.parse(l.body));
const firstP = JSON.stringify(pcalls.at(-3).messages);
ok(firstP.includes('biezacy_ekran') && firstP.includes('Premiera serum'), 'asystent dostał kontekst otwartego projektu');
await page.screenshot({ path: `${shots}/62-wycena-jednym-stuknieciem.png` });
await script([
  { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tu_m', name: 'prepare_mockup', input: { project_id: projectId, caption: 'Jesień pełna blasku ✨ #atelierlumiere', format: 'portrait' } }] },
  { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Makieta gotowa do podglądu.' }] },
]);
await page.goto(`${APP}#/projekt/${projectId}`);
await page.locator('.ai-chip:has-text("Makieta posta")').click();
await page.waitForSelector('.mock-canvas', { timeout: 20000 });
ok((await page.locator('.field:has-text("Opis posta") textarea').inputValue()).includes('#atelierlumiere'), 'makieta otwarta z opisem napisanym przez AI');
await page.screenshot({ path: `${shots}/63-makieta-ai.png` });

step('Instagram');
await page.goto(`${APP}#/kontakty/influencer`);
await page.locator('.icon-btn[aria-label="Szukaj na Instagramie"]').click();
await page.locator('.sheet input[type=search]').fill('@ola.beauty');
ok(await page.locator('.sheet a:has-text("Otwórz profil @ola.beauty")').getAttribute('href') === 'https://instagram.com/ola.beauty', 'otwarcie profilu po nazwie konta');
await page.locator('.sheet input[type=search]').fill('Ola Kamińska');
ok((await page.locator('.sheet a:has-text("Szukaj na Instagramie")').getAttribute('href')).includes('site%3Ainstagram.com'), 'wyszukiwanie osoby na Instagramie');
await page.screenshot({ path: `${shots}/61-instagram.png` });

console.log('\nBłędy w konsoli:', errors.length ? `\n${errors.join('\n')}` : 'brak');
if (errors.length) failures++;
await browser.close();
server.close();
console.log(failures ? `\n✗ Niepowodzenia: ${failures}` : '\n✓ Wszystkie testy przeszły');
process.exit(failures ? 1 : 0);
