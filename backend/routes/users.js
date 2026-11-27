const express = require('express');
const { db } = require('../db');
const { requireAuth, requireRole, audit, notify } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  if (req.user.role === 'fo') {
    return res.json({ users: [req.user] });
  }
  const { stage, city, status, role } = req.query;
  const clauses = [];
  const params = [];
  if (stage) { params.push(stage); clauses.push(`stage = $${params.length}`); }
  if (city) { params.push(city); clauses.push(`city = $${params.length}`); }
  if (status) { params.push(status); clauses.push(`status = $${params.length}`); }
  if (role) { params.push(role); clauses.push(`role = $${params.length}`); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const { rows } = await db.query(`SELECT * FROM users ${where} ORDER BY created_at DESC`, params);
  res.json({ users: rows });
});

// Admin: add a new hire (FO) — or a new trainer/supervisor/admin account, by email.
// They'll be linked to this row automatically the first time they sign in with that email.
router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  const { name, email, mobile_number, city, preferred_language, role, stage } = req.body;
  if (!name || !email) {
    return res.status(400).json({ error: 'name and email are required' });
  }
  const finalRole = role || 'fo';
  const finalStage = finalRole === 'fo' ? (stage || 'ojt') : null;

  try {
    const { rows } = await db.query(
      `INSERT INTO users (name, email, mobile_number, city, preferred_language, role, stage, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [name, email.toLowerCase(), mobile_number || null, city || null, preferred_language || 'en', finalRole, finalStage, req.user.id]
    );
    const user = rows[0];

    if (finalRole === 'fo' && finalStage === 'ojt') {
      const { rows: days } = await db.query('SELECT * FROM ojt_days ORDER BY day_number');
      for (let i = 0; i < days.length; i++) {
        await db.query('INSERT INTO ojt_fo_days (fo_id, day_id, status) VALUES ($1,$2,$3)', [
          user.id,
          days[i].id,
          i === 0 ? 'in_progress' : 'locked',
        ]);
      }
    }

    await audit(req.user.id, 'add_user', 'user', user.id, { name, email, role: finalRole, stage: finalStage });
    res.status(201).json({ user });
  } catch (e) {
    if (String(e).includes('duplicate key')) {
      return res.status(409).json({ error: 'A user with this email already exists' });
    }
    res.status(500).json({ error: String(e) });
  }
});

// Admin: change someone's role
router.post('/:id/role', requireAuth, requireRole('admin'), async (req, res) => {
  const { role } = req.body;
  if (!['fo', 'trainer', 'supervisor', 'admin'].includes(role)) {
    return res.status(400).json({ error: 'invalid role' });
  }
  const stage = role === 'fo' ? 'ojt' : null;
  const { rows } = await db.query('UPDATE users SET role = $1, stage = COALESCE(stage, $2) WHERE id = $3 RETURNING *', [
    role,
    stage,
    req.params.id,
  ]);
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });
  await audit(req.user.id, 'change_role', 'user', req.params.id, { role });
  res.json({ user: rows[0] });
});

router.post('/:id/move-stage', requireAuth, requireRole('admin', 'supervisor', 'trainer'), async (req, res) => {
  const { stage } = req.body;
  if (!['ojt', 'production'].includes(stage)) {
    return res.status(400).json({ error: "stage must be 'ojt' or 'production'" });
  }
  const { rows: foRows } = await db.query('SELECT * FROM users WHERE id = $1 AND role = $2', [req.params.id, 'fo']);
  const fo = foRows[0];
  if (!fo) return res.status(404).json({ error: 'FO not found' });

  await db.query('UPDATE users SET stage = $1 WHERE id = $2', [stage, fo.id]);

  if (stage === 'ojt' && fo.stage !== 'ojt') {
    const { rows: days } = await db.query('SELECT * FROM ojt_days ORDER BY day_number');
    for (let i = 0; i < days.length; i++) {
      const { rows: existing } = await db.query('SELECT 1 FROM ojt_fo_days WHERE fo_id = $1 AND day_id = $2', [
        fo.id,
        days[i].id,
      ]);
      if (existing.length === 0) {
        await db.query('INSERT INTO ojt_fo_days (fo_id, day_id, status) VALUES ($1,$2,$3)', [
          fo.id,
          days[i].id,
          i === 0 ? 'in_progress' : 'locked',
        ]);
      }
    }
  }

  await audit(req.user.id, 'move_stage', 'user', fo.id, { from: fo.stage, to: stage });
  const { rows } = await db.query('SELECT * FROM users WHERE id = $1', [fo.id]);
  res.json({ user: rows[0] });
});

router.post('/:id/hold', requireAuth, requireRole('admin', 'supervisor', 'trainer'), async (req, res) => {
  const { reason } = req.body;
  const { rows: targetRows } = await db.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
  const target = targetRows[0];
  if (!target) return res.status(404).json({ error: 'User not found' });

  await db.query(
    `UPDATE users SET status = 'on_hold', hold_reason = $1, held_by = $2, held_at = now() WHERE id = $3`,
    [reason || null, req.user.id, target.id]
  );
  await notify(target.id, 'hold', `You've been put on hold${reason ? `: ${reason}` : ''}. Reach out to your trainer or supervisor.`, target.id);
  await audit(req.user.id, 'hold', 'user', target.id, { reason });
  const { rows } = await db.query('SELECT * FROM users WHERE id = $1', [target.id]);
  res.json({ user: rows[0] });
});

router.post('/:id/release-hold', requireAuth, requireRole('admin', 'supervisor', 'trainer'), async (req, res) => {
  const { rows: targetRows } = await db.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
  const target = targetRows[0];
  if (!target) return res.status(404).json({ error: 'User not found' });

  await db.query(
    `UPDATE users SET status = 'active', hold_reason = NULL, held_by = NULL, held_at = NULL WHERE id = $1`,
    [target.id]
  );
  await notify(target.id, 'off_hold', "You're back in action — hold lifted.", target.id);
  await audit(req.user.id, 'release_hold', 'user', target.id, {});
  const { rows } = await db.query('SELECT * FROM users WHERE id = $1', [target.id]);
  res.json({ user: rows[0] });
});

router.post('/:id/shadowing', requireAuth, requireRole('admin', 'supervisor', 'trainer'), async (req, res) => {
  const { shadowing_fo_id } = req.body;
  await db.query('UPDATE users SET shadowing_fo_id = $1 WHERE id = $2', [shadowing_fo_id || null, req.params.id]);
  await audit(req.user.id, 'set_shadowing', 'user', req.params.id, { shadowing_fo_id });
  const { rows } = await db.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
  res.json({ user: rows[0] });
});

router.get('/:id', requireAuth, async (req, res) => {
  if (req.user.role === 'fo' && String(req.user.id) !== req.params.id) {
    return res.status(403).json({ error: 'Not allowed' });
  }
  const { rows } = await db.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });
  res.json({ user: rows[0] });
});

module.exports = router;
