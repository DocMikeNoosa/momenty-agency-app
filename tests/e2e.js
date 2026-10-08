// End-to-end test: runs the real app in Chromium on an iPhone-sized screen and a desktop screen.
// Usage: node tests/e2e.js [screenshotDir]
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

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(root, p);
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const URL_ = `http://localhost:${server.address().port}/`;

let failures = 0;
const ok = (cond, msg) => { if (cond) console.log(`  ✓ ${msg}`); else { failures++; console.log(`  ✗ ${msg}`); } };
const step = (s) => console.log(`\n▸ ${s}`);

const browser = await playwright.chromium.launch();
const errors = [];

async function addAuthenticator(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  return cdp;
}

function watch(page, label) {
  page.on('pageerror', (e) => errors.push(`[${label}] ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${label}] console: ${m.text()}`); });
}

const toastText = (page) => page.locator('.toast').last().textContent();

// ================= iPhone =================
const iphone = playwright.devices['iPhone 13'];
const ctx = await browser.newContext({ ...iphone, locale: 'pl-PL', timezoneId: 'Europe/Warsaw', acceptDownloads: true, serviceWorkers: 'allow' });
const page = await ctx.newPage();
watch(page, 'iphone');
await addAuthenticator(page);

step('Pierwsze uruchomienie');
await page.goto(URL_);
await page.waitForSelector('.brand-form');
ok(await page.locator('.brand-logo').isVisible(), 'logo widoczne');
const inputs = page.locator('.brand-form input');
await inputs.nth(0).fill('Kasia');
await inputs.nth(1).fill('Ola');
await inputs.nth(2).fill('krotkie');
await inputs.nth(3).fill('krotkie');
await page.locator('.brand-form button[type=submit]').click();
ok((await page.locator('.form-error').textContent()).includes('8 znaków'), 'walidacja zbyt krótkiego hasła');
await inputs.nth(2).fill('momenty2026');
await inputs.nth(3).fill('momenty2026');
await page.screenshot({ path: `${shots}/01-setup.png` });
await page.locator('.brand-form button[type=submit]').click();

step('Klucz dostępu (Face ID)');
await page.waitForSelector('text=Odblokowanie twarzą', { timeout: 15000 });
await page.screenshot({ path: `${shots}/02-passkey.png` });
await page.locator('button:has-text("Włącz klucz dostępu")').click();
await page.waitForSelector('text=Gotowe');
ok(true, 'klucz dostępu zarejestrowany');
await page.locator('button:has-text("Pokaż z przykładowymi danymi")').click();

step('Ekran Dziś');
await page.waitForSelector('.hero');
ok((await page.locator('.hero-title').textContent()).includes('Kasia'), 'powitanie z imieniem');
ok(await page.locator('.tabbar').isVisible(), 'dolny pasek zakładek widoczny');
ok(await page.locator('.fab').isVisible(), 'przycisk + widoczny');
ok(!(await page.locator('.sidebar').isVisible()), 'pasek boczny ukryty na telefonie');
const todayCount = await page.locator('.task').count();
ok(todayCount >= 4, `zadania na ekranie (${todayCount})`);
ok(await page.locator('.overdue').first().isVisible(), 'sekcja zaległych');
await page.screenshot({ path: `${shots}/03-dzis-iphone.png`, fullPage: true });
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
ok(overflow <= 0, `brak poziomego przewijania (${overflow}px)`);

step('Szybkie dodawanie');
await page.locator('.fab').click();
await page.waitForSelector('.qa-input');
await page.locator('.qa-input').fill('Zadzwonić do Magazynu Styl jutro o 15');
ok((await page.locator('.qa-preview').textContent()).includes('Jutro · 15:00'), 'rozpoznano „jutro o 15”');
await page.screenshot({ path: `${shots}/04-szybkie-dodawanie.png` });
await page.locator('button:has-text("Dodaj zadanie")').click();
await page.waitForTimeout(400);
ok((await toastText(page)).includes('jutro 15:00'), 'potwierdzenie dodania');
ok(await page.locator('.task:has-text("Zadzwonić do Magazynu Styl")').count() === 1, 'zadanie widoczne w „Najbliższe 7 dni”');

