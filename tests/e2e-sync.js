// End-to-end: two partners pair through an invite link and sync data and photos; a stranger gets nothing.
// Needs the local backend: tests/backend/start.sh
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
const watch = (p, l) => { p.on('pageerror', (e) => errors.push(`[${l}] ${e.message}`)); p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`[${l}] ${m.text()}`); }); };
const stamp = Date.now();

const browser = await playwright.chromium.launch();

async function localSetup(page, me, other) {
  await page.goto(APP);
  await page.waitForSelector('.brand-form');
  const i = page.locator('.brand-form input');
  await i.nth(0).fill(me); await i.nth(1).fill(other); await i.nth(2).fill('momenty2026'); await i.nth(3).fill('momenty2026');
  await page.locator('.brand-form button[type=submit]').click();
}

async function skipTour(page) {
  await page.waitForSelector('.tour', { timeout: 5000 }).then(() => page.locator('.sheet [aria-label=Zamknij]').first().click()).catch(() => {});
  await page.waitForTimeout(400);
}

// ---------------- Admin on a computer
step('Administratorka łączy aplikację z serwerem i tworzy agencję');
const actx = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'pl-PL', timezoneId: 'Europe/Warsaw' });
const A = await actx.newPage(); watch(A, 'admin');
await localSetup(A, 'Kasia', 'Ola');
await A.locator('button:has-text("Pokaż z przykładowymi danymi")').click();
await A.waitForSelector('.hero');
await skipTour(A);
await A.goto(`${APP}#/ustawienia/zespol`);
await A.locator('.set-row:has-text("Połącz z serwerem agencji")').click();
await A.locator('.sheet .field:has-text("Adres serwera") input').fill(SUPA);
await A.locator('.sheet .field:has-text("Klucz publiczny") input').fill(ANON);
await A.locator('.sheet .field:has-text("E-mail") input').fill(`kasia-${stamp}@example.com`);
await A.locator('.sheet .field:has-text("Hasło do konta") input').fill('Momenty-2026');
await A.locator('.sheet-foot button:has-text("Połącz")').click();
await A.waitForSelector('text=Połączono – synchronizacja włączona', { timeout: 20000 });
await A.waitForSelector('.set-row:has-text("Zaproś osobę")');
ok(true, 'agencja utworzona, synchronizacja włączona');
await A.waitForTimeout(1500);
await A.screenshot({ path: `${shots}/40-admin-zespol.png`, fullPage: true });

