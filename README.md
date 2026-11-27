# FO Training & OJT App

A working scaffold of the product described in *FO Training and OJT App — Product
Requirements Blueprint V3*. Plain JavaScript throughout (no TypeScript) — Express +
SQLite on the backend, React (Vite) on the frontend.

## What's implemented

- **Roles & permissions**: FO / Trainer / Supervisor / Admin, matching the capability
  table in the blueprint.
- **OJT**: 5-day checklist seeded from Appendix A, sub-check ticking, day locking
  (Day *n+1* stays locked until Day *n* is approved), submit → trainer/supervisor
  review → Approve / Needs redo (max 2 redos), Day-5 approval → Eligible for
  Production, manual stage transition.
- **Updates & quizzes**: publish with per-language files + quiz questions, audience
  targeting (all / city / specific FOs), the full loop (open → acknowledge → quiz
  → score/pass-fail), 72-hour deadline with overdue tracking, revise-and-reset,
  standalone quizzes, retraining + hold/release-hold.
- **Content library**: topic/search, per-language files with English fallback.
- **Dashboards**: FO's own view, team/trainer OJT overview, team analytics (open
  rate, pass rate, who's late, most-missed questions), separate OJT/Production
  leaderboards, CSV export, audit log.
- **Notifications**: in-app (new update, reminders, OJT submitted, re-quiz failed,
  eligibility).
- **Cross-app basics**: large-type/outdoor-readable layout, 5-language selector
  groundwork (en/hi/kn/te/mr), audit trail on every approval/move/publish action.

## Open decisions from the blueprint (not resolved here — flagged in the code)

These are called out as **[OPEN]** in the document itself, so the code takes a
reasonable placeholder and flags it rather than silently deciding for you:

- **FO sign-in** (no company email): implemented as mobile number + OTP. No real
  SMS gateway is wired up — the OTP is printed to the server console and also
  returned in the API response (`dev_code`) so you can test without SMS. Swap
  `sendOtpViaSms()` in `backend/routes/auth.js` for a real provider later.
- **Overdue behavior** after the 72-hour deadline: the app marks the item
  `overdue` and surfaces it on dashboards; it does **not** block app access,
  since "no replacement blocking behavior was confirmed."
- **Quiz analytics** (average score, pass rate, most-missed questions): computed
  as a best-effort default — confirm this is actually wanted before relying on it.
- **New hire required fields**, **FO identity checks**, **dashboard permission
  parity** beyond confirmed history access: left as-is / simplest interpretation;
  search `[OPEN]` in the backend route files.

## Running it locally

Requires Node.js 18+.

```bash
# 1. Backend
cd backend
npm install
npm run seed     # creates the 5-day checklist + sample accounts
npm start         # http://localhost:4000

# 2. Frontend (separate terminal)
cd frontend
npm install
npm run dev        # http://localhost:5173
```

Sign in with one of the seeded mobile numbers — the OTP is printed in the
backend terminal and also shown on screen (since there's no SMS gateway yet):

| Role       | Mobile number |
|------------|---------------|
| Admin      | 9000000001    |
| Trainer    | 9000000002    |
| Supervisor | 9000000003    |
| FO         | 9000000004    |

As Admin, use **Admin → Add new hire** to add real FOs. As Trainer/Supervisor,
use **Publish Update** to push an update or standalone quiz, and **OJT Overview**
to review submitted days.

## Project layout

```
backend/
  db/schema.sql      SQLite schema (one table per concept in the blueprint)
  routes/            auth, users, ojt, updates, library, dashboard
  seed.js            seeds the Appendix A checklist + sample accounts
  server.js          Express app entry point
frontend/
  src/pages/         one page per screen (FO dashboard, checklist, quiz, admin, …)
  src/api.js         thin fetch wrapper over the backend API
```

## Notes / next steps

- File uploads aren't implemented — update/library "files" are just URLs for now
  (paste a link to wherever the PDF/video/slide actually lives). Wire up real
  storage (S3, etc.) when ready.
- SQLite is fine for development; swap `better-sqlite3` for Postgres when you're
  ready to deploy multi-instance.
- The 72-hour-overdue sweep (`POST /api/updates/sweep-overdue`) is exposed as an
  endpoint rather than a cron job — call it from a scheduler, or wire up
  `node-cron` in `server.js`.
