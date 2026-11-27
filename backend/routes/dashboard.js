const express = require('express');
const { db } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

router.get('/fo/:id', requireAuth, async (req, res) => {
  const foId = Number(req.params.id);
  if (req.user.role === 'fo' && req.user.id !== foId) return res.status(403).json({ error: 'Not allowed' });

  const { rows: foRows } = await db.query('SELECT * FROM users WHERE id = $1', [foId]);
  const fo = foRows[0];
  if (!fo) return res.status(404).json({ error: 'Not found' });

  const { rows: pendingItems } = await db.query(
    `SELECT fus.*, u.title, u.kind FROM fo_update_status fus JOIN updates u ON u.id = fus.update_id
     WHERE fus.fo_id = $1 AND fus.status IN ('pending','acknowledged','overdue') ORDER BY fus.deadline_at`,
    [foId]
  );

  const { rows: scoreHistory } = await db.query(
    `SELECT qa.*, u.title FROM quiz_attempts qa JOIN updates u ON u.id = qa.update_id
     WHERE qa.fo_id = $1 ORDER BY qa.taken_at DESC`,
    [foId]
  );

  const { rows: totalAssignedRows } = await db.query('SELECT COUNT(*)::int c FROM fo_update_status WHERE fo_id = $1', [foId]);
  const { rows: totalCompletedRows } = await db.query(
    `SELECT COUNT(*)::int c FROM fo_update_status WHERE fo_id = $1 AND status = 'passed'`,
    [foId]
  );

  let ojtSummary = null;
  if (fo.stage === 'ojt') {
    const { rows: totalRows } = await db.query('SELECT COUNT(*)::int c FROM ojt_days');
    const { rows: approvedRows } = await db.query(
      `SELECT COUNT(*)::int c FROM ojt_fo_days WHERE fo_id = $1 AND status = 'approved'`,
      [foId]
    );
    ojtSummary = { approved: approvedRows[0].c, total: totalRows[0].c };
  }

  res.json({
    fo: { id: fo.id, name: fo.name, stage: fo.stage, status: fo.status, hold_reason: fo.hold_reason },
    pendingItems,
    scoreHistory,
    progress: { completed: totalCompletedRows[0].c, total: totalAssignedRows[0].c },
    ojtSummary,
  });
});