step('Odhaczanie i przesuwanie (swipe)');
const firstToday = page.locator('.section:has(h3:text-is("Dziś")) .task:not(.done)').first();
const title1 = (await firstToday.locator('.row-title').textContent()).replace(/^!/, '');
await firstToday.locator('.check').click();
await page.waitForTimeout(300);
ok(await page.locator(`.task.done:has-text("${title1}")`).count() === 1, `ukończono: ${title1}`);
const target = page.locator('.section:has(h3:text-is("Dziś")) .task:not(.done)').first();
const title2 = await target.locator('.row-title').textContent();
const box = await target.boundingBox();
await page.evaluate(({ x, y }) => {
  const el = document.elementFromPoint(x, y).closest('.swipe-front');
  const ev = (type, cx) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 7, pointerType: 'touch', clientX: cx, clientY: y }));
  ev('pointerdown', x); for (let i = 1; i <= 10; i++) ev('pointermove', x - i * 15); ev('pointerup', x - 150);
}, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
await page.waitForTimeout(400);
ok((await toastText(page)).includes('jutro'), `przesunięto na jutro: ${title2}`);

step('Edycja zadania i Kalendarz Google');
await page.locator('.task .row-main').first().click();
await page.waitForSelector('.sheet');
const gcal = await page.locator('.sheet a:has-text("Kalendarza Google")').getAttribute('href').catch(() => null);
ok(gcal && gcal.startsWith('https://calendar.google.com/calendar/render?action=TEMPLATE'), 'link do Kalendarza Google');
ok((await page.locator('.sheet .hint-line').first().textContent()).includes('Przypomnienia'), 'informacja o przypomnieniach');
await page.screenshot({ path: `${shots}/05-zadanie.png` });
await page.locator('.sheet-foot button:has-text("Anuluj")').click();
await page.waitForTimeout(300);

step('Projekty');
await page.locator('.tabbar .nav-item[data-tab=projekty]').click();
await page.waitForSelector('.pcard-full');
ok(await page.locator('.cards.only-narrow .pcard-full').count() === 2, 'dwa projekty w toku');
await page.screenshot({ path: `${shots}/06-projekty-iphone.png`, fullPage: true });
await page.locator('.cards.only-narrow .pcard-full:has-text("Premiera serum")').click();
await page.waitForSelector('.stepper');
await page.locator('.step:has-text("Raport")').click();
await page.waitForTimeout(300);
ok((await page.locator('.step.now').textContent()).includes('Raport'), 'zmiana etapu projektu');
await page.locator('.tab:has-text("Zadania")').click();
await page.locator('button:has-text("Nowe zadanie")').click();
await page.waitForSelector('.sheet input');
await page.locator('.sheet .field:has-text("Zadanie") input').fill('Zebrać statystyki publikacji');
await page.locator('.sheet-foot .btn-primary').click();
await page.waitForTimeout(400);
ok(await page.locator('.task:has-text("Zebrać statystyki publikacji")').count() === 1, 'dodano zadanie do projektu');
await page.screenshot({ path: `${shots}/07-projekt-iphone.png`, fullPage: true });
await page.locator('.back-btn').click();
await page.waitForTimeout(300);
ok(page.url().endsWith('#/projekty'), 'przycisk wstecz');

