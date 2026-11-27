const express = require('express');
const { db } = require('../db');
const { requireAuth, requireRole, audit, notify } = require('../middleware/auth');

const router = express.Router();

function audienceFoIds(update) {
  if (update.audience_type === 'all') {
    return db.prepare("SELECT id FROM users WHERE role = 'fo'").all().map((r) => r.id);
  }
  if (update.audience_type === 'city') {
    return db
      .prepare("SELECT id FROM users WHERE role = 'fo' AND city = ?")
      .all(update.audience_city)
      .map((r) => r.id);
  }
  return db
    .prepare('SELECT fo_id FROM update_audience WHERE update_id = ?')
    .all(update.id)
    .map((r) => r.fo_id);
}

// Admin/supervisor/trainer: create an update or standalone quiz (draft)
// body: { title, description, kind, pass_mark, retakes_allowed, audience_type, audience_city,
//         audience_fo_ids, files: [{language, file_type, file_url}],
//         questions: [{language, question_text, options, correct_index}] }
router.post('/', requireAuth, requireRole('admin', 'supervisor', 'trainer'), (req, res) => {
  const {
    title,
    description,
    kind = 'update',
    pass_mark = 80,
    retakes_allowed = 1,
    audience_type = 'all',
    audience_city,
    audience_fo_ids = [],
    deadline_hours = 72,
    files = [],
    questions = [],
  } = req.body;

  if (!title) return res.status(400).json({ error: 'title required' });
  if (kind === 'update' && files.length === 0) {
    return res.status(400).json({ error: 'An update needs at least one file to read' });
  }

  const info = db
    .prepare(
      `INSERT INTO updates (title, description, kind, pass_mark, retakes_allowed, audience_type,
       audience_city, deadline_hours, created_by) VALUES (?,?,?,?,?,?,?,?,?)`
    )
    .run(title, description || null, kind, pass_mark, retakes_allowed, audience_type, audience_city || null, deadline_hours, req.user.id);

  const updateId = info.lastInsertRowid;

  files.forEach((f) =>
    db
      .prepare('INSERT INTO update_files (update_id, language, file_type, file_url) VALUES (?,?,?,?)')
      .run(updateId, f.language, f.file_type, f.file_url)
  );

  if (audience_type === 'specific') {
    audience_fo_ids.forEach((foId) =>
      db.prepare('INSERT OR IGNORE INTO update_audience (update_id, fo_id) VALUES (?,?)').run(updateId, foId)
    );
  }

  questions.forEach((q, idx) =>
    db
      .prepare(
        `INSERT INTO quiz_questions (update_id, language, position, question_text, options_json, correct_index)
         VALUES (?,?,?,?,?,?)`
      )
      .run(updateId, q.language, idx, q.question_text, JSON.stringify(q.options), q.correct_index)
  );

  audit(req.user.id, 'create_update', 'update', updateId, { title, kind, status: 'draft' });
  res.status(201).json({ update: getUpdate(updateId) });
});

function getUpdate(id) {
  const update = db.prepare('SELECT * FROM updates WHERE id = ?').get(id);
  if (!update) return null;
  const files = db.prepare('SELECT * FROM update_files WHERE update_id = ?').all(id);
  const questions = db.prepare('SELECT * FROM quiz_questions WHERE update_id = ? ORDER BY position').all(id);
  return {
    ...update,
    files,
    questions: questions.map((q) => ({ ...q, options: JSON.parse(q.options_json) })),
  };
}

router.get('/:id', requireAuth, (req, res) => {
  const update = getUpdate(req.params.id);
  if (!update) return res.status(404).json({ error: 'Not found' });
  res.json({ update });
});

router.get('/', requireAuth, requireRole('admin', 'supervisor', 'trainer'), (req, res) => {
  const { status, kind } = req.query;
  let sql = 'SELECT * FROM updates WHERE 1=1';
  const params = [];
  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (kind) { sql += ' AND kind = ?'; params.push(kind); }
  sql += ' ORDER BY created_at DESC';
  const updates = db.prepare(sql).all(...params);
  res.json({ updates });
});

// Publish: assigns to audience with a deadline, notifies them
router.post('/:id/publish', requireAuth, requireRole('admin', 'supervisor', 'trainer'), (req, res) => {
  const update = db.prepare('SELECT * FROM updates WHERE id = ?').get(req.params.id);
  if (!update) return res.status(404).json({ error: 'Not found' });

  const questionCount = db.prepare('SELECT COUNT(*) c FROM quiz_questions WHERE update_id = ?').get(update.id).c;
  if (questionCount === 0) {
    return res.status(400).json({ error: 'Add at least one quiz question before publishing' });
  }

  db.prepare('UPDATE updates SET status = "published", published_at = datetime("now") WHERE id = ?').run(update.id);

  const fos = audienceFoIds(update);
  const deadline = new Date(Date.now() + update.deadline_hours * 3600 * 1000).toISOString();
  fos.forEach((foId) => {
    db.prepare(
      `INSERT OR IGNORE INTO fo_update_status (update_id, fo_id, status, deadline_at) VALUES (?,?,?,?)`
    ).run(update.id, foId, 'pending', deadline);
    notify(
      foId,
      'new_update',
      update.kind === 'update' ? `New update: ${update.title}` : `New quiz: ${update.title}`,
      update.id
    );
  });

  audit(req.user.id, 'publish_update', 'update', update.id, { audience_count: fos.length });
  res.json({ update: getUpdate(update.id), assigned_to: fos.length });
});

