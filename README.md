# FO Training & OJT App

A working scaffold of the product described in *FO Training and OJT App — Product
Requirements Blueprint V3*. Plain JavaScript throughout (no TypeScript). Data lives in
**Supabase (Postgres)**; sign-in is **Google sign-in via Supabase Auth**.

## Stack

- **Backend**: Express + `pg` (talks straight to your Supabase Postgres database) + the
  Supabase Admin SDK (to verify who's signed in).
- **Frontend**: React (Vite) + `@supabase/supabase-js` (starts the Google sign-in,
  holds the session, and is the only place that calls Supabase directly).

The frontend never touches the database directly — it calls the Express API, which
uses the Supabase **service role** key server-side. That key must never reach the
browser.

## One-time Supabase setup

1. Create a free project at [supabase.com](https://supabase.com).
2. **SQL editor** → paste the contents of `backend/db/schema.sql` → Run. This creates
   every table (users, OJT days/checklist, updates/quizzes, library, notifications,
   audit log).
3. **Authentication → Providers → Google** → enable it. You'll need a Google OAuth
   Client ID + Secret:
   - In [Google Cloud Console](https://console.cloud.google.com/apis/credentials) →
     create an **OAuth client ID** (type: Web application).
   - **Authorized redirect URI**: Supabase's provider screen shows you the exact
     callback URL to paste in (looks like
     `https://xxxxxxxxxxxx.supabase.co/auth/v1/callback`) — copy it into Google
     Cloud Console's "Authorized redirect URIs".
   - **Authorized JavaScript origins**: add `http://localhost:5173` (and your real
     domain later).
   - Paste the resulting Client ID + Client Secret into Supabase's Google provider
     screen → Save.
4. **Project Settings → API** → copy:
   - `Project URL` → used as both `SUPABASE_URL` (backend) and `VITE_SUPABASE_URL` (frontend)
   - `anon public` key → `VITE_SUPABASE_ANON_KEY` (frontend only)
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (**backend only — keep secret**)
5. **Project Settings → Database → Connection string** (Connection pooling tab, URI) →
   `DATABASE_URL` (backend).

## Running it locally

```bash
# 1. Backend
cd backend
cp .env.example .env      # fill in SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL, ADMIN_EMAILS
npm install
npm run seed               # seeds the 5-day OJT checklist from Appendix A
npm start                  # http://localhost:4000

# 2. Frontend (separate terminal)
cd frontend
cp .env.example .env       # fill in VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
npm install
npm run dev                 # http://localhost:5173
```

## Deploying to Vercel

Deploy backend and frontend as **two separate Vercel projects** (they're different
runtimes: the backend is a Node serverless API, the frontend is a static SPA).

### Backend

1. Push this repo to GitHub, then in Vercel: **New Project** → import it → set **Root
   Directory** to `backend`.
2. Vercel auto-detects `vercel.json` (already in `backend/`), which routes every
   request to `api/index.js` — that file just re-exports the same Express `app` used
   locally, wrapped as a serverless function.
3. **Project Settings → Environment Variables** → add everything from
   `backend/.env.example`: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
   `DATABASE_URL`, `ADMIN_EMAILS`, and `ALLOWED_ORIGIN` (set this to your frontend's
   Vercel URL once you have it, e.g. `https://fo-training.vercel.app` — otherwise
   the browser's CORS check blocks the frontend from calling the API).
4. Deploy. Note the resulting URL, e.g. `https://fo-training-backend.vercel.app`.

### Frontend

1. **New Project** → same repo → **Root Directory** set to `frontend`.
2. Vercel auto-detects Vite (build command `npm run build`, output `dist`).
   `frontend/vercel.json` adds a rewrite so client-side routing (`/updates/5`, etc.)
   works on refresh.
3. **Environment Variables** → add `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
   (same as local), and `VITE_API_BASE` = `https://fo-training-backend.vercel.app/api`
   (your backend's URL from above, with `/api` on the end).
4. Deploy. Then go back to the **backend** project's `ALLOWED_ORIGIN` env var and set
   it to this frontend's URL (and redeploy the backend) if you hadn't already.
5. In **Google Cloud Console**, add this frontend's URL to the OAuth client's
   "Authorized JavaScript origins" (Supabase's redirect URI itself doesn't change).

Either project redeploys automatically on every push to the branch Vercel is tracking.

## How sign-in & roles work

- There's no password, OTP, or magic link to manage — click **Sign in with Google**,
  pick your Google account, you're in.
- The **first time** any Google account's email signs in, the backend automatically
  creates a matching app user row (see `middleware/auth.js`). By default new accounts
  get the **FO** role.
- Put your own email in `ADMIN_EMAILS` in `backend/.env` *before* you first sign in,
  and you'll be made **admin** automatically — that's how you bootstrap a brand-new
  project with no existing admin.
- As admin, use **Admin → Add new hire / staff** to pre-create FO/Trainer/Supervisor/
  Admin accounts by email. When that person signs in with that email for the first
  time, it links straight to the row you created (so their role/city/etc. are already
  set) instead of making a new one.

## What's implemented

- **Roles & permissions**: FO / Trainer / Supervisor / Admin, per the blueprint's
  capability table.
- **OJT**: 5-day checklist seeded from Appendix A, sub-check ticking, day locking,
  submit → review → Approve / Needs redo (max 2 redos), Day-5 → Eligible for
  Production, manual stage transition.
- **Updates & quizzes**: publish with per-language files + quiz questions, audience
  targeting (all / city / specific FOs), full loop (open → acknowledge → quiz →
  score/pass-fail), 72-hour deadline + overdue tracking, revise-and-reset, standalone
  quizzes, retraining + hold/release-hold.
- **Content library**: topic/search, per-language files with English fallback.
- **Dashboards**: FO's own view, team OJT overview, team analytics, separate
  OJT/Production leaderboards, CSV export, audit log.
- **Notifications**: in-app (new update, reminders, OJT submitted, re-quiz failed,
  eligibility).

## Open decisions from the blueprint (flagged, not silently resolved)

- **Overdue behavior** after 72 hours: marked `overdue` on dashboards; does not block
  app access (no blocking behavior was confirmed in the blueprint).
- **Quiz analytics** (avg score, pass rate, most-missed questions): a best-effort
  default — confirm before relying on it.
- **New hire required fields**, **dashboard permission parity**: left at the simplest
  interpretation — search `[OPEN]` in the backend route files.
- **FO sign-in** (blueprint notes FOs have no company email): this build uses Google
  sign-in for everyone, which assumes each FO has (or can get) a personal Google
  account. If that's not realistic for your FOs, this is the place to swap in
  something else (e.g. Supabase's phone/OTP provider) — only `Login.jsx` and the
  "FO access" line in the blueprint are affected.

## Project layout

```
backend/
  db/schema.sql      Postgres schema — run this once in Supabase's SQL editor
  db.js              pg connection pool (uses DATABASE_URL)
  middleware/auth.js  verifies the Supabase access token, auto-links/creates app users
  routes/            users, ojt, updates, library, dashboard (all async, pg-backed)
  seed.js            seeds the Appendix A checklist
  server.js          Express app entry point
frontend/
  src/supabaseClient.js  the one place that calls Supabase directly
  src/pages/Login.jsx     email magic-link screen
  src/pages/             one page per screen (FO dashboard, checklist, quiz, admin, …)
  src/api.js             fetch wrapper — attaches the Supabase session token
```

## Notes / next steps

- File uploads aren't implemented — update/library "files" are just URLs for now.
  Supabase Storage is a natural fit if you want real uploads later.
- The 72-hour-overdue sweep (`POST /api/updates/sweep-overdue`) is exposed as an
  endpoint rather than a cron job — call it on a schedule (e.g. Supabase's
  `pg_cron`, or a simple external cron hitting that URL).
- RLS (Row Level Security) is left off in `schema.sql` because all access goes through
  the backend's service-role key, which bypasses it. If you ever let the frontend talk
  to Supabase directly, turn RLS on and add policies first.