router.get('/team', requireAuth, requireRole('admin', 'supervisor', 'trainer'), async (req, res) => {
  const { city, updateId, from, to } = req.query;

  const foParams = [];
  let foSql = "SELECT * FROM users WHERE role = 'fo'";
  if (city) { foParams.push(city); foSql += ` AND city = $${foParams.length}`; }
  const { rows: fos } = await db.query(foSql, foParams);

  const fosAtAGlance = fos.map((f) => ({ id: f.id, name: f.name, city: f.city, stage: f.stage, status: f.status }));

  const updateParams = [];
  let updateSql = "SELECT * FROM updates WHERE status != 'draft'";
  if (updateId) { updateParams.push(updateId); updateSql += ` AND id = $${updateParams.length}`; }
  if (from) { updateParams.push(from); updateSql += ` AND published_at >= $${updateParams.length}`; }
  if (to) { updateParams.push(to); updateSql += ` AND published_at <= $${updateParams.length}`; }
  const { rows: updates } = await db.query(updateSql, updateParams);

  const updateStats = [];
  for (const u of updates) {
    const { rows: statuses } = await db.query('SELECT status FROM fo_update_status WHERE update_id = $1', [u.id]);
    const { rows: openedRows } = await db.query(
      'SELECT COUNT(*)::int c FROM fo_update_status WHERE update_id = $1 AND opened_at IS NOT NULL',
      [u.id]
    );
    const { rows: ackRows } = await db.query(
      'SELECT COUNT(*)::int c FROM fo_update_status WHERE update_id = $1 AND acknowledged_at IS NOT NULL',
      [u.id]
    );
    const passed = statuses.filter((s) => s.status === 'passed').length;
    const failed = statuses.filter((s) => s.status === 'failed').length;
    updateStats.push({
      id: u.id, title: u.title, kind: u.kind, assigned: statuses.length,
      opened: openedRows[0].c, acknowledged: ackRows[0].c, took_quiz: passed + failed, passed, failed,
    });
  }

  const { rows: lateRaw } = await db.query(
    `SELECT fus.*, u.title, us.name as fo_name, us.city
     FROM fo_update_status fus
     JOIN updates u ON u.id = fus.update_id
     JOIN users us ON us.id = fus.fo_id
     WHERE fus.status IN ('pending','overdue') AND fus.deadline_at < now()
     ORDER BY fus.deadline_at ASC`
  );
  const late = lateRaw.map((r) => ({ ...r, hours_overdue: Math.round((Date.now() - new Date(r.deadline_at).getTime()) / 3600000) }));

  const { rows: allAttempts } = await db.query('SELECT * FROM quiz_attempts');
  const avgScore = allAttempts.length ? Math.round(allAttempts.reduce((s, a) => s + a.score_percent, 0) / allAttempts.length) : null;
  const passRate = allAttempts.length ? Math.round((allAttempts.filter((a) => a.passed).length / allAttempts.length) * 100) : null;

  const missCounts = {};
  allAttempts.forEach((a) => {
    const answers = a.answers_json || [];
    answers.forEach((ans) => {
      if (!ans.correct) missCounts[ans.question_id] = (missCounts[ans.question_id] || 0) + 1;
    });
  });
  const mostMissedEntries = Object.entries(missCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const mostMissed = [];
  for (const [questionId, misses] of mostMissedEntries) {
    const { rows } = await db.query('SELECT question_text FROM quiz_questions WHERE id = $1', [questionId]);
    mostMissed.push({ question_id: Number(questionId), question_text: rows[0]?.question_text, misses });
  }

  res.json({
    fosAtAGlance,
    updateStats,
    late,
    quizAnalytics: {
      avgScore, passRate, mostMissed,
      note: 'Quiz analytics scope is an open decision in the blueprint — treat as a default until confirmed.',
    },
  });
});

router.get('/leaderboard/:stage', requireAuth, requireRole('admin', 'supervisor', 'trainer'), async (req, res) => {
  const stage = req.params.stage;
  if (!['ojt', 'production'].includes(stage)) return res.status(400).json({ error: 'invalid stage' });

  const { rows: fos } = await db.query("SELECT * FROM users WHERE role = 'fo' AND stage = $1", [stage]);
  const leaderboard = [];
  for (const fo of fos) {
    const { rows: attempts } = await db.query('SELECT * FROM quiz_attempts WHERE fo_id = $1', [fo.id]);
    const avg = attempts.length ? Math.round(attempts.reduce((s, a) => s + a.score_percent, 0) / attempts.length) : 0;
    const passed = attempts.filter((a) => a.passed).length;
    leaderboard.push({ fo_id: fo.id, name: fo.name, city: fo.city, avg_score: avg, quizzes_passed: passed, attempts: attempts.length });
  }
  leaderboard.sort((a, b) => b.avg_score - a.avg_score);
  res.json({ stage, leaderboard });
});

router.get('/notifications', requireAuth, async (req, res) => {
  const { rows } = await db.query('SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100', [req.user.id]);
  res.json({ notifications: rows });
});

router.post('/notifications/:id/read', requireAuth, async (req, res) => {
  await db.query('UPDATE notifications SET read_at = now() WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
  res.json({ ok: true });
});

router.get('/audit', requireAuth, requireRole('admin'), async (req, res) => {
  const { rows } = await db.query(
    `SELECT al.*, u.name as actor_name FROM audit_log al LEFT JOIN users u ON u.id = al.actor_id
     ORDER BY al.created_at DESC LIMIT 500`
  );
  res.json({ log: rows });
});

router.get('/export/updates.csv', requireAuth, requireRole('admin', 'supervisor', 'trainer'), async (req, res) => {
  const { rows } = await db.query(
    `SELECT u.title, us.name as fo_name, us.city, fus.status, fus.deadline_at, fus.acknowledged_at
     FROM fo_update_status fus
     JOIN updates u ON u.id = fus.update_id
     JOIN users us ON us.id = fus.fo_id
     ORDER BY u.title, us.name`
  );
  const header = 'Update,FO,City,Status,Deadline,Acknowledged At\n';
  const csv =
    header +
    rows
      .map((r) => [r.title, r.fo_name, r.city, r.status, r.deadline_at, r.acknowledged_at]
        .map((v) => `"${(v ?? '').toString().replace(/"/g, '""')}"`)
        .join(','))
      .join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="updates-export.csv"');
  res.send(csv);
});

module.exports = router;
