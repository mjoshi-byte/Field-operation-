const express = require('express');
const { db } = require('../db');
const { requireAuth, requireRole, audit, notify } = require('../middleware/auth');

const router = express.Router();

async function audienceFoIds(update) {
  if (update.audience_type === 'all') {
    const { rows } = await db.query("SELECT id FROM users WHERE role = 'fo'");
    return rows.map((r) => r.id);
  }
  if (update.audience_type === 'city') {
    const { rows } = await db.query("SELECT id FROM users WHERE role = 'fo' AND city = $1", [update.audience_city]);
    return rows.map((r) => r.id);
  }
  const { rows } = await db.query('SELECT fo_id FROM update_audience WHERE update_id = $1', [update.id]);
  return rows.map((r) => r.fo_id);
}

async function getUpdate(id) {
  const { rows: updateRows } = await db.query('SELECT * FROM updates WHERE id = $1', [id]);
  const update = updateRows[0];
  if (!update) return null;
  const { rows: files } = await db.query('SELECT * FROM update_files WHERE update_id = $1', [id]);
  const { rows: questions } = await db.query('SELECT * FROM quiz_questions WHERE update_id = $1 ORDER BY position', [id]);
  return { ...update, files, questions: questions.map((q) => ({ ...q, options: q.options_json })) };
}

router.post('/', requireAuth, requireRole('admin', 'supervisor', 'trainer'), async (req, res) => {
  const {
    title, description, kind = 'update', pass_mark = 80, retakes_allowed = 1,
    audience_type = 'all', audience_city, audience_fo_ids = [], deadline_hours = 72,
    files = [], questions = [],
  } = req.body;

  if (!title) return res.status(400).json({ error: 'title required' });
  if (kind === 'update' && files.length === 0) {
    return res.status(400).json({ error: 'An update needs at least one file to read' });
  }

  const { rows } = await db.query(
    `INSERT INTO updates (title, description, kind, pass_mark, retakes_allowed, audience_type,
     audience_city, deadline_hours, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [title, description || null, kind, pass_mark, retakes_allowed, audience_type, audience_city || null, deadline_hours, req.user.id]
  );
  const updateId = rows[0].id;

  for (const f of files) {
    await db.query('INSERT INTO update_files (update_id, language, file_type, file_url) VALUES ($1,$2,$3,$4)', [
      updateId, f.language, f.file_type, f.file_url,
    ]);
  }

  if (audience_type === 'specific') {
    for (const foId of audience_fo_ids) {
      await db.query('INSERT INTO update_audience (update_id, fo_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [updateId, foId]);
    }
  }

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    await db.query(
      `INSERT INTO quiz_questions (update_id, language, position, question_text, options_json, correct_index)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [updateId, q.language, i, q.question_text, JSON.stringify(q.options), q.correct_index]
    );
  }

  await audit(req.user.id, 'create_update', 'update', updateId, { title, kind, status: 'draft' });
  res.status(201).json({ update: await getUpdate(updateId) });
});

router.get('/:id', requireAuth, async (req, res) => {
  const update = await getUpdate(req.params.id);
  if (!update) return res.status(404).json({ error: 'Not found' });
  res.json({ update });
});

