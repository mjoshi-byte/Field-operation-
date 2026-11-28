-- Run this once in the Supabase SQL editor — adds per-FO "watched" tracking for
-- content library items, and a public storage bucket for admin-uploaded files.

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
