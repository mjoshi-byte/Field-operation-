# FO Training & OJT App

A working scaffold of the product described in *FO Training and OJT App — Product
Requirements Blueprint V3*. Plain JavaScript throughout (no TypeScript). Data lives in
**Supabase (Postgres)**; sign-in is **email magic link via Supabase Auth**.

## Stack

- **Backend**: Express + `pg` (talks straight to your Supabase Postgres database) + the
  Supabase Admin SDK (to verify who's signed in).
- **Frontend**: React (Vite) + `@supabase/supabase-js` (sends the magic link, holds the
  session, and is the only place that calls Supabase directly).

The frontend never touches the database directly — it calls the Express API, which
uses the Supabase **service role** key server-side. That key must never reach the
browser.

## One-time Supabase setup

1. Create a free project at [supabase.com](https://supabase.com).
2. **SQL editor** → paste the contents of `backend/db/schema.sql` → Run. This creates
   every table (users, OJT days/checklist, updates/quizzes, library, notifications,
   audit log).
3. **Authentication → Providers** → make sure **Email** is enabled. For a quick local
   demo, in **Authentication → Settings** you can turn on "Confirm email" off and
   enable magic links (they're on by default) — no SMTP setup needed since Supabase
   sends a limited number of auth emails out of the box.
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

## How sign-in & roles work

- There's no password and no OTP to manage — enter your email, Supabase emails you a
  link, click it, you're in.
- The **first time** any email signs in, the backend automatically creates a matching
  app user row (see `middleware/auth.js`). By default new accounts get the **FO** role.
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
