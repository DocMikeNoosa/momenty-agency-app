# Momenty Agency app – setup guide

This guide is for the **admin** (one-time setup, about 45–60 minutes). The partner never has to do any of this –
she only opens an invite link.

What you will set up:

| Part | What it gives you | Cost |
|---|---|---|
| **Hosting** (GitHub Pages) | The app's web address, installable on iPhone / Mac / PC – no App Store | Free |
| **Supabase** | Login, private sync between both partners, photo storage, backups, server functions | Free plan to start; Pro plan adds daily backups (check supabase.com/pricing) |
| **Anthropic API key** | The AI assistant, AI letters, price suggestions, contracts | Pay per use (check console.anthropic.com) |
| **Google Cloud** (optional) | Tasks appear automatically in each person's Google Calendar with reminders | Free |
| **Canva developer integration** (optional) | Browse / import / create Canva designs from inside the app | Free; see the Canva note below |

> **Privacy:** the GitHub repository contains only the app's code. It contains **no data, no passwords and no keys**.
> Anyone can install the code, but they get an empty app. Agency data lives only in *your* Supabase project, and the
> database only lets in accounts that redeemed an invite created by an admin (this is enforced by the database itself
> and covered by automated tests).

---

## 1. Put the app online (GitHub Pages)

1. In the GitHub repository: **Settings → Pages**.
2. *Source*: **Deploy from a branch**, Branch: **main**, folder **/ (root)** → **Save**.
3. After a minute the address appears, e.g. `https://docmikenoosa.github.io/momenty-agency-app/`.
   This is the app's address – use it everywhere below as **APP_URL**.

(Netlify or Cloudflare Pages work the same way if you prefer: "import from GitHub", no build command, publish directory `/`.)

## 2. Create the Supabase project

1. Go to **supabase.com** → sign up → **New project**. Name: `momenty-agency`, region: **Central EU (Frankfurt)**
   (closest to Warsaw). Save the database password somewhere safe.
2. **SQL Editor → New query** → paste the whole file [`supabase/schema.sql`](supabase/schema.sql) → **Run**.
   It should finish without errors (a few "does not exist, skipping" notices are normal).
3. **Authentication → Sign In / Providers → Email**: keep it enabled.
   *Recommended:* turn **off "Confirm email"** (only people with an invite can get access anyway).
   If you keep it on, each person must click the link in Supabase's e-mail before the first sign-in.
4. **Authentication → URL Configuration → Site URL**: set to **APP_URL**.
5. **Project Settings → API** (or *API Keys*): note the **Project URL** and the **anon / publishable key**.
   Never use the `service_role` / `secret` key in the app.

> Supabase's free plan pauses projects after a period of inactivity and has no automatic daily backups.
> For a business, the Pro plan is worth it. Check the current terms on supabase.com/pricing.

## 3. Deploy the server functions (AI, Google Calendar, Canva)

You need a computer with **Node.js** installed (nodejs.org). In a terminal, inside the downloaded repository folder:

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF      # the "xxxx" in https://xxxx.supabase.co
npx supabase functions deploy ai --no-verify-jwt
npx supabase functions deploy google --no-verify-jwt
npx supabase functions deploy canva --no-verify-jwt
```

`--no-verify-jwt` is intentional: Google and Canva must be able to call the `/callback` addresses directly; every other
route checks the user's session and agency membership inside the function.

## 4. AI (Anthropic)

1. **console.anthropic.com** → sign up → add billing → **API Keys → Create key**.
2. Store it as a secret in Supabase (it never goes into the app or GitHub):

```bash
npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
```

Optional settings: `AI_MODEL` (default `claude-opus-5-5`), `AI_DAILY_LIMIT` (default 400 AI requests per person per day).

## 5. Google Calendar (optional, recommended)

1. **console.cloud.google.com** → create a project "Momenty Agency".
2. **APIs & Services → Library** → enable **Google Calendar API**.
3. **Google Auth Platform** (OAuth consent screen): app name *Momenty Agency*, user type **External**,
   add the scope `.../auth/calendar.events`.
4. **Audience / Publishing status**:
   - In **Testing** mode only listed test users can connect, and Google expires the connection after **7 days**
     (you would have to reconnect every week).
   - To avoid that, set the app to **In production**. Without Google's verification, each person sees a
     "Google hasn't verified this app" screen once – choose *Advanced → Go to Momenty Agency*. That is expected for a
     private two-person tool.
5. **Credentials → Create credentials → OAuth client ID → Web application**.
   *Authorized redirect URI*: `https://YOUR_PROJECT_REF.supabase.co/functions/v1/google/callback`
