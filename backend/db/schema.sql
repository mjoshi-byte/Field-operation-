-- FO Training & OJT App — SQLite schema
-- Mirrors the Product Requirements Blueprint V3

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  mobile_number TEXT UNIQUE NOT NULL,
  city TEXT,
  preferred_language TEXT DEFAULT 'en', -- en, hi, kn, te, mr
  role TEXT NOT NULL CHECK (role IN ('fo','trainer','supervisor','admin')),
  stage TEXT CHECK (stage IN ('ojt','production')) DEFAULT 'ojt', -- only meaningful for FOs
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','on_hold','retraining')),
  hold_reason TEXT,
  held_by INTEGER REFERENCES users(id),
  held_at TEXT,
  shadowing_fo_id INTEGER REFERENCES users(id), -- which existing FO they shadow during OJT
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);

-- Simple OTP table (FOs have no company email, sign-in is phone + OTP; product team to finalize)
CREATE TABLE IF NOT EXISTS otp_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mobile_number TEXT NOT NULL,
  code TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

-- ===== OJT: 5-day checklist (Appendix A), editable by admin =====
CREATE TABLE IF NOT EXISTS ojt_days (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day_number INTEGER NOT NULL UNIQUE, -- 1..5
  title TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ojt_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day_id INTEGER NOT NULL REFERENCES ojt_days(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  title TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ojt_subchecks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES ojt_items(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  label TEXT NOT NULL
);

-- Per-FO progress on each day
CREATE TABLE IF NOT EXISTS ojt_fo_days (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fo_id INTEGER NOT NULL REFERENCES users(id),
  day_id INTEGER NOT NULL REFERENCES ojt_days(id),
  status TEXT NOT NULL DEFAULT 'locked' CHECK (status IN ('locked','in_progress','submitted','approved','needs_redo')),
  redo_count INTEGER NOT NULL DEFAULT 0,
  reviewer_comment TEXT,
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TEXT,
  submitted_at TEXT,
  approved_at TEXT,
  UNIQUE(fo_id, day_id)
);

-- Per-FO sub-check ticks
CREATE TABLE IF NOT EXISTS ojt_fo_subchecks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fo_id INTEGER NOT NULL REFERENCES users(id),
  subcheck_id INTEGER NOT NULL REFERENCES ojt_subchecks(id),
  checked INTEGER NOT NULL DEFAULT 0,
  checked_at TEXT,
  UNIQUE(fo_id, subcheck_id)
);

-- ===== Updates & Quizzes (shared loop across OJT + Production) =====
CREATE TABLE IF NOT EXISTS updates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  kind TEXT NOT NULL DEFAULT 'update' CHECK (kind IN ('update','standalone_quiz')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','withdrawn')),
  pass_mark INTEGER NOT NULL DEFAULT 80, -- percent
  retakes_allowed INTEGER NOT NULL DEFAULT 1,
  audience_type TEXT NOT NULL DEFAULT 'all' CHECK (audience_type IN ('all','city','specific')),
  audience_city TEXT,
  deadline_hours INTEGER NOT NULL DEFAULT 72,
  version INTEGER NOT NULL DEFAULT 1,
  previous_version_id INTEGER REFERENCES updates(id),
  created_by INTEGER NOT NULL REFERENCES users(id),
  published_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Files attached to an update, per language (PDF/slide/video/doc/image)
CREATE TABLE IF NOT EXISTS update_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  update_id INTEGER NOT NULL REFERENCES updates(id) ON DELETE CASCADE,
  language TEXT NOT NULL, -- en, hi, kn, te, mr
  file_type TEXT NOT NULL CHECK (file_type IN ('pdf','slide','video','document','image')),
  file_url TEXT NOT NULL
);

-- Specific FOs targeted when audience_type = 'specific'
CREATE TABLE IF NOT EXISTS update_audience (
  update_id INTEGER NOT NULL REFERENCES updates(id) ON DELETE CASCADE,
  fo_id INTEGER NOT NULL REFERENCES users(id),
  PRIMARY KEY (update_id, fo_id)
);

CREATE TABLE IF NOT EXISTS quiz_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  update_id INTEGER NOT NULL REFERENCES updates(id) ON DELETE CASCADE,
  language TEXT NOT NULL,
  position INTEGER NOT NULL,
  question_text TEXT NOT NULL,
  options_json TEXT NOT NULL, -- JSON array of option strings
  correct_index INTEGER NOT NULL
);

-- Per-FO assignment + lifecycle for an update/standalone quiz
CREATE TABLE IF NOT EXISTS fo_update_status (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  update_id INTEGER NOT NULL REFERENCES updates(id),
  fo_id INTEGER NOT NULL REFERENCES users(id),
  opened_at TEXT,
  acknowledged_at TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','acknowledged','passed','failed','retraining','overdue')),
  deadline_at TEXT NOT NULL,
  UNIQUE(update_id, fo_id)
);

CREATE TABLE IF NOT EXISTS quiz_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  update_id INTEGER NOT NULL REFERENCES updates(id),
  fo_id INTEGER NOT NULL REFERENCES users(id),
  attempt_number INTEGER NOT NULL DEFAULT 1,
  score_percent INTEGER NOT NULL,
  passed INTEGER NOT NULL,
  answers_json TEXT, -- [{question_id, selected_index, correct}]
  taken_at TEXT DEFAULT (datetime('now'))
);

-- ===== Content library (Production phase reference material) =====
CREATE TABLE IF NOT EXISTS library_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  topic TEXT,
  created_by INTEGER REFERENCES users(id),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS library_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  library_item_id INTEGER NOT NULL REFERENCES library_items(id) ON DELETE CASCADE,
  language TEXT NOT NULL, -- falls back to 'en' if FO's language missing
  file_type TEXT NOT NULL CHECK (file_type IN ('pdf','slide','video','document','image')),
  file_url TEXT NOT NULL
);

-- ===== Notifications (in-app) =====
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL, -- new_update, unacknowledged_reminder, ojt_submitted, requiz_failed, ojt_eligible, hold, off_hold
  message TEXT NOT NULL,
  related_id INTEGER,
  read_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- ===== Audit log: who approved/moved/published what, and when =====
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL, -- e.g. 'move_stage', 'approve_day', 'publish_update', 'hold', 'release_hold'
  target_type TEXT,
  target_id INTEGER,
  details TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
