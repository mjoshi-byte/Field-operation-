const express = require('express');
const { db } = require('../db');
const { requireAuth, requireRole, audit, notify } = require('../middleware/auth');

const router = express.Router();

async function fullChecklist(foId) {
  const { rows: days } = await db.query('SELECT * FROM ojt_days ORDER BY day_number');
  const result = [];
  for (const day of days) {
    const { rows: progressRows } = await db.query(
      'SELECT * FROM ojt_fo_days WHERE fo_id = $1 AND day_id = $2',
      [foId, day.id]
    );
    const progress = progressRows[0];
    const { rows: items } = await db.query('SELECT * FROM ojt_items WHERE day_id = $1 ORDER BY position', [day.id]);

    const itemsWithSubchecks = [];
    for (const item of items) {
      const { rows: subchecks } = await db.query('SELECT * FROM ojt_subchecks WHERE item_id = $1 ORDER BY position', [item.id]);
      const withState = [];
      for (const sc of subchecks) {
        const { rows: stateRows } = await db.query(
          'SELECT * FROM ojt_fo_subchecks WHERE fo_id = $1 AND subcheck_id = $2',
          [foId, sc.id]
        );
        withState.push({ ...sc, checked: !!stateRows[0]?.checked });
      }
      itemsWithSubchecks.push({ ...item, subchecks: withState, done: withState.every((s) => s.checked) });
    }

    result.push({
      ...day,
      progress: progress || { status: 'locked', redo_count: 0 },
      items: itemsWithSubchecks,
    });
  }
  return result;
}

router.get('/:foId/checklist', requireAuth, async (req, res) => {
  const foId = Number(req.params.foId);
  if (req.user.role === 'fo' && req.user.id !== foId) {
    return res.status(403).json({ error: 'Not allowed' });
  }
  res.json({ checklist: await fullChecklist(foId) });
});

router.post('/days', requireAuth, requireRole('admin'), async (req, res) => {
  const { day_number, title } = req.body;
  const { rows } = await db.query('INSERT INTO ojt_days (day_number, title) VALUES ($1,$2) RETURNING id', [
    day_number,
    title,
  ]);
  await audit(req.user.id, 'edit_checklist_add_day', 'ojt_day', rows[0].id, { day_number, title });
  res.status(201).json({ id: rows[0].id });
});

router.post('/days/:dayId/items', requireAuth, requireRole('admin'), async (req, res) => {
  const { position, title, subchecks } = req.body;
  const { rows } = await db.query('INSERT INTO ojt_items (day_id, position, title) VALUES ($1,$2,$3) RETURNING id', [
    req.params.dayId,
    position,
    title,
  ]);
  const itemId = rows[0].id;
  for (let i = 0; i < (subchecks || []).length; i++) {
    await db.query('INSERT INTO ojt_subchecks (item_id, position, label) VALUES ($1,$2,$3)', [itemId, i, subchecks[i]]);
  }
  await audit(req.user.id, 'edit_checklist_add_item', 'ojt_item', itemId, { title });
  res.status(201).json({ id: itemId });
});

router.post('/:foId/subcheck/:subcheckId', requireAuth, async (req, res) => {
  const foId = Number(req.params.foId);
  if (req.user.role === 'fo' && req.user.id !== foId) {
    return res.status(403).json({ error: 'Not allowed' });
  }
  const { checked } = req.body;
  const { rows: scRows } = await db.query('SELECT * FROM ojt_subchecks WHERE id = $1', [req.params.subcheckId]);
  const subcheck = scRows[0];
  if (!subcheck) return res.status(404).json({ error: 'Sub-check not found' });

  const { rows: itemRows } = await db.query('SELECT * FROM ojt_items WHERE id = $1', [subcheck.item_id]);
  const item = itemRows[0];
  const { rows: dayProgressRows } = await db.query(
    'SELECT * FROM ojt_fo_days WHERE fo_id = $1 AND day_id = $2',
    [foId, item.day_id]
  );
  const dayProgress = dayProgressRows[0];
  if (!dayProgress || dayProgress.status === 'locked') {
    return res.status(400).json({ error: 'This day is locked' });
  }
  if (dayProgress.status === 'approved') {
    return res.status(400).json({ error: 'This day is already approved' });
  }

  await db.query(
    `INSERT INTO ojt_fo_subchecks (fo_id, subcheck_id, checked, checked_at)
     VALUES ($1,$2,$3, now())
     ON CONFLICT (fo_id, subcheck_id) DO UPDATE SET checked = EXCLUDED.checked, checked_at = now()`,
    [foId, subcheck.id, !!checked]
  );

  res.json({ ok: true });
});