step('Kontakty');
await page.locator('.tabbar .nav-item[data-tab=kontakty]').click();
await page.waitForSelector('.seg-scroll');
await page.locator('.seg-btn:has-text("Influencerzy")').click();
await page.waitForSelector('.list-row:has-text("Ola Kamińska")');
await page.locator('.list-row:has-text("Ola Kamińska")').click();
await page.waitForSelector('.quick-actions');
ok(await page.locator('.qa:has-text("Instagram")').getAttribute('href') === 'https://instagram.com/ola.beauty', 'link do Instagrama');
ok((await page.locator('.facts').textContent()).includes('184 tys.') || (await page.locator('.facts').textContent()).includes('184'), 'liczba obserwujących');
await page.screenshot({ path: `${shots}/08-influencer.png`, fullPage: true });
await page.locator('.tabbar .nav-item[data-tab=kontakty]').click();
await page.locator('.top-actions .btn-primary').click();
await page.waitForSelector('.sheet');
await page.locator('.sheet .seg-btn:has-text("Media")').click();
await page.locator('.sheet .field:has-text("Imię i nazwisko") input').first().fill('Tomasz Wójcik');
await page.locator('.sheet .field:has-text("Redakcja") input').fill('Gazeta Biznesowa');
await page.locator('.sheet .field:has-text("E-mail") input').fill('tomasz@example.com');
await page.locator('.sheet-foot .btn-primary').click();
await page.waitForSelector('.detail-title:has-text("Tomasz Wójcik")');
ok(true, 'dodano dziennikarza');

step('Pliki (zdjęcie)');
await page.locator('.tabbar .nav-item[data-tab=pliki]').click();
await page.waitForSelector('.upload-bar');
const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.upload-btn:has-text("Dodaj pliki")').click()]);
await chooser.setFiles(path.join(root, 'assets/icons/icon-512.png'));
await page.waitForSelector('.tile img', { timeout: 10000 });
ok(await page.locator('.tile').count() === 1, 'zdjęcie zapisane z miniaturą');
await page.locator('.tile').first().click();
await page.waitForSelector('.viewer-img');
await page.locator('.sheet .field:has-text("Opis") input').fill('Logo do makiety');
await page.locator('.sheet-foot .btn-primary').click();
await page.waitForTimeout(400);
ok((await page.locator('.tile-cap').first().textContent()) === 'Logo do makiety', 'opis zdjęcia zapisany');
await page.screenshot({ path: `${shots}/09-pliki.png` });

step('Asystent – pismo');
await page.locator('.tabbar .nav-item[data-tab=asystent]').click();
await page.locator('.tool-card:has-text("Napisz pismo")').click();
await page.waitForSelector('.out-body');
await page.locator('.field:has-text("Rodzaj pisma") select').selectOption('brief');
await page.locator('.field:has-text("Odbiorca") select').selectOption({ label: 'Ola Kamińska (influencer)' });
await page.locator('.field:has-text("Marka / klient") select').selectOption({ label: 'Atelier Lumière' });
await page.locator('.field:has-text("Temat") input').first().fill('Premiera serum jesiennego');
await page.locator('.field:has-text("Szczegóły") textarea').fill('1 post w feedzie\n3 relacje');
const body = await page.locator('.out-body').inputValue();
ok(body.includes('Atelier Lumière') && body.includes('• 1 post w feedzie') && body.includes('Naturalne składniki'), 'brief z danymi klienta i przekazami');
ok(body.includes('Kasia'), 'podpis nadawcy');
await page.screenshot({ path: `${shots}/10-pismo.png`, fullPage: true });
await page.locator('.sticky-actions .btn-primary:has-text("Zapisz")').click();
await page.waitForSelector('.page-narrow .out-body');
ok(page.url().includes('#/dokument/'), 'dokument zapisany');

