const express = require('express');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const { db } = require('../db');
const { requireAuth, requireRole, audit } = require('../middleware/auth');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const BUCKET = 'library-files';

router.get('/', requireAuth, async (req, res) => {
  const { topic, q } = req.query;
  const clauses = [];
  const params = [];
  if (topic) { params.push(topic); clauses.push(`topic = $${params.length}`); }
  if (q) { params.push(`%${q}%`); clauses.push(`title ILIKE $${params.length}`); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const { rows: items } = await db.query(`SELECT * FROM library_items ${where} ORDER BY updated_at DESC`, params);

  const lang = req.user.preferred_language || 'en';
  const withFiles = [];
  for (const item of items) {
    const { rows: files } = await db.query('SELECT * FROM library_files WHERE library_item_id = $1', [item.id]);
    const preferred = files.find((f) => f.language === lang);
    const fallback = files.find((f) => f.language === 'en');

    let viewed = null;
    if (req.user.role === 'fo') {
      const { rows: viewRows } = await db.query(
        'SELECT viewed_at FROM library_item_views WHERE library_item_id = $1 AND fo_id = $2',
        [item.id, req.user.id]
      );
      viewed = !!(viewRows[0] && viewRows[0].viewed_at);
    }

    withFiles.push({
      ...item,
      available_languages: [...new Set(files.map((f) => f.language))],
      file: preferred || fallback || null,
      used_fallback: !preferred && !!fallback,
      viewed,
    });
  }

  res.json({ items: withFiles });
});

router.post('/', requireAuth, requireRole('admin', 'supervisor', 'trainer'), async (req, res) => {
  const { title, topic, files = [] } = req.body;
  if (!title) return res.status(400).json({ error: 'title required' });
  const { rows } = await db.query('INSERT INTO library_items (title, topic, created_by) VALUES ($1,$2,$3) RETURNING id', [
    title, topic || null, req.user.id,
  ]);
  for (const f of files) {
    await db.query('INSERT INTO library_files (library_item_id, language, file_type, file_url) VALUES ($1,$2,$3,$4)', [
      rows[0].id, f.language, f.file_type, f.file_url,
    ]);
  }
  await audit(req.user.id, 'add_library_item', 'library_item', rows[0].id, { title });
  res.status(201).json({ id: rows[0].id });
});

// Admin/trainer/supervisor uploads an actual file (PDF/video/image/etc.) to Supabase
// Storage; returns a public URL to attach to a library item via POST / above.
router.post('/upload', requireAuth, requireRole('admin', 'supervisor', 'trainer'), upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file received' });
  const safeName = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${Date.now()}-${safeName}`;
  const { error } = await supabaseAdmin.storage.from(BUCKET).upload(path, req.file.buffer, {
    contentType: req.file.mimetype,
    upsert: false,
  });
  if (error) return res.status(500).json({ error: error.message });
  const { data } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path);
  res.json({ file_url: data.publicUrl });
});

router.put('/:id', requireAuth, requireRole('admin', 'supervisor', 'trainer'), async (req, res) => {
  const { title, topic, files } = req.body;
  await db.query(
    'UPDATE library_items SET title = COALESCE($1, title), topic = COALESCE($2, topic), updated_at = now() WHERE id = $3',
    [title ?? null, topic ?? null, req.params.id]
  );
  if (files) {
    await db.query('DELETE FROM library_files WHERE library_item_id = $1', [req.params.id]);
    for (const f of files) {
      await db.query('INSERT INTO library_files (library_item_id, language, file_type, file_url) VALUES ($1,$2,$3,$4)', [
        req.params.id, f.language, f.file_type, f.file_url,
      ]);
    }
  }
  await audit(req.user.id, 'edit_library_item', 'library_item', req.params.id, { title, topic });
  res.json({ ok: true });
});

router.delete('/:id', requireAuth, requireRole('admin', 'supervisor', 'trainer'), async (req, res) => {
  await db.query('DELETE FROM library_items WHERE id = $1', [req.params.id]);
  await audit(req.user.id, 'delete_library_item', 'library_item', req.params.id, {});
  res.json({ ok: true });
});

// FO marks a library item as watched/opened — the first time only; re-opening doesn't
// change the original viewed_at.
router.post('/:id/view', requireAuth, async (req, res) => {
  await db.query(
    `INSERT INTO library_item_views (library_item_id, fo_id, viewed_at)
     VALUES ($1, $2, now())
     ON CONFLICT (library_item_id, fo_id) DO UPDATE SET viewed_at = COALESCE(library_item_views.viewed_at, now())`,
    [req.params.id, req.user.id]
  );
  res.json({ ok: true });
});

// Admin/trainer/supervisor sees every FO's watched status for one library item.
router.get('/:id/views', requireAuth, requireRole('admin', 'supervisor', 'trainer'), async (req, res) => {
  const { rows } = await db.query(
    `SELECT u.id as fo_id, u.name, u.city, v.viewed_at
     FROM users u
     LEFT JOIN library_item_views v ON v.fo_id = u.id AND v.library_item_id = $1
     WHERE u.role = 'fo'
     ORDER BY u.name`,
    [req.params.id]
  );
  res.json({ views: rows });
});

// Admin/trainer/supervisor manually marks or unmarks one FO's watched status.
router.put('/:id/mark/:foId', requireAuth, requireRole('admin', 'supervisor', 'trainer'), async (req, res) => {
  const { viewed } = req.body;
  await db.query(
    `INSERT INTO library_item_views (library_item_id, fo_id, viewed_at, marked_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (library_item_id, fo_id) DO UPDATE SET viewed_at = $3, marked_by = $4`,
    [req.params.id, req.params.foId, viewed ? new Date().toISOString() : null, req.user.id]
  );
  await audit(req.user.id, viewed ? 'mark_library_viewed' : 'unmark_library_viewed', 'library_item', req.params.id, {
    fo_id: Number(req.params.foId),
  });
  res.json({ ok: true });
});

module.exports = router;
