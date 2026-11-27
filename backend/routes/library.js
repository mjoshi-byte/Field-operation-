const express = require('express');
const { db } = require('../db');
const { requireAuth, requireRole, audit } = require('../middleware/auth');

const router = express.Router();

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
    withFiles.push({
      ...item,
      available_languages: [...new Set(files.map((f) => f.language))],
      file: preferred || fallback || null,
      used_fallback: !preferred && !!fallback,
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

module.exports = router;