// Withdraw a published update
router.post('/:id/withdraw', requireAuth, requireRole('admin', 'supervisor', 'trainer'), (req, res) => {
  db.prepare('UPDATE updates SET status = "withdrawn" WHERE id = ?').run(req.params.id);
  audit(req.user.id, 'withdraw_update', 'update', req.params.id, {});
  res.json({ ok: true });
});

// Revise a published update: creates a new version, re-publishes, and resets every
// FO's acknowledgement/quiz state so they must do it again.
router.post('/:id/revise', requireAuth, requireRole('admin', 'supervisor', 'trainer'), (req, res) => {
  const original = getUpdate(req.params.id);
  if (!original) return res.status(404).json({ error: 'Not found' });
  const patch = req.body || {};

  const info = db
    .prepare(
      `INSERT INTO updates (title, description, kind, pass_mark, retakes_allowed, audience_type,
       audience_city, deadline_hours, version, previous_version_id, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      patch.title ?? original.title,
      patch.description ?? original.description,
      original.kind,
      patch.pass_mark ?? original.pass_mark,
      patch.retakes_allowed ?? original.retakes_allowed,
      original.audience_type,
      original.audience_city,
      patch.deadline_hours ?? original.deadline_hours,
      original.version + 1,
      original.id,
      req.user.id
    );
  const newId = info.lastInsertRowid;

  const files = patch.files ?? original.files;
  files.forEach((f) =>
    db
      .prepare('INSERT INTO update_files (update_id, language, file_type, file_url) VALUES (?,?,?,?)')
      .run(newId, f.language, f.file_type, f.file_url)
  );

  if (original.audience_type === 'specific') {
    db.prepare('SELECT fo_id FROM update_audience WHERE update_id = ?')
      .all(original.id)
      .forEach((r) => db.prepare('INSERT INTO update_audience (update_id, fo_id) VALUES (?,?)').run(newId, r.fo_id));
  }

  const questions = patch.questions ?? original.questions;
  questions.forEach((q, idx) =>
    db
      .prepare(
        `INSERT INTO quiz_questions (update_id, language, position, question_text, options_json, correct_index)
         VALUES (?,?,?,?,?,?)`
      )
      .run(newId, q.language, idx, q.question_text, JSON.stringify(q.options), q.correct_index)
  );

  db.prepare('UPDATE updates SET status = "published", published_at = datetime("now") WHERE id = ?').run(newId);

  const fos = audienceFoIds({ ...original, id: newId });
  const deadline = new Date(Date.now() + (patch.deadline_hours ?? original.deadline_hours) * 3600 * 1000).toISOString();
  fos.forEach((foId) => {
    db.prepare(
      `INSERT OR IGNORE INTO fo_update_status (update_id, fo_id, status, deadline_at) VALUES (?,?,?,?)`
    ).run(newId, foId, 'pending', deadline);
    notify(foId, 'new_update', `Revised: ${patch.title ?? original.title} — please review again`, newId);
  });

  audit(req.user.id, 'revise_update', 'update', newId, { previous: original.id });
  res.status(201).json({ update: getUpdate(newId) });
});

// ===== FO-facing endpoints =====

// FO's to-do list: pending/overdue updates & quizzes
router.get('/mine/:foId', requireAuth, (req, res) => {
  const foId = Number(req.params.foId);
  if (req.user.role === 'fo' && req.user.id !== foId) return res.status(403).json({ error: 'Not allowed' });

  const rows = db
    .prepare(
      `SELECT fus.*, u.title, u.description, u.kind, u.pass_mark
       FROM fo_update_status fus JOIN updates u ON u.id = fus.update_id
       WHERE fus.fo_id = ? ORDER BY fus.deadline_at ASC`
    )
    .all(foId);

  const now = Date.now();
  const withTiming = rows.map((r) => ({
    ...r,
    overdue: r.status === 'pending' && new Date(r.deadline_at).getTime() < now,
    hours_remaining: Math.max(0, Math.round((new Date(r.deadline_at).getTime() - now) / 3600000)),
  }));
  res.json({ items: withTiming });
});

// FO opens an update (marks opened_at, makes Acknowledge available)
router.post('/:id/open/:foId', requireAuth, (req, res) => {
  const foId = Number(req.params.foId);
  if (req.user.role === 'fo' && req.user.id !== foId) return res.status(403).json({ error: 'Not allowed' });
  db.prepare(
    `UPDATE fo_update_status SET opened_at = COALESCE(opened_at, datetime("now")) WHERE update_id = ? AND fo_id = ?`
  ).run(req.params.id, foId);
  res.json({ ok: true });
});

// FO acknowledges (only after opening)
router.post('/:id/acknowledge/:foId', requireAuth, (req, res) => {
  const foId = Number(req.params.foId);
  if (req.user.role === 'fo' && req.user.id !== foId) return res.status(403).json({ error: 'Not allowed' });

  const row = db
    .prepare('SELECT * FROM fo_update_status WHERE update_id = ? AND fo_id = ?')
    .get(req.params.id, foId);
  if (!row) return res.status(404).json({ error: 'Not assigned to this FO' });
  if (!row.opened_at) return res.status(400).json({ error: 'Open the content before acknowledging' });

  db.prepare(
    `UPDATE fo_update_status SET acknowledged_at = datetime("now"), status = "acknowledged" WHERE id = ?`
  ).run(row.id);
  res.json({ ok: true });
});

// FO submits quiz answers: [{question_id, selected_index}]
router.post('/:id/quiz/submit/:foId', requireAuth, (req, res) => {
  const foId = Number(req.params.foId);
  if (req.user.role === 'fo' && req.user.id !== foId) return res.status(403).json({ error: 'Not allowed' });

  const updateId = Number(req.params.id);
  const update = db.prepare('SELECT * FROM updates WHERE id = ?').get(updateId);
  const status = db.prepare('SELECT * FROM fo_update_status WHERE update_id = ? AND fo_id = ?').get(updateId, foId);
  if (!update || !status) return res.status(404).json({ error: 'Not found' });
  if (update.kind === 'update' && !status.acknowledged_at) {
    return res.status(400).json({ error: 'Acknowledge the update before taking the quiz' });
  }

  const { answers = [] } = req.body; // [{question_id, selected_index}]
  const questions = db.prepare('SELECT * FROM quiz_questions WHERE update_id = ?').all(updateId);
  let correct = 0;
  const graded = answers.map((a) => {
    const q = questions.find((q) => q.id === a.question_id);
    const isCorrect = q && q.correct_index === a.selected_index;
    if (isCorrect) correct += 1;
    return { question_id: a.question_id, selected_index: a.selected_index, correct: !!isCorrect };
  });
  const scorePercent = questions.length ? Math.round((correct / questions.length) * 100) : 0;
  const passed = scorePercent >= update.pass_mark;

  const attemptNumber =
    (db
      .prepare('SELECT COUNT(*) c FROM quiz_attempts WHERE update_id = ? AND fo_id = ?')
      .get(updateId, foId).c || 0) + 1;

  db.prepare(
    `INSERT INTO quiz_attempts (update_id, fo_id, attempt_number, score_percent, passed, answers_json)
     VALUES (?,?,?,?,?,?)`
  ).run(updateId, foId, attemptNumber, scorePercent, passed ? 1 : 0, JSON.stringify(graded));

  const fo = db.prepare('SELECT * FROM users WHERE id = ?').get(foId);

  if (passed) {
    db.prepare('UPDATE fo_update_status SET status = "passed" WHERE id = ?').run(status.id);
    if (fo.status === 'retraining') {
      db.prepare('UPDATE users SET status = "active" WHERE id = ?').run(foId);
    }
  } else {
    // Failed -> marked for retraining. If they already failed the re-quiz (2nd+ attempt), reviewer can hold.
    db.prepare('UPDATE fo_update_status SET status = "failed" WHERE id = ?').run(status.id);
    db.prepare('UPDATE users SET status = "retraining" WHERE id = ?').run(foId);

    if (attemptNumber >= 2) {
      const reviewers = db.prepare("SELECT id FROM users WHERE role IN ('trainer','supervisor')").all();
      reviewers.forEach((r) =>
        notify(r.id, 'requiz_failed', `${fo.name} failed the re-quiz for "${update.title}". Consider a hold.`, foId)
      );
    }
  }

  res.json({ score_percent: scorePercent, passed, attempt_number: attemptNumber, graded });
});

// Mark overdue items (call periodically, e.g. from a cron or on dashboard load)
router.post('/sweep-overdue', requireAuth, requireRole('admin', 'supervisor', 'trainer'), (req, res) => {
  const result = db
    .prepare(
      `UPDATE fo_update_status SET status = 'overdue'
       WHERE status = 'pending' AND deadline_at < datetime('now')`
    )
    .run();
  res.json({ marked_overdue: result.changes });
});

module.exports = router;