step('Zaproszenie dla partnerki');
await A.locator('.set-row:has-text("Zaproś osobę")').click();
await A.locator('.sheet-foot button:has-text("Utwórz zaproszenie")').click();
await A.waitForSelector('.invite-link', { timeout: 15000 }).catch(async (e) => { await A.screenshot({ path: `${shots}/err-invite.png` }); console.log(errors); throw e; });
const link = await A.locator('.invite-link').inputValue();
ok(/#\/dolacz\?z=/.test(link), 'link zaproszenia utworzony');
await A.screenshot({ path: `${shots}/41-zaproszenie.png` });
await A.keyboard.press('Escape');

// ---------------- Partner on an iPhone
step('Partnerka na iPhonie otwiera link i dołącza');
const bctx = await browser.newContext({ ...playwright.devices['iPhone 13'], locale: 'pl-PL', timezoneId: 'Europe/Warsaw' });
const B = await bctx.newPage(); watch(B, 'partner');
const bLink = link.replace(/^https?:\/\/[^/]+\//, APP);
await B.goto(bLink);
await B.waitForSelector('text=Dołącz do agencji');
ok((await B.locator('.invite-ok').textContent()).includes('Ola'), 'zaproszenie rozpoznane automatycznie');
ok(await B.locator('.brand-form .field:has-text("Twoje imię") input').inputValue() === 'Ola', 'imię z zaproszenia');
await B.locator('.brand-form .field:has-text("E-mail") input').fill(`ola-${stamp}@example.com`);
await B.locator('.brand-form .field:has-text("Hasło") input').first().fill('Ola-Haslo-2026');
await B.locator('.brand-form .field:has-text("Powtórz") input').fill('Ola-Haslo-2026');
await B.screenshot({ path: `${shots}/42-dolacz-iphone.png` });
await B.locator('.brand-form button[type=submit]').click();
await B.waitForSelector('.hero', { timeout: 30000 });
await skipTour(B);
ok((await B.locator('.hero-title').textContent()).includes('Ola'), 'partnerka zalogowana jako Ola');
await B.locator('.seg-btn:has-text("Wszystkie")').click();
await B.waitForTimeout(300);
ok(await B.locator('.task:has-text("Wysłać paczki PR")').count() === 1, 'dane administratorki pobrane na iPhone');
await B.screenshot({ path: `${shots}/43-partnerka-dzis.png`, fullPage: true });

step('Zmiany w obie strony');
await B.locator('.tab-ai').click();
await B.locator('#agent-input').fill('Zadzwonić do Vogue jutro o 11');
await B.locator('.sheet button:has-text("Tylko zadanie")').click(); // without AI: plain task with date parsing
await B.keyboard.press('Escape');
await B.waitForTimeout(3500); // auto-sync after local change
await A.goto(`${APP}#/dzis`);
await A.locator('.seg-btn:has-text("Wszystkie")').click();
await A.locator('.sync-dot').click();
await A.waitForTimeout(2500);
await A.locator('.seg-btn:has-text("Wszystkie")').click();
ok(await A.locator('.task:has-text("Zadzwonić do Vogue")').count() === 1, 'zadanie partnerki widoczne u administratorki');

await A.goto(`${APP}#/pliki`);
const [chooser] = await Promise.all([A.waitForEvent('filechooser'), A.locator('.upload-btn:has-text("Dodaj pliki")').click()]);
await chooser.setFiles(path.join(root, 'assets/icons/icon-512.png'));
await A.waitForSelector('.tile img');
await A.waitForTimeout(4000);
await B.locator('.sync-dot').click();
await B.waitForTimeout(2500);
await B.goto(`${APP}#/pliki`);
await B.waitForSelector('.tile', { timeout: 10000 });
await B.waitForSelector('.tile img', { timeout: 15000 }).then(() => ok(true, 'zdjęcie dodane na komputerze widoczne na iPhonie')).catch(() => ok(false, 'zdjęcie dodane na komputerze widoczne na iPhonie'));
await B.screenshot({ path: `${shots}/44-partnerka-pliki.png` });

// ---------------- Stranger
step('Obca osoba instaluje aplikację z GitHuba');
const cctx = await browser.newContext({ ...playwright.devices['iPhone 13'], locale: 'pl-PL' });
const C = await cctx.newPage(); watch(C, 'stranger');
await C.goto(bLink); // even with the (already used) invite link
await C.waitForSelector('text=Dołącz do agencji');
await C.locator('.brand-form .field:has-text("E-mail") input').fill(`obcy-${stamp}@example.com`);
await C.locator('.brand-form .field:has-text("Hasło") input').first().fill('Obcy-Haslo-2026');
await C.locator('.brand-form .field:has-text("Powtórz") input').fill('Obcy-Haslo-2026');
await C.locator('.brand-form button[type=submit]').click();
await C.waitForFunction(() => /wykorzystane|wygasło|nieprawidłowe/i.test(document.querySelector('.form-error')?.textContent || ''), null, { timeout: 15000 })
  .then(() => ok(true, 'wykorzystane zaproszenie odrzucone')).catch(() => ok(false, 'wykorzystane zaproszenie odrzucone'));
await C.screenshot({ path: `${shots}/45-obcy-odrzucony.png` });
const strangerRows = await C.evaluate(async ({ SUPA, ANON }) => {
  const s = await fetch(`${SUPA}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: document.querySelector('.brand-form input[type=email]').value, password: 'Obcy-Haslo-2026' }) }).then((r) => r.json());
  return fetch(`${SUPA}/rest/v1/records?select=*`, { headers: { apikey: ANON, Authorization: `Bearer ${s.access_token}` } }).then((r) => r.json());
}, { SUPA, ANON });
ok(Array.isArray(strangerRows) && strangerRows.length === 0, 'obca osoba z kontem nie widzi żadnych danych agencji');

console.log('\nBłędy w konsoli:', errors.length ? `\n${errors.join('\n')}` : 'brak');
if (errors.length) failures++;
await browser.close();
server.close();
console.log(failures ? `\n✗ Niepowodzenia: ${failures}` : '\n✓ Wszystkie testy przeszły');
process.exit(failures ? 1 : 0);