6. Save the client ID and secret as Supabase secrets:

```bash
npx supabase secrets set GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=...
```

In the app each person then taps **Więcej → Ustawienia → Połączenia → Kalendarz Google** once. Their own tasks and
tasks marked "Obie osoby" (both) go into **their** Google Calendar with reminders; completed tasks are removed.

## 6. Canva (optional)

1. **canva.com/developers** → *Your integrations* → **Create an integration**.
2. Scopes: `design:meta:read`, `design:content:read`, `design:content:write`, `asset:read`, `asset:write`, `profile:read`.
3. Redirect URL: `https://YOUR_PROJECT_REF.supabase.co/functions/v1/canva/callback`
4. **Return navigation** (so Canva sends you back to the app after editing): enable it and set the return URL to
   `https://YOUR_PROJECT_REF.supabase.co/functions/v1/canva/return`
5. Generate the client secret, then:

```bash
npx supabase secrets set CANVA_CLIENT_ID=OC-... CANVA_CLIENT_SECRET=cnvca... PUBLIC_APP_URL=APP_URL
```

How editing works: in a project's **Pliki** tab (*Pliki i dokumenty* on a computer), **Edytuj w Canvie** opens the design in Canva's editor (you stay logged
in to Canva – the app keeps the connection on the server and refreshes it automatically). When you finish, Canva brings
you back and the new version is imported into the project. On iPhone, Canva opens outside the home-screen app; when you
switch back to the app it shows **„Pobierz nową wersję”** – one tap updates the graphic.
Canva's documented way for outside apps is this round trip ("return navigation"); I am not aware of a supported way to embed Canva's editor inside another app's screen.

**Canva's rules (please read):** a *private* integration (only for your team, no review) requires a **Canva Enterprise**
plan. Otherwise you create a *public* integration; while it is in draft Canva allows it for development/testing, and
making it available to more people requires Canva's review. If this route is not possible, the app still works with
Canva **without** the integration: paste a Canva design link into a project (opens Canva for editing) and import
exported PNG/PDF files.

## 7. Connect the app and invite your partner

1. On the admin's phone or computer open **APP_URL**, set up the app (name, password), then
   **Więcej → Ustawienia → Zespół i synchronizacja → Połącz z serwerem agencji**:
   paste the Project URL and anon/publishable key, choose **Nowa agencja**, enter your e-mail and a password.
   Everything already on the device is uploaded.
2. **Zaproś osobę do agencji** → name → role (*Administrator* for the second partner) → **Utwórz zaproszenie** →
   send the link (WhatsApp / SMS). It works once and expires after 7 days.
3. The partner, on her iPhone:
   1. opens the link in **Safari**, taps **Share → Add to Home Screen** (this installs the app – no App Store),
   2. opens the app from the home screen, taps **Mam zaproszenie do agencji**, pastes the link,
      creates her account → all agency data downloads, and from then on everything syncs both ways.

> On iPhone the home-screen app keeps its own storage, separate from Safari – that is why the join step is done inside
> the installed app.

## Everyday notes

- **Sync**: automatic (every 30 s while open, right after changes, and when the app comes back to the foreground).
  The round icon in the top bar shows the status; tap it to sync now. Works offline – changes are sent later.
- **Dictation**: in the iPhone home-screen app, use the microphone on the keyboard (Apple does not allow
  in-browser speech recognition there). On a computer, the 🎙 button in the assistant works in Chrome/Edge/Safari.
- **The ✦ Asystent button** (middle of the bottom bar on iPhone, top of the sidebar on a computer) is on every screen.
  On a project or contact it already knows which one you mean – e.g. tap *E-mail do klienta: postęp* or *Zaproponuj wycenę*.
- **Instagram**: Instagram has no public API for looking up arbitrary people, so the app opens the profile when the
  account name is known, or a web search limited to instagram.com.
- **Contracts** generated by the app are drafts – check them (ideally with a lawyer) before signing.
- **AI prices** are estimates – review them before sending an offer.
- **Removing access**: Więcej → Ustawienia → Zespół i synchronizacja → bin icon next to a person (admins only).
- **Updates**: after changing the code, bump `VERSION` in `sw.js`; phones show "Dostępna jest nowa wersja → Odśwież".
