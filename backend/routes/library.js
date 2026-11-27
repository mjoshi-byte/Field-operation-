const express = require('express');
const { db } = require('../db');
const { requireAuth, requireRole, audit } = require('../middleware/auth');

const router = express.Router();

// List / search library content. FO sees files resolved to their preferred language
// (falling back to English with a note, per the blueprint).
router.get('/', requireAuth, (req, res) => {
  const { topic, q } = req.query;
  let sql = 'SELECT * FROM library_items WHERE 1=1';
  const params = [];
  if (topic) { sql += ' AND topic = ?'; params.push(topic); }
  if (q) { sql += ' AND title LIKE ?'; params.push(`%${q}%`); }
  sql += ' ORDER BY updated_at DESC';
  const items = db.prepare(sql).all(...params);

  const lang = req.user.preferred_language || 'en';
  const withFiles = items.map((item) => {
    const files = db.prepare('SELECT * FROM library_files WHERE library_item_id = ?').all(item.id);
    const preferred = files.find((f) => f.language === lang);
    const fallback = files.find((f) => f.language === 'en');
    return {
      ...item,
      available_languages: [...new Set(files.map((f) => f.language))],
      file: preferred || fallback || null,
      used_fallback: !preferred && !!fallback,
    };
  });

  res.json({ items: withFiles });
});

router.post('/', requireAuth, requireRole('admin', 'supervisor', 'trainer'), (req, res) => {
  const { title, topic, files = [] } = req.body; // files: [{language, file_type, file_url}]
  if (!title) return res.status(400).json({ error: 'title required' });
  const info = db.prepare('INSERT INTO library_items (title, topic, created_by) VALUES (?,?,?)').run(
    title,
    topic || null,
    req.user.id
  );
  files.forEach((f) =>
    db
      .prepare('INSERT INTO library_files (library_item_id, language, file_type, file_url) VALUES (?,?,?,?)')
      .run(info.lastInsertRowid, f.language, f.file_type, f.file_url)
  );
  audit(req.user.id, 'add_library_item', 'library_item', info.lastInsertRowid, { title });
  res.status(201).json({ id: info.lastInsertRowid });
});

router.put('/:id', requireAuth, requireRole('admin', 'supervisor', 'trainer'), (req, res) => {
  const { title, topic, files } = req.body;
  db.prepare('UPDATE library_items SET title = COALESCE(?, title), topic = COALESCE(?, topic), updated_at = datetime("now") WHERE id = ?').run(
    title ?? null,
    topic ?? null,
    req.params.id
  );
  if (files) {
    db.prepare('DELETE FROM library_files WHERE library_item_id = ?').run(req.params.id);
    files.forEach((f) =>
      db
        .prepare('INSERT INTO library_files (library_item_id, language, file_type, file_url) VALUES (?,?,?,?)')
        .run(req.params.id, f.language, f.file_type, f.file_url)
    );
  }
  audit(req.user.id, 'edit_library_item', 'library_item', req.params.id, { title, topic });
  res.json({ ok: true });
});

router.delete('/:id', requireAuth, requireRole('admin', 'supervisor', 'trainer'), (req, res) => {
  db.prepare('DELETE FROM library_items WHERE id = ?').run(req.params.id);
  audit(req.user.id, 'delete_library_item', 'library_item', req.params.id, {});
  res.json({ ok: true });
});

module.exports = router;
