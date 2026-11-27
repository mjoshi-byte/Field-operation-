const express = require('express');
const { db } = require('../db');
const { requireAuth, requireRole, audit, notify } = require('../middleware/auth');

const router = express.Router();

function fullChecklist(foId) {
  const days = db.prepare('SELECT * FROM ojt_days ORDER BY day_number').all();
  return days.map((day) => {
    const progress = db
      .prepare('SELECT * FROM ojt_fo_days WHERE fo_id = ? AND day_id = ?')
      .get(foId, day.id);
    const items = db.prepare('SELECT * FROM ojt_items WHERE day_id = ? ORDER BY position').all(day.id);
    const itemsWithSubchecks = items.map((item) => {
      const subchecks = db
        .prepare('SELECT * FROM ojt_subchecks WHERE item_id = ? ORDER BY position')
        .all(item.id);
      const withState = subchecks.map((sc) => {
        const state = db
          .prepare('SELECT * FROM ojt_fo_subchecks WHERE fo_id = ? AND subcheck_id = ?')
          .get(foId, sc.id);
        return { ...sc, checked: !!state?.checked };
      });
      return { ...item, subchecks: withState, done: withState.every((s) => s.checked) };
    });
    return {
      ...day,
      progress: progress || { status: 'locked', redo_count: 0 },
      items: itemsWithSubchecks,
    };
  });
}

// GET /api/ojt/:foId/checklist
router.get('/:foId/checklist', requireAuth, (req, res) => {
  const foId = Number(req.params.foId);
  if (req.user.role === 'fo' && req.user.id !== foId) {
    return res.status(403).json({ error: 'Not allowed' });
  }
  res.json({ checklist: fullChecklist(foId) });
});

// Admin: edit the checklist (add/remove a day, change an item) — simplified create/update endpoints
router.get('/template', requireAuth, (req, res) => {
  res.json({ checklist: fullChecklist(0).map(({ progress, items, ...day }) => ({
    ...day,
    items: items.map(({ done, subchecks, ...item }) => ({ ...item, subchecks: subchecks.map(({checked, ...s}) => s) })),
  })) });
});

router.post('/days', requireAuth, requireRole('admin'), (req, res) => {
  const { day_number, title } = req.body;
  const info = db.prepare('INSERT INTO ojt_days (day_number, title) VALUES (?,?)').run(day_number, title);
  audit(req.user.id, 'edit_checklist_add_day', 'ojt_day', info.lastInsertRowid, { day_number, title });
  res.status(201).json({ id: info.lastInsertRowid });
});

router.post('/days/:dayId/items', requireAuth, requireRole('admin'), (req, res) => {
  const { position, title, subchecks } = req.body; // subchecks: string[]
  const info = db
    .prepare('INSERT INTO ojt_items (day_id, position, title) VALUES (?,?,?)')
    .run(req.params.dayId, position, title);
  (subchecks || []).forEach((label, idx) => {
    db.prepare('INSERT INTO ojt_subchecks (item_id, position, label) VALUES (?,?,?)').run(
      info.lastInsertRowid,
      idx,
      label
    );
  });
  audit(req.user.id, 'edit_checklist_add_item', 'ojt_item', info.lastInsertRowid, { title });
  res.status(201).json({ id: info.lastInsertRowid });
});

// FO ticks a sub-check
router.post('/:foId/subcheck/:subcheckId', requireAuth, (req, res) => {
  const foId = Number(req.params.foId);
  if (req.user.role === 'fo' && req.user.id !== foId) {
    return res.status(403).json({ error: 'Not allowed' });
  }
  const { checked } = req.body;
  const subcheck = db.prepare('SELECT * FROM ojt_subchecks WHERE id = ?').get(req.params.subcheckId);
  if (!subcheck) return res.status(404).json({ error: 'Sub-check not found' });

  const item = db.prepare('SELECT * FROM ojt_items WHERE id = ?').get(subcheck.item_id);
  const dayProgress = db
    .prepare('SELECT * FROM ojt_fo_days WHERE fo_id = ? AND day_id = ?')
    .get(foId, item.day_id);
  if (!dayProgress || dayProgress.status === 'locked') {
    return res.status(400).json({ error: 'This day is locked' });
  }
  if (dayProgress.status === 'approved') {
    return res.status(400).json({ error: 'This day is already approved' });
  }

  const existing = db
    .prepare('SELECT * FROM ojt_fo_subchecks WHERE fo_id = ? AND subcheck_id = ?')
    .get(foId, subcheck.id);
  if (existing) {
    db.prepare('UPDATE ojt_fo_subchecks SET checked = ?, checked_at = datetime("now") WHERE id = ?').run(
      checked ? 1 : 0,
      existing.id
    );
  } else {
    db.prepare(
      'INSERT INTO ojt_fo_subchecks (fo_id, subcheck_id, checked, checked_at) VALUES (?,?,?,datetime("now"))'
    ).run(foId, subcheck.id, checked ? 1 : 0);
  }

  res.json({ ok: true });
});