step('Asystent – makieta');
await page.goto(`${URL_}#/asystent/makieta`);
await page.waitForSelector('.mock-thumb:not(.add)');
await page.locator('.mock-thumb:not(.add)').first().click();
await page.locator('.field:has-text("Opis posta") textarea').fill('Nowe serum już jest! #atelierlumiere #pielęgnacja');
await page.waitForTimeout(600);
const drawn = await page.evaluate(() => {
  const c = document.querySelector('.mock-canvas');
  const d = c.getContext('2d').getImageData(c.width / 2, 300, 1, 1).data;
  return { w: c.width, h: c.height, px: [...d] };
});
ok(drawn.w === 1080 && drawn.h > 1350, `makieta 4:5 narysowana (${drawn.w}×${drawn.h})`);
await page.screenshot({ path: `${shots}/11-makieta.png`, fullPage: true });
await page.locator('.sticky-actions .btn-primary:has-text("Zapisz w plikach")').click();
await page.waitForTimeout(600);
ok((await toastText(page)).includes('Makieta zapisana'), 'makieta zapisana w plikach');

step('Ustawienia – kopia i kalendarz');
await page.goto(`${URL_}#/ustawienia`);
await page.waitForSelector('.set-group');
const [dl1] = await Promise.all([page.waitForEvent('download'), page.locator('.set-row:has-text("Pobierz pełną kopię")').click()]);
const backupPath = path.join(shots, 'kopia.json');
await dl1.saveAs(backupPath);
const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
ok(backup.app === 'momenty-agency' && backup.records.length > 10 && backup.blobs.length >= 2, `kopia zawiera ${backup.records.length} wpisów i ${backup.blobs.length} plików`);
const [dl2] = await Promise.all([page.waitForEvent('download'), page.locator('.set-row:has-text(".ics")').click()]);
const icsPath = path.join(shots, 'zadania.ics');
await dl2.saveAs(icsPath);
const ics = fs.readFileSync(icsPath, 'utf8');
ok(ics.includes('BEGIN:VEVENT') && ics.includes('BEGIN:VALARM'), `plik kalendarza (${(ics.match(/BEGIN:VEVENT/g) || []).length} wydarzeń z przypomnieniami)`);
await page.screenshot({ path: `${shots}/12-ustawienia.png`, fullPage: true });

step('Blokada i odblokowanie');
await page.locator('.set-row:has-text("Zablokuj teraz")').click();
await page.waitForSelector('.lock-input');
ok(await page.locator('.task').count() === 0, 'dane ukryte po zablokowaniu');
await page.screenshot({ path: `${shots}/13-blokada.png` });
await page.locator('button:has-text("Odblokuj kluczem dostępu")').click();
await page.waitForSelector('.tabbar', { timeout: 10000 });
ok(true, 'odblokowano kluczem dostępu (Face ID)');
await page.evaluate(() => window.dispatchEvent(new Event('lock-now')));
await page.waitForSelector('.lock-input');
await page.locator('.lock-input').fill('zlehaslo1');
await page.locator('.brand-form button[type=submit]').click();
await page.waitForFunction(() => document.querySelector('.form-error')?.textContent.includes('Nieprawidłowe'));
ok(true, 'błędne hasło odrzucone');
await page.locator('.lock-input').fill('momenty2026');
await page.locator('.brand-form button[type=submit]').click();
await page.waitForSelector('.tabbar', { timeout: 10000 });
ok(true, 'odblokowano hasłem');

step('Dane po ponownym uruchomieniu');
await page.reload();
await page.waitForSelector('.lock-input');
ok(true, 'po ponownym otwarciu aplikacja jest zablokowana');
await page.locator('.lock-input').fill('momenty2026');
await page.locator('.brand-form button[type=submit]').click();
await page.waitForSelector('.tabbar');
await page.goto(`${URL_}#/dzis`);
await page.waitForSelector('.hero');
ok(await page.locator('.task:has-text("Zadzwonić do Magazynu Styl")').count() === 1, 'dane zachowane');
const swState = await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return !!r; });
ok(swState, 'tryb offline (service worker) aktywny');

step('Tryb offline');
await page.waitForTimeout(1500);
await ctx.setOffline(true);
await page.reload();
await page.waitForSelector('.lock-input', { timeout: 10000 }).then(() => ok(true, 'aplikacja otwiera się bez internetu')).catch(() => ok(false, 'aplikacja otwiera się bez internetu'));
await ctx.setOffline(false);

