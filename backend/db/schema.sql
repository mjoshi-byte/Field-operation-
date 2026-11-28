-- FO Training & OJT App — Postgres schema (for Supabase)
-- Run this in the Supabase SQL editor (or via `psql`) once, on a fresh project.
-- Mirrors the Product Requirements Blueprint V3.

-- App users. Linked to Supabase Auth's auth.users via auth_user_id once they sign in
-- with email for the first time (see backend/routes/auth.js "sync" endpoint).
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  auth_user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  mobile_number TEXT,
  city TEXT,
  preferred_language TEXT DEFAULT 'en', -- en, hi, kn, te, mr
  role TEXT NOT NULL CHECK (role IN ('fo','trainer','supervisor','admin')),
  stage TEXT CHECK (stage IN ('ojt','production')), -- only meaningful for FOs
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','on_hold','retraining')),
  hold_reason TEXT,
  held_by INTEGER REFERENCES users(id),
  held_at TIMESTAMPTZ,
  shadowing_fo_id INTEGER REFERENCES users(id),
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ===== OJT: 5-day checklist (Appendix A), editable by admin =====
CREATE TABLE IF NOT EXISTS ojt_days (
  id SERIAL PRIMARY KEY,
  day_number INTEGER NOT NULL UNIQUE,
  title TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ojt_items (
  id SERIAL PRIMARY KEY,
  day_id INTEGER NOT NULL REFERENCES ojt_days(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  title TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ojt_subchecks (
  id SERIAL PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES ojt_items(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  label TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ojt_fo_days (
  id SERIAL PRIMARY KEY,
  fo_id INTEGER NOT NULL REFERENCES users(id),
  day_id INTEGER NOT NULL REFERENCES ojt_days(id),
  status TEXT NOT NULL DEFAULT 'locked' CHECK (status IN ('locked','in_progress','submitted','approved','needs_redo')),
  redo_count INTEGER NOT NULL DEFAULT 0,
  reviewer_comment TEXT,
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  UNIQUE(fo_id, day_id)
);

CREATE TABLE IF NOT EXISTS ojt_fo_subchecks (
  id SERIAL PRIMARY KEY,
  fo_id INTEGER NOT NULL REFERENCES users(id),
  subcheck_id INTEGER NOT NULL REFERENCES ojt_subchecks(id),
  checked BOOLEAN NOT NULL DEFAULT false,
  checked_at TIMESTAMPTZ,
  UNIQUE(fo_id, subcheck_id)
);

-- ===== Updates & Quizzes =====
CREATE TABLE IF NOT EXISTS updates (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  kind TEXT NOT NULL DEFAULT 'update' CHECK (kind IN ('update','standalone_quiz')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','withdrawn')),
  pass_mark INTEGER NOT NULL DEFAULT 80,
  retakes_allowed INTEGER NOT NULL DEFAULT 1,
  audience_type TEXT NOT NULL DEFAULT 'all' CHECK (audience_type IN ('all','city','specific')),
  audience_city TEXT,
  deadline_hours INTEGER NOT NULL DEFAULT 72,
  version INTEGER NOT NULL DEFAULT 1,
  previous_version_id INTEGER REFERENCES updates(id),
  created_by INTEGER NOT NULL REFERENCES users(id),
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS update_files (
  id SERIAL PRIMARY KEY,
  update_id INTEGER NOT NULL REFERENCES updates(id) ON DELETE CASCADE,
  language TEXT NOT NULL,
  file_type TEXT NOT NULL CHECK (file_type IN ('pdf','slide','video','document','image')),
  file_url TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS update_audience (
  update_id INTEGER NOT NULL REFERENCES updates(id) ON DELETE CASCADE,
  fo_id INTEGER NOT NULL REFERENCES users(id),
  PRIMARY KEY (update_id, fo_id)
);

CREATE TABLE IF NOT EXISTS quiz_questions (
  id SERIAL PRIMARY KEY,
  update_id INTEGER NOT NULL REFERENCES updates(id) ON DELETE CASCADE,
  language TEXT NOT NULL,
  position INTEGER NOT NULL,
  question_text TEXT NOT NULL,
  options_json JSONB NOT NULL,
  correct_index INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS fo_update_status (
  id SERIAL PRIMARY KEY,
  update_id INTEGER NOT NULL REFERENCES updates(id),
  fo_id INTEGER NOT NULL REFERENCES users(id),
  opened_at TIMESTAMPTZ,
  acknowledged_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','acknowledged','passed','failed','retraining','overdue')),
  deadline_at TIMESTAMPTZ NOT NULL,
  UNIQUE(update_id, fo_id)
);

CREATE TABLE IF NOT EXISTS quiz_attempts (
  id SERIAL PRIMARY KEY,
  update_id INTEGER NOT NULL REFERENCES updates(id),
  fo_id INTEGER NOT NULL REFERENCES users(id),
  attempt_number INTEGER NOT NULL DEFAULT 1,
  score_percent INTEGER NOT NULL,
  passed BOOLEAN NOT NULL,
  answers_json JSONB,
  taken_at TIMESTAMPTZ DEFAULT now()
);

-- ===== Content library =====
CREATE TABLE IF NOT EXISTS library_items (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  topic TEXT,
  created_by INTEGER REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS library_files (
  id SERIAL PRIMARY KEY,
  library_item_id INTEGER NOT NULL REFERENCES library_items(id) ON DELETE CASCADE,
  language TEXT NOT NULL,
  file_type TEXT NOT NULL CHECK (file_type IN ('pdf','slide','video','document','image')),
  file_url TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS library_item_views (
  id SERIAL PRIMARY KEY,
  library_item_id INTEGER NOT NULL REFERENCES library_items(id) ON DELETE CASCADE,
  fo_id INTEGER NOT NULL REFERENCES users(id),
  viewed_at TIMESTAMPTZ,
  marked_by INTEGER REFERENCES users(id),
  UNIQUE(library_item_id, fo_id)
);
CREATE INDEX IF NOT EXISTS idx_library_item_views_fo ON library_item_views(fo_id);

INSERT INTO storage.buckets (id, name, public)
VALUES ('library-files', 'library-files', true)
ON CONFLICT (id) DO NOTHING;

-- ===== Notifications =====
CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  related_id INTEGER,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ===== Audit log =====
CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  actor_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  target_type TEXT,
  target_id INTEGER,
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_fo_update_status_fo ON fo_update_status(fo_id);
CREATE INDEX IF NOT EXISTS idx_ojt_fo_days_fo ON ojt_fo_days(fo_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);

-- Row Level Security: left OFF (disabled) by default here because all data access goes
-- through the Express backend using the Supabase *service role* key, which bypasses RLS.
-- If you later let the frontend talk to Supabase directly, enable RLS and add policies
-- before doing that.