// FO submits a day for review (status -> submitted); Trainer notified
router.post('/:foId/days/:dayId/submit', requireAuth, (req, res) => {
  const foId = Number(req.params.foId);
  if (req.user.role === 'fo' && req.user.id !== foId) {
    return res.status(403).json({ error: 'Not allowed' });
  }
  const dayId = Number(req.params.dayId);
  const progress = db.prepare('SELECT * FROM ojt_fo_days WHERE fo_id = ? AND day_id = ?').get(foId, dayId);
  if (!progress || progress.status === 'locked') {
    return res.status(400).json({ error: 'This day is locked' });
  }

  db.prepare(
    'UPDATE ojt_fo_days SET status = "submitted", submitted_at = datetime("now") WHERE id = ?'
  ).run(progress.id);

  // Notify all trainers/supervisors
  const reviewers = db.prepare("SELECT id FROM users WHERE role IN ('trainer','supervisor')").all();
  const fo = db.prepare('SELECT * FROM users WHERE id = ?').get(foId);
  const day = db.prepare('SELECT * FROM ojt_days WHERE id = ?').get(dayId);
  reviewers.forEach((r) =>
    notify(r.id, 'ojt_submitted', `${fo.name} submitted ${day.title} for review.`, foId)
  );

  res.json({ ok: true });
});

// Trainer/supervisor/admin reviews a submitted day: approve or needs_redo
router.post(
  '/:foId/days/:dayId/review',
  requireAuth,
  requireRole('admin', 'supervisor', 'trainer'),
  (req, res) => {
    const foId = Number(req.params.foId);
    const dayId = Number(req.params.dayId);
    const { decision, comment } = req.body; // 'approved' | 'needs_redo'
    if (!['approved', 'needs_redo'].includes(decision)) {
      return res.status(400).json({ error: "decision must be 'approved' or 'needs_redo'" });
    }

    const progress = db.prepare('SELECT * FROM ojt_fo_days WHERE fo_id = ? AND day_id = ?').get(foId, dayId);
    if (!progress) return res.status(404).json({ error: 'Progress row not found' });

    if (decision === 'needs_redo') {
      if (progress.redo_count >= 2) {
        return res.status(400).json({
          error: 'This day has already been sent back twice. Decide next steps outside the app.',
        });
      }
      db.prepare(
        `UPDATE ojt_fo_days SET status = 'needs_redo', redo_count = redo_count + 1,
         reviewer_comment = ?, reviewed_by = ?, reviewed_at = datetime("now") WHERE id = ?`
      ).run(comment || null, req.user.id, progress.id);
    } else {
      db.prepare(
        `UPDATE ojt_fo_days SET status = 'approved', reviewer_comment = ?, reviewed_by = ?,
         reviewed_at = datetime("now"), approved_at = datetime("now") WHERE id = ?`
      ).run(comment || null, req.user.id, progress.id);

      // Unlock next day
      const day = db.prepare('SELECT * FROM ojt_days WHERE id = ?').get(dayId);
      const nextDay = db
        .prepare('SELECT * FROM ojt_days WHERE day_number = ?')
        .get(day.day_number + 1);
      if (nextDay) {
        const nextProgress = db
          .prepare('SELECT * FROM ojt_fo_days WHERE fo_id = ? AND day_id = ?')
          .get(foId, nextDay.id);
        if (nextProgress && nextProgress.status === 'locked') {
          db.prepare('UPDATE ojt_fo_days SET status = "in_progress" WHERE id = ?').run(nextProgress.id);
        }
      } else {
        // Day 5 approved -> OJT complete / Eligible for Production
        const notifyList = db
          .prepare("SELECT id FROM users WHERE role IN ('admin','trainer','supervisor')")
          .all();
        const fo = db.prepare('SELECT * FROM users WHERE id = ?').get(foId);
        notifyList.forEach((r) =>
          notify(r.id, 'ojt_eligible', `${fo.name} completed all 5 OJT days — Eligible for Production.`, foId)
        );
      }
    }

    audit(req.user.id, 'review_ojt_day', 'ojt_fo_day', progress.id, { decision, comment });
    res.json({ ok: true });
  }
);

// Overview for trainer/supervisor/admin: every FO's OJT status
router.get('/overview/all', requireAuth, requireRole('admin', 'supervisor', 'trainer'), (req, res) => {
  const fos = db.prepare("SELECT * FROM users WHERE role = 'fo' AND stage = 'ojt'").all();
  const overview = fos.map((fo) => {
    const days = db
      .prepare(
        `SELECT d.day_number, d.title, p.status, p.redo_count, p.reviewer_comment
         FROM ojt_days d LEFT JOIN ojt_fo_days p ON p.day_id = d.id AND p.fo_id = ?
         ORDER BY d.day_number`
      )
      .all(fo.id);
    const currentDay = days.find((d) => d.status === 'in_progress' || d.status === 'needs_redo' || d.status === 'submitted');
    const approvedCount = days.filter((d) => d.status === 'approved').length;
    return {
      fo: { id: fo.id, name: fo.name, city: fo.city, status: fo.status },
      currentDay: currentDay?.day_number ?? (approvedCount === days.length ? 'complete' : null),
      approvedCount,
      totalDays: days.length,
      days,
    };
  });
  res.json({ overview });
});

// Is this FO eligible for production?
router.get('/:foId/eligible', requireAuth, (req, res) => {
  const foId = Number(req.params.foId);
  const days = db
    .prepare(`SELECT COUNT(*) as total FROM ojt_days`)
    .get().total;
  const approved = db
    .prepare(`SELECT COUNT(*) as c FROM ojt_fo_days WHERE fo_id = ? AND status = 'approved'`)
    .get(foId).c;
  res.json({ eligible: approved === days && days > 0, approved, total: days });
});

module.exports = router;
