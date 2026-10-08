# Momenty Agency – app

A private, phone-first web app (PWA) for Momenty Agency: daily dashboard, projects, clients,
influencers, media contacts, files and photos, a letter generator and Instagram post mock-ups.
The interface is in Polish.

## Works on
- **iPhone / iPad**: open the address in Safari → Share → **Add to Home Screen**. It then opens full-screen like an app, works offline and unlocks with Face ID.
- **Mac / Windows**: any modern browser (Chrome, Edge, Safari). In Chrome/Edge you can also choose "Install app".

## Features (version 1)
- **Dziś (Today)**: overdue, today, next 7 days, projects in progress, clients needing attention, activity feed. Filter: mine / partner / all.
- **Quick add (+)**: type naturally, e.g. "Zadzwonić do Magazynu Styl jutro o 15". Dates like *dziś, jutro, w piątek, 12.10, za 3 dni, o 15, 15:30* are recognised.
- **Swipe** a task right = done, left = move to tomorrow.
- **Projekty**: stages (Planowanie → … → Zakończony), progress from tasks, files, influencers, documents. Kanban board with drag-and-drop on computers.
- **Kontakty**: clients, influencers (followers, engagement, rates, rating), media, partners/suppliers. One-tap call / SMS / e-mail / Instagram / TikTok.
- **Pliki**: take a photo or upload files; attach them to a client or project. Large photos are resized to 2560 px.
- **Asystent**: 8 Polish letter templates (pitch, press release, follow-up, influencer brief, invitation, thank-you, offer, client status report) filled with client/project data; copy, e-mail, share, PDF. Instagram post/story mock-up (1:1, 4:5, 9:16) exported as PNG.
- **Google Calendar**: "Dodaj do Kalendarza Google" on every dated task, plus an `.ics` export of all upcoming tasks with reminders chosen per task type.
- **Security**: password (PBKDF2-SHA-256, 310 000 iterations, lock-out after 5 wrong tries) and passkeys (Face ID / Touch ID / Windows Hello, signatures verified with WebCrypto). Auto-lock after inactivity (1–60 min).
- **Backups**: JSON backup with or without photos, restore (newest change wins).
- Light and dark mode.

## Current limitations (honest)
- Data is stored **on each device** (IndexedDB). The two partners do not see each other's changes yet – sync comes in version 2 (Supabase). Until then, use backups.
- Data on the device is protected by the app lock, but is not encrypted at rest by the app itself (the phone's own encryption applies).
- "AI" letters are templates; free-form AI writing comes in version 2.
- Google Calendar: tasks are added via a pre-filled link or an `.ics` import, not automatic two-way sync (version 2).

## Hosting
The app is static files – any HTTPS host works (HTTPS is required for passkeys and offline mode):
Netlify, Cloudflare Pages or Vercel (free plans support private GitHub repos), or GitHub Pages.
After each release, bump `VERSION` in `sw.js` so phones get the update ("Odśwież" prompt).

## Development
```
npm start          # http://localhost:8080
npm test           # unit tests + end-to-end tests in Chromium (iPhone 13 + desktop)
```
No build step and no runtime dependencies. Fonts (Inter, Michroma, Cormorant Garamond) are bundled under the SIL Open Font License.
