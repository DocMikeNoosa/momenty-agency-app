# Momenty Agency – aplikacja agencji

A private, phone-first app (PWA) for **Momenty Agency** (Warsaw) – dark bordeaux glass design with glossy buttons: daily dashboard, projects with pricing and
contracts, clients / influencers / media / partners, photos and files, an AI assistant that acts on spoken or written
instructions, Google Calendar reminders, Canva and Instagram helpers. Interface in Polish.

**Setup (admin, one time): see [SETUP.md](SETUP.md).**

## Works on
- **iPhone / iPad** – Safari → Share → *Add to Home Screen*. Full screen, offline, Face ID. No App Store needed.
- **Mac / PC** – any modern browser; Chrome/Edge can also "Install app".

## Features
- **Dziś** – overdue, today, next 7 days, projects in progress, clients needing attention, activity of both partners.
- **Simple navigation** – 4 tabs (*Dziś · Projekty · Kontakty · Więcej*) and the **✦ Asystent** button on every screen:
  type or dictate anything, or add a task / project / contact / photo / letter / mock-up. Short welcome tour on first start.
- **Projects** – 3 tabs: *Przegląd* (stage, tasks, brief, influencers) · *Wycena i umowa* (line items, VAT, discount,
  AI price proposal you can edit, PDF offer, contract) · *Pliki i dokumenty* (photos, files, Canva, letters).
  One-tap AI buttons on top: e-mail to the client with the project status, price proposal, contract, Instagram mock-up,
  plan next steps, press release – the AI already knows the project, client and pricing.
- **Contacts** – clients (incl. legal data for contracts), influencers (followers, engagement, rates, rating), media,
  partners. One-tap call / SMS / e-mail / Instagram / TikTok; Instagram lookup.
- **AI assistant** – type or dictate: it creates tasks with reminders, drafts e-mails (send via Mail or Gmail),
  creates projects and contacts, updates stages, finds people on Instagram, answers "what's on today".
- **Letters** – 8 Polish templates or "Napisz z AI"; each company gets differently worded letters.
- **Contracts** – from template or AI, using project scope, pricing and both parties' data (always a draft to review).
- **Instagram post / story mock-ups** for clients (PNG).
- **Google Calendar** – each person connects once; their tasks appear with reminders matched to the task type.
- **Canva** – stay connected to Canva, edit a project's design in Canva and come back to an automatically updated graphic; import designs (PNG/PDF), create new designs.
- **Security** – password + passkeys (Face ID / Touch ID / Windows Hello), auto-lock; cloud access only for invited
  members (database row-level security); API keys only on the server.
- **Sync & backup** – two-way sync between devices, shared photo storage, JSON backups, works offline.

## Architecture
- Static PWA (no build step): `index.html`, `css/`, `js/`, `sw.js`.
- Backend: your own **Supabase** project – `supabase/schema.sql` (tables, RLS, pairing functions, storage policies)
  and Edge Functions in `supabase/functions/` (`ai`, `google`, `canva`).

## Tests
```
npm test                 # unit tests + full app test in Chromium (iPhone 13 + desktop), local mode
npm run test:backend     # starts a local Supabase-compatible backend (Postgres 16, Supabase Auth, PostgREST,
                         # the real Edge Functions on Deno, fake Google/Canva/Anthropic) and runs:
                         # security tests, two-partner pairing & sync test, AI/pricing/contract/Calendar/Canva tests
```
The backend tests need the binaries described in `tests/backend/start.sh` (Supabase Auth, PostgREST, Deno) and a
local PostgreSQL 16.