router.get('/', requireAuth, requireRole('admin', 'supervisor', 'trainer'), async (req, res) => {
  const { status, kind } = req.query;
  const clauses = [];
  const params = [];
  if (status) { params.push(status); clauses.push(`status = $${params.length}`); }
  if (kind) { params.push(kind); clauses.push(`kind = $${params.length}`); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const { rows } = await db.query(`SELECT * FROM updates ${where} ORDER BY created_at DESC`, params);
  res.json({ updates: rows });
});

router.post('/:id/publish', requireAuth, requireRole('admin', 'supervisor', 'trainer'), async (req, res) => {
  const { rows: updateRows } = await db.query('SELECT * FROM updates WHERE id = $1', [req.params.id]);
  const update = updateRows[0];
  if (!update) return res.status(404).json({ error: 'Not found' });

  const { rows: qCountRows } = await db.query('SELECT COUNT(*)::int c FROM quiz_questions WHERE update_id = $1', [update.id]);
  if (qCountRows[0].c === 0) {
    return res.status(400).json({ error: 'Add at least one quiz question before publishing' });
  }

  await db.query(`UPDATE updates SET status = 'published', published_at = now() WHERE id = $1`, [update.id]);

  const fos = await audienceFoIds(update);
  const deadline = new Date(Date.now() + update.deadline_hours * 3600 * 1000).toISOString();
  for (const foId of fos) {
    await db.query(
      `INSERT INTO fo_update_status (update_id, fo_id, status, deadline_at) VALUES ($1,$2,'pending',$3)
       ON CONFLICT (update_id, fo_id) DO NOTHING`,
      [update.id, foId, deadline]
    );
    await notify(foId, 'new_update', update.kind === 'update' ? `New update: ${update.title}` : `New quiz: ${update.title}`, update.id);
  }

  await audit(req.user.id, 'publish_update', 'update', update.id, { audience_count: fos.length });
  res.json({ update: await getUpdate(update.id), assigned_to: fos.length });
});

router.post('/:id/withdraw', requireAuth, requireRole('admin', 'supervisor', 'trainer'), async (req, res) => {
  await db.query(`UPDATE updates SET status = 'withdrawn' WHERE id = $1`, [req.params.id]);
  await audit(req.user.id, 'withdraw_update', 'update', req.params.id, {});
  res.json({ ok: true });
});

router.post('/:id/revise', requireAuth, requireRole('admin', 'supervisor', 'trainer'), async (req, res) => {
  const original = await getUpdate(req.params.id);
  if (!original) return res.status(404).json({ error: 'Not found' });
  const patch = req.body || {};

  const { rows } = await db.query(
    `INSERT INTO updates (title, description, kind, pass_mark, retakes_allowed, audience_type,
     audience_city, deadline_hours, version, previous_version_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [
      patch.title ?? original.title, patch.description ?? original.description, original.kind,
      patch.pass_mark ?? original.pass_mark, patch.retakes_allowed ?? original.retakes_allowed,
      original.audience_type, original.audience_city, patch.deadline_hours ?? original.deadline_hours,
      original.version + 1, original.id, req.user.id,
    ]
  );
  const newId = rows[0].id;

  const files = patch.files ?? original.files;
  for (const f of files) {
    await db.query('INSERT INTO update_files (update_id, language, file_type, file_url) VALUES ($1,$2,$3,$4)', [
      newId, f.language, f.file_type, f.file_url,
    ]);
  }

  if (original.audience_type === 'specific') {
    const { rows: aud } = await db.query('SELECT fo_id FROM update_audience WHERE update_id = $1', [original.id]);
    for (const a of aud) {
      await db.query('INSERT INTO update_audience (update_id, fo_id) VALUES ($1,$2)', [newId, a.fo_id]);
    }
  }

  const questions = patch.questions ?? original.questions;
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    await db.query(
      `INSERT INTO quiz_questions (update_id, language, position, question_text, options_json, correct_index)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [newId, q.language, i, q.question_text, JSON.stringify(q.options), q.correct_index]
    );
  }

  await db.query(`UPDATE updates SET status = 'published', published_at = now() WHERE id = $1`, [newId]);

  const fos = await audienceFoIds({ ...original, id: newId });
  const deadline = new Date(Date.now() + (patch.deadline_hours ?? original.deadline_hours) * 3600 * 1000).toISOString();
  for (const foId of fos) {
    await db.query(
      `INSERT INTO fo_update_status (update_id, fo_id, status, deadline_at) VALUES ($1,$2,'pending',$3)
       ON CONFLICT (update_id, fo_id) DO NOTHING`,
      [newId, foId, deadline]
    );
    await notify(foId, 'new_update', `Revised: ${patch.title ?? original.title} — please review again`, newId);
  }

  await audit(req.user.id, 'revise_update', 'update', newId, { previous: original.id });
  res.status(201).json({ update: await getUpdate(newId) });
});

router.get('/mine/:foId', requireAuth, async (req, res) => {
  const foId = Number(req.params.foId);
  if (req.user.role === 'fo' && req.user.id !== foId) return res.status(403).json({ error: 'Not allowed' });

  const { rows } = await db.query(
    `SELECT fus.*, u.title, u.description, u.kind, u.pass_mark
     FROM fo_update_status fus JOIN updates u ON u.id = fus.update_id
     WHERE fus.fo_id = $1 ORDER BY fus.deadline_at ASC`,
    [foId]
  );

  const now = Date.now();
  const withTiming = rows.map((r) => ({
    ...r,
    overdue: r.status === 'pending' && new Date(r.deadline_at).getTime() < now,
    hours_remaining: Math.max(0, Math.round((new Date(r.deadline_at).getTime() - now) / 3600000)),
  }));
  res.json({ items: withTiming });
});

