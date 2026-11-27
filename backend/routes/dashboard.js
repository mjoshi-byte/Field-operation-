const express = require('express');
const { db } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// FO's own performance view
router.get('/fo/:id', requireAuth, (req, res) => {
  const foId = Number(req.params.id);
  if (req.user.role === 'fo' && req.user.id !== foId) return res.status(403).json({ error: 'Not allowed' });

  const fo = db.prepare('SELECT * FROM users WHERE id = ?').get(foId);
  if (!fo) return res.status(404).json({ error: 'Not found' });

  const pendingItems = db
    .prepare(
      `SELECT fus.*, u.title, u.kind FROM fo_update_status fus JOIN updates u ON u.id = fus.update_id
       WHERE fus.fo_id = ? AND fus.status IN ('pending','acknowledged','overdue') ORDER BY fus.deadline_at`
    )
    .all(foId);

  const scoreHistory = db
    .prepare(
      `SELECT qa.*, u.title FROM quiz_attempts qa JOIN updates u ON u.id = qa.update_id
       WHERE qa.fo_id = ? ORDER BY qa.taken_at DESC`
    )
    .all(foId);

  const totalAssigned = db.prepare('SELECT COUNT(*) c FROM fo_update_status WHERE fo_id = ?').get(foId).c;
  const totalCompleted = db
    .prepare("SELECT COUNT(*) c FROM fo_update_status WHERE fo_id = ? AND status = 'passed'")
    .get(foId).c;

  let ojtSummary = null;
  if (fo.stage === 'ojt') {
    const total = db.prepare('SELECT COUNT(*) c FROM ojt_days').get().c;
    const approved = db
      .prepare("SELECT COUNT(*) c FROM ojt_fo_days WHERE fo_id = ? AND status = 'approved'")
      .get(foId).c;
    ojtSummary = { approved, total };
  }

  res.json({
    fo: { id: fo.id, name: fo.name, stage: fo.stage, status: fo.status, hold_reason: fo.hold_reason },
    pendingItems,
    scoreHistory,
    progress: { completed: totalCompleted, total: totalAssigned },
    ojtSummary,
  });
});

// Team performance / analytics (admin, supervisor, trainer)
router.get('/team', requireAuth, requireRole('admin', 'supervisor', 'trainer'), (req, res) => {
  const { city, updateId, from, to } = req.query;

  let foSql = "SELECT * FROM users WHERE role = 'fo'";
  const foParams = [];
  if (city) { foSql += ' AND city = ?'; foParams.push(city); }
  const fos = db.prepare(foSql).all(...foParams);

  const fosAtAGlance = fos.map((f) => ({ id: f.id, name: f.name, city: f.city, stage: f.stage, status: f.status }));

  // Per-update stats
  let updateSql = "SELECT * FROM updates WHERE status != 'draft'";
  const updateParams = [];
  if (updateId) { updateSql += ' AND id = ?'; updateParams.push(updateId); }
  if (from) { updateSql += ' AND published_at >= ?'; updateParams.push(from); }
  if (to) { updateSql += ' AND published_at <= ?'; updateParams.push(to); }
  const updates = db.prepare(updateSql).all(...updateParams);

  const updateStats = updates.map((u) => {
    const statuses = db.prepare('SELECT status FROM fo_update_status WHERE update_id = ?').all(u.id);
    const opened = db.prepare('SELECT COUNT(*) c FROM fo_update_status WHERE update_id = ? AND opened_at IS NOT NULL').get(u.id).c;
    const acknowledged = db.prepare('SELECT COUNT(*) c FROM fo_update_status WHERE update_id = ? AND acknowledged_at IS NOT NULL').get(u.id).c;
    const passed = statuses.filter((s) => s.status === 'passed').length;
    const failed = statuses.filter((s) => s.status === 'failed').length;
    return {
      id: u.id,
      title: u.title,
      kind: u.kind,
      assigned: statuses.length,
      opened,
      acknowledged,
      took_quiz: passed + failed,
      passed,
      failed,
    };
  });

  // Who is late
  const late = db
    .prepare(
      `SELECT fus.*, u.title, us.name as fo_name, us.city
       FROM fo_update_status fus
       JOIN updates u ON u.id = fus.update_id
       JOIN users us ON us.id = fus.fo_id
       WHERE fus.status IN ('pending','overdue') AND fus.deadline_at < datetime('now')
       ORDER BY fus.deadline_at ASC`
    )
    .all()
    .map((r) => ({
      ...r,
      hours_overdue: Math.round((Date.now() - new Date(r.deadline_at).getTime()) / 3600000),
    }));

  // Quiz analytics: average score, pass rate, most-missed questions [flagged OPEN in the blueprint —
  // implemented as a best-effort default; confirm requirements before relying on it]
  const allAttempts = db.prepare('SELECT * FROM quiz_attempts').all();
  const avgScore = allAttempts.length
    ? Math.round(allAttempts.reduce((s, a) => s + a.score_percent, 0) / allAttempts.length)
    : null;
  const passRate = allAttempts.length
    ? Math.round((allAttempts.filter((a) => a.passed).length / allAttempts.length) * 100)
    : null;

  const missCounts = {};
  allAttempts.forEach((a) => {
    const answers = JSON.parse(a.answers_json || '[]');
    answers.forEach((ans) => {
      if (!ans.correct) missCounts[ans.question_id] = (missCounts[ans.question_id] || 0) + 1;
    });
  });
  const mostMissed = Object.entries(missCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([questionId, misses]) => {
      const q = db.prepare('SELECT question_text FROM quiz_questions WHERE id = ?').get(questionId);
      return { question_id: Number(questionId), question_text: q?.question_text, misses };
    });

  res.json({
    fosAtAGlance,
    updateStats,
    late,
    quizAnalytics: { avgScore, passRate, mostMissed, note: 'Quiz analytics scope is an open decision in the blueprint — treat as a default until confirmed.' },
  });
});