// ================= Desktop =================
step('Komputer (1440×900)');
const dctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'pl-PL', timezoneId: 'Europe/Warsaw', acceptDownloads: true });
const dp = await dctx.newPage();
watch(dp, 'desktop');
await dp.goto(URL_);
await dp.waitForSelector('.brand-form');
const di = dp.locator('.brand-form input');
await di.nth(0).fill('Ola'); await di.nth(1).fill('Kasia'); await di.nth(2).fill('momenty2026'); await di.nth(3).fill('momenty2026');
await dp.locator('.brand-form button[type=submit]').click();
await dp.waitForSelector('text=Pokaż z przykładowymi danymi');
await dp.locator('button:has-text("Pokaż z przykładowymi danymi")').click();
await dp.waitForSelector('.hero');
ok(await dp.locator('.sidebar').isVisible(), 'pasek boczny widoczny');
ok(!(await dp.locator('.tabbar').isVisible()), 'dolny pasek ukryty');
await dp.waitForTimeout(400); await dp.screenshot({ path: `${shots}/20-dzis-komputer.png` });
await dp.locator('.sidebar .nav-item[data-tab=projekty]').click();
await dp.waitForSelector('.kanban');
ok(await dp.locator('.kcol').count() === 5, 'tablica kanban z 5 etapami');
const card = dp.locator('.kcol[data-stage=przygotowanie] .pcard-full').first();
await card.dragTo(dp.locator('.kcol[data-stage=akceptacja]'));
await dp.waitForTimeout(500);
ok(await dp.locator('.kcol[data-stage=akceptacja] .pcard-full').count() === 1, 'przeciągnięcie projektu do innego etapu');
await dp.screenshot({ path: `${shots}/21-projekty-komputer.png` });
await dp.keyboard.press('/');
await dp.waitForSelector('.sheet-search');
await dp.keyboard.type('lumi');
await dp.waitForTimeout(200);
ok(await dp.locator('.search-results .list-row:has-text("Atelier Lumière")').count() >= 1, 'wyszukiwanie (skrót /)');
await dp.screenshot({ path: `${shots}/22-szukaj-komputer.png` });
await dp.keyboard.press('Escape');
await dp.goto(`${URL_}#/kontakty/klient`);
await dp.waitForSelector('.list-row');
await dp.locator('.list-row:has-text("Atelier Lumière")').click();
await dp.waitForSelector('.contact-head');
await dp.screenshot({ path: `${shots}/23-klient-komputer.png` });
await dp.goto(`${URL_}#/asystent/pismo`);
await dp.waitForSelector('.out-body');
await dp.screenshot({ path: `${shots}/24-pismo-komputer.png` });

// dark mode check on phone
step('Tryb ciemny');
const dkctx = await browser.newContext({ ...iphone, colorScheme: 'dark', locale: 'pl-PL' });
const dk = await dkctx.newPage();
watch(dk, 'dark');
await dk.goto(URL_);
await dk.waitForSelector('.brand-form');
const dki = dk.locator('.brand-form input');
await dki.nth(0).fill('Kasia'); await dki.nth(1).fill('Ola'); await dki.nth(2).fill('momenty2026'); await dki.nth(3).fill('momenty2026');
await dk.locator('.brand-form button[type=submit]').click();
await dk.locator('button:has-text("Pokaż z przykładowymi danymi")').click();
await dk.waitForSelector('.hero');
await dk.screenshot({ path: `${shots}/30-dzis-ciemny.png`, fullPage: true });
ok(true, 'zrzut w trybie ciemnym');

console.log('\nBłędy w konsoli:', errors.length ? `\n${errors.join('\n')}` : 'brak');
if (errors.length) failures++;
await browser.close();
server.close();
console.log(failures ? `\n✗ Niepowodzenia: ${failures}` : '\n✓ Wszystkie testy przeszły');
process.exit(failures ? 1 : 0);