router.post('/:id/open/:foId', requireAuth, async (req, res) => {
  const foId = Number(req.params.foId);
  if (req.user.role === 'fo' && req.user.id !== foId) return res.status(403).json({ error: 'Not allowed' });
  await db.query(
    `UPDATE fo_update_status SET opened_at = COALESCE(opened_at, now()) WHERE update_id = $1 AND fo_id = $2`,
    [req.params.id, foId]
  );
  res.json({ ok: true });
});

router.post('/:id/acknowledge/:foId', requireAuth, async (req, res) => {
  const foId = Number(req.params.foId);
  if (req.user.role === 'fo' && req.user.id !== foId) return res.status(403).json({ error: 'Not allowed' });

  const { rows } = await db.query('SELECT * FROM fo_update_status WHERE update_id = $1 AND fo_id = $2', [req.params.id, foId]);
  const row = rows[0];
  if (!row) return res.status(404).json({ error: 'Not assigned to this FO' });
  if (!row.opened_at) return res.status(400).json({ error: 'Open the content before acknowledging' });

  await db.query(`UPDATE fo_update_status SET acknowledged_at = now(), status = 'acknowledged' WHERE id = $1`, [row.id]);
  res.json({ ok: true });
});

router.post('/:id/quiz/submit/:foId', requireAuth, async (req, res) => {
  const foId = Number(req.params.foId);
  if (req.user.role === 'fo' && req.user.id !== foId) return res.status(403).json({ error: 'Not allowed' });

  const updateId = Number(req.params.id);
  const { rows: updateRows } = await db.query('SELECT * FROM updates WHERE id = $1', [updateId]);
  const update = updateRows[0];
  const { rows: statusRows } = await db.query('SELECT * FROM fo_update_status WHERE update_id = $1 AND fo_id = $2', [updateId, foId]);
  const status = statusRows[0];
  if (!update || !status) return res.status(404).json({ error: 'Not found' });
  if (update.kind === 'update' && !status.acknowledged_at) {
    return res.status(400).json({ error: 'Acknowledge the update before taking the quiz' });
  }

  const { answers = [] } = req.body;
  const { rows: questions } = await db.query('SELECT * FROM quiz_questions WHERE update_id = $1', [updateId]);
  let correct = 0;
  const graded = answers.map((a) => {
    const q = questions.find((q) => q.id === a.question_id);
    const isCorrect = q && q.correct_index === a.selected_index;
    if (isCorrect) correct += 1;
    return { question_id: a.question_id, selected_index: a.selected_index, correct: !!isCorrect };
  });
  const scorePercent = questions.length ? Math.round((correct / questions.length) * 100) : 0;
  const passed = scorePercent >= update.pass_mark;

  const { rows: countRows } = await db.query('SELECT COUNT(*)::int c FROM quiz_attempts WHERE update_id = $1 AND fo_id = $2', [updateId, foId]);
  const attemptNumber = countRows[0].c + 1;

  await db.query(
    `INSERT INTO quiz_attempts (update_id, fo_id, attempt_number, score_percent, passed, answers_json)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [updateId, foId, attemptNumber, scorePercent, passed, JSON.stringify(graded)]
  );

  const { rows: foRows } = await db.query('SELECT * FROM users WHERE id = $1', [foId]);
  const fo = foRows[0];

  if (passed) {
    await db.query(`UPDATE fo_update_status SET status = 'passed' WHERE id = $1`, [status.id]);
    if (fo.status === 'retraining') {
      await db.query(`UPDATE users SET status = 'active' WHERE id = $1`, [foId]);
    }
  } else {
    await db.query(`UPDATE fo_update_status SET status = 'failed' WHERE id = $1`, [status.id]);
    await db.query(`UPDATE users SET status = 'retraining' WHERE id = $1`, [foId]);

    if (attemptNumber >= 2) {
      const { rows: reviewers } = await db.query("SELECT id FROM users WHERE role IN ('trainer','supervisor')");
      for (const r of reviewers) {
        await notify(r.id, 'requiz_failed', `${fo.name} failed the re-quiz for "${update.title}". Consider a hold.`, foId);
      }
    }
  }

  res.json({ score_percent: scorePercent, passed, attempt_number: attemptNumber, graded });
});

router.post('/sweep-overdue', requireAuth, requireRole('admin', 'supervisor', 'trainer'), async (req, res) => {
  const result = await db.query(
    `UPDATE fo_update_status SET status = 'overdue' WHERE status = 'pending' AND deadline_at < now()`
  );
  res.json({ marked_overdue: result.rowCount });
});

module.exports = router;