// OJT & Production have separate leaderboards — no combined leaderboard (per the blueprint)
router.get('/leaderboard/:stage', requireAuth, requireRole('admin', 'supervisor', 'trainer'), (req, res) => {
  const stage = req.params.stage; // 'ojt' | 'production'
  if (!['ojt', 'production'].includes(stage)) return res.status(400).json({ error: 'invalid stage' });

  const fos = db.prepare('SELECT * FROM users WHERE role = ? AND stage = ?').all('fo', stage);
  const rows = fos.map((fo) => {
    const attempts = db.prepare('SELECT * FROM quiz_attempts WHERE fo_id = ?').all(fo.id);
    const avg = attempts.length ? Math.round(attempts.reduce((s, a) => s + a.score_percent, 0) / attempts.length) : 0;
    const passed = attempts.filter((a) => a.passed).length;
    return { fo_id: fo.id, name: fo.name, city: fo.city, avg_score: avg, quizzes_passed: passed, attempts: attempts.length };
  });
  rows.sort((a, b) => b.avg_score - a.avg_score);
  res.json({ stage, leaderboard: rows });
});

// Notifications for the current user
router.get('/notifications', requireAuth, (req, res) => {
  const notifications = db
    .prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 100')
    .all(req.user.id);
  res.json({ notifications });
});

router.post('/notifications/:id/read', requireAuth, (req, res) => {
  db.prepare('UPDATE notifications SET read_at = datetime("now") WHERE id = ? AND user_id = ?').run(
    req.params.id,
    req.user.id
  );
  res.json({ ok: true });
});

// Audit log (admin only)
router.get('/audit', requireAuth, requireRole('admin'), (req, res) => {
  const log = db
    .prepare(
      `SELECT al.*, u.name as actor_name FROM audit_log al LEFT JOIN users u ON u.id = al.actor_id
       ORDER BY al.created_at DESC LIMIT 500`
    )
    .all();
  res.json({ log: log.map((l) => ({ ...l, details: l.details ? JSON.parse(l.details) : null })) });
});

// CSV export of update/quiz data (download of data as a spreadsheet)
router.get('/export/updates.csv', requireAuth, requireRole('admin', 'supervisor', 'trainer'), (req, res) => {
  const rows = db
    .prepare(
      `SELECT u.title, us.name as fo_name, us.city, fus.status, fus.deadline_at, fus.acknowledged_at
       FROM fo_update_status fus
       JOIN updates u ON u.id = fus.update_id
       JOIN users us ON us.id = fus.fo_id
       ORDER BY u.title, us.name`
    )
    .all();
  const header = 'Update,FO,City,Status,Deadline,Acknowledged At\n';
  const csv =
    header +
    rows
      .map((r) =>
        [r.title, r.fo_name, r.city, r.status, r.deadline_at, r.acknowledged_at]
          .map((v) => `"${(v ?? '').toString().replace(/"/g, '""')}"`)
          .join(',')
      )
      .join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="updates-export.csv"');
  res.send(csv);
});

module.exports = router;
