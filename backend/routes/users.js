const express = require('express');
const { db } = require('../db');
const { requireAuth, requireRole, audit, notify } = require('../middleware/auth');

const router = express.Router();

// List users (admin/supervisor/trainer see all; FO sees only self)
router.get('/', requireAuth, (req, res) => {
  if (req.user.role === 'fo') {
    return res.json({ users: [sanitize(req.user)] });
  }
  const { stage, city, status, role } = req.query;
  let sql = 'SELECT * FROM users WHERE 1=1';
  const params = [];
  if (stage) { sql += ' AND stage = ?'; params.push(stage); }
  if (city) { sql += ' AND city = ?'; params.push(city); }
  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (role) { sql += ' AND role = ?'; params.push(role); }
  sql += ' ORDER BY created_at DESC';
  const users = db.prepare(sql).all(...params);
  res.json({ users: users.map(sanitize) });
});

// Admin: add a new hire (FO) — or a new trainer/supervisor/admin account
router.post('/', requireAuth, requireRole('admin'), (req, res) => {
  const { name, mobile_number, city, preferred_language, role, stage } = req.body;
  if (!name || !mobile_number) {
    return res.status(400).json({ error: 'name and mobile_number are required' });
  }
  const finalRole = role || 'fo';
  const finalStage = finalRole === 'fo' ? (stage || 'ojt') : null;

  try {
    const info = db
      .prepare(
        `INSERT INTO users (name, mobile_number, city, preferred_language, role, stage, created_by)
         VALUES (?,?,?,?,?,?,?)`
      )
      .run(name, mobile_number, city || null, preferred_language || 'en', finalRole, finalStage, req.user.id);

    if (finalRole === 'fo' && finalStage === 'ojt') {
      // Initialize OJT day rows: day 1 unlocked/in_progress, others locked
      const days = db.prepare('SELECT * FROM ojt_days ORDER BY day_number').all();
      days.forEach((day, idx) => {
        db.prepare('INSERT INTO ojt_fo_days (fo_id, day_id, status) VALUES (?,?,?)').run(
          info.lastInsertRowid,
          day.id,
          idx === 0 ? 'in_progress' : 'locked'
        );
      });
    }

    audit(req.user.id, 'add_user', 'user', info.lastInsertRowid, { name, role: finalRole, stage: finalStage });
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json({ user: sanitize(user) });
  } catch (e) {
    if (String(e).includes('UNIQUE')) {
      return res.status(409).json({ error: 'A user with this mobile number already exists' });
    }
    res.status(500).json({ error: String(e) });
  }
});

// Move an FO between OJT and Production (admin, supervisor, trainer)
router.post('/:id/move-stage', requireAuth, requireRole('admin', 'supervisor', 'trainer'), (req, res) => {
  const { stage } = req.body; // 'ojt' | 'production'
  if (!['ojt', 'production'].includes(stage)) {
    return res.status(400).json({ error: "stage must be 'ojt' or 'production'" });
  }
  const fo = db.prepare('SELECT * FROM users WHERE id = ? AND role = ?').get(req.params.id, 'fo');
  if (!fo) return res.status(404).json({ error: 'FO not found' });

  db.prepare('UPDATE users SET stage = ? WHERE id = ?').run(stage, fo.id);

  if (stage === 'ojt' && fo.stage !== 'ojt') {
    // (Re)initialize OJT progress rows if missing
    const days = db.prepare('SELECT * FROM ojt_days ORDER BY day_number').all();
    days.forEach((day, idx) => {
      const exists = db
        .prepare('SELECT 1 FROM ojt_fo_days WHERE fo_id = ? AND day_id = ?')
        .get(fo.id, day.id);
      if (!exists) {
        db.prepare('INSERT INTO ojt_fo_days (fo_id, day_id, status) VALUES (?,?,?)').run(
          fo.id,
          day.id,
          idx === 0 ? 'in_progress' : 'locked'
        );
      }
    });
  }

  audit(req.user.id, 'move_stage', 'user', fo.id, { from: fo.stage, to: stage });
  res.json({ user: sanitize(db.prepare('SELECT * FROM users WHERE id = ?').get(fo.id)) });
});

// Put a user on hold (trainer/supervisor/admin)
router.post('/:id/hold', requireAuth, requireRole('admin', 'supervisor', 'trainer'), (req, res) => {
  const { reason } = req.body;
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found' });

  db.prepare(
    'UPDATE users SET status = "on_hold", hold_reason = ?, held_by = ?, held_at = datetime("now") WHERE id = ?'
  ).run(reason || null, req.user.id, target.id);

  notify(target.id, 'hold', `You've been put on hold${reason ? `: ${reason}` : ''}. Reach out to your trainer or supervisor.`, target.id);
  audit(req.user.id, 'hold', 'user', target.id, { reason });
  res.json({ user: sanitize(db.prepare('SELECT * FROM users WHERE id = ?').get(target.id)) });
});

// Take a user off hold
router.post('/:id/release-hold', requireAuth, requireRole('admin', 'supervisor', 'trainer'), (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found' });

  db.prepare(
    'UPDATE users SET status = "active", hold_reason = NULL, held_by = NULL, held_at = NULL WHERE id = ?'
  ).run(target.id);

  notify(target.id, 'off_hold', "You're back in action — hold lifted.", target.id);
  audit(req.user.id, 'release_hold', 'user', target.id, {});
  res.json({ user: sanitize(db.prepare('SELECT * FROM users WHERE id = ?').get(target.id)) });
});

// Set which existing FO a trainee is shadowing during OJT
router.post('/:id/shadowing', requireAuth, requireRole('admin', 'supervisor', 'trainer'), (req, res) => {
  const { shadowing_fo_id } = req.body;
  db.prepare('UPDATE users SET shadowing_fo_id = ? WHERE id = ?').run(shadowing_fo_id || null, req.params.id);
  audit(req.user.id, 'set_shadowing', 'user', req.params.id, { shadowing_fo_id });
  res.json({ user: sanitize(db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id)) });
});

router.get('/:id', requireAuth, (req, res) => {
  if (req.user.role === 'fo' && String(req.user.id) !== req.params.id) {
    return res.status(403).json({ error: 'Not allowed' });
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  res.json({ user: sanitize(user) });
});

function sanitize(user) {
  return { ...user };
}

module.exports = router;