router.post('/:foId/days/:dayId/submit', requireAuth, async (req, res) => {
  const foId = Number(req.params.foId);
  if (req.user.role === 'fo' && req.user.id !== foId) {
    return res.status(403).json({ error: 'Not allowed' });
  }
  const dayId = Number(req.params.dayId);
  const { rows: progressRows } = await db.query('SELECT * FROM ojt_fo_days WHERE fo_id = $1 AND day_id = $2', [foId, dayId]);
  const progress = progressRows[0];
  if (!progress || progress.status === 'locked') {
    return res.status(400).json({ error: 'This day is locked' });
  }

  await db.query(`UPDATE ojt_fo_days SET status = 'submitted', submitted_at = now() WHERE id = $1`, [progress.id]);

  const { rows: reviewers } = await db.query("SELECT id FROM users WHERE role IN ('trainer','supervisor')");
  const { rows: foRows } = await db.query('SELECT * FROM users WHERE id = $1', [foId]);
  const { rows: dayRows } = await db.query('SELECT * FROM ojt_days WHERE id = $1', [dayId]);
  const fo = foRows[0];
  const day = dayRows[0];
  for (const r of reviewers) {
    await notify(r.id, 'ojt_submitted', `${fo.name} submitted ${day.title} for review.`, foId);
  }

  res.json({ ok: true });
});

router.post('/:foId/days/:dayId/review', requireAuth, requireRole('admin', 'supervisor', 'trainer'), async (req, res) => {
  const foId = Number(req.params.foId);
  const dayId = Number(req.params.dayId);
  const { decision, comment } = req.body;
  if (!['approved', 'needs_redo'].includes(decision)) {
    return res.status(400).json({ error: "decision must be 'approved' or 'needs_redo'" });
  }

  const { rows: progressRows } = await db.query('SELECT * FROM ojt_fo_days WHERE fo_id = $1 AND day_id = $2', [foId, dayId]);
  const progress = progressRows[0];
  if (!progress) return res.status(404).json({ error: 'Progress row not found' });

  if (decision === 'needs_redo') {
    if (progress.redo_count >= 2) {
      return res.status(400).json({ error: 'This day has already been sent back twice. Decide next steps outside the app.' });
    }
    await db.query(
      `UPDATE ojt_fo_days SET status = 'needs_redo', redo_count = redo_count + 1,
       reviewer_comment = $1, reviewed_by = $2, reviewed_at = now() WHERE id = $3`,
      [comment || null, req.user.id, progress.id]
    );
  } else {
    await db.query(
      `UPDATE ojt_fo_days SET status = 'approved', reviewer_comment = $1, reviewed_by = $2,
       reviewed_at = now(), approved_at = now() WHERE id = $3`,
      [comment || null, req.user.id, progress.id]
    );

    const { rows: dayRows } = await db.query('SELECT * FROM ojt_days WHERE id = $1', [dayId]);
    const day = dayRows[0];
    const { rows: nextDayRows } = await db.query('SELECT * FROM ojt_days WHERE day_number = $1', [day.day_number + 1]);
    const nextDay = nextDayRows[0];

    if (nextDay) {
      const { rows: nextProgressRows } = await db.query(
        'SELECT * FROM ojt_fo_days WHERE fo_id = $1 AND day_id = $2',
        [foId, nextDay.id]
      );
      const nextProgress = nextProgressRows[0];
      if (nextProgress && nextProgress.status === 'locked') {
        await db.query(`UPDATE ojt_fo_days SET status = 'in_progress' WHERE id = $1`, [nextProgress.id]);
      }
    } else {
      const { rows: notifyList } = await db.query("SELECT id FROM users WHERE role IN ('admin','trainer','supervisor')");
      const { rows: foRows } = await db.query('SELECT * FROM users WHERE id = $1', [foId]);
      const fo = foRows[0];
      for (const r of notifyList) {
        await notify(r.id, 'ojt_eligible', `${fo.name} completed all 5 OJT days — Eligible for Production.`, foId);
      }
    }
  }

  await audit(req.user.id, 'review_ojt_day', 'ojt_fo_day', progress.id, { decision, comment });
  res.json({ ok: true });
});

router.get('/overview/all', requireAuth, requireRole('admin', 'supervisor', 'trainer'), async (req, res) => {
  const { rows: fos } = await db.query("SELECT * FROM users WHERE role = 'fo' AND stage = 'ojt'");
  const overview = [];
  for (const fo of fos) {
    const { rows: days } = await db.query(
      `SELECT d.day_number, d.title, p.status, p.redo_count, p.reviewer_comment
       FROM ojt_days d LEFT JOIN ojt_fo_days p ON p.day_id = d.id AND p.fo_id = $1
       ORDER BY d.day_number`,
      [fo.id]
    );
    const currentDay = days.find((d) => ['in_progress', 'needs_redo', 'submitted'].includes(d.status));
    const approvedCount = days.filter((d) => d.status === 'approved').length;
    overview.push({
      fo: { id: fo.id, name: fo.name, city: fo.city, status: fo.status },
      currentDay: currentDay?.day_number ?? (approvedCount === days.length ? 'complete' : null),
      approvedCount,
      totalDays: days.length,
      days,
    });
  }
  res.json({ overview });
});

router.get('/:foId/eligible', requireAuth, async (req, res) => {
  const foId = Number(req.params.foId);
  const { rows: totalRows } = await db.query('SELECT COUNT(*)::int as total FROM ojt_days');
  const { rows: approvedRows } = await db.query(
    `SELECT COUNT(*)::int as c FROM ojt_fo_days WHERE fo_id = $1 AND status = 'approved'`,
    [foId]
  );
  const total = totalRows[0].total;
  const approved = approvedRows[0].c;
  res.json({ eligible: approved === total && total > 0, approved, total });
});

module.exports = router;
