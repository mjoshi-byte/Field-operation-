const { db } = require('../db');

function requireAuth(req, res, next) {
  const token = req.headers['authorization']?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not signed in' });

  const session = db
    .prepare('SELECT * FROM sessions WHERE token = ? AND expires_at > datetime("now")')
    .get(token);
  if (!session) return res.status(401).json({ error: 'Session expired, sign in again' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(session.user_id);
  if (!user) return res.status(401).json({ error: 'User not found' });

  req.user = user;
  next();
}

// Pass one or more allowed roles, e.g. requireRole('admin'), requireRole('admin','supervisor','trainer')
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not signed in' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: `Requires role: ${roles.join(' or ')}` });
    }
    next();
  };
}

function audit(actorId, action, targetType, targetId, details) {
  db.prepare(
    `INSERT INTO audit_log (actor_id, action, target_type, target_id, details) VALUES (?,?,?,?,?)`
  ).run(actorId, action, targetType ?? null, targetId ?? null, details ? JSON.stringify(details) : null);
}

function notify(userId, type, message, relatedId) {
  db.prepare(
    `INSERT INTO notifications (user_id, type, message, related_id) VALUES (?,?,?,?)`
  ).run(userId, type, message, relatedId ?? null);
}

module.exports = { requireAuth, requireRole, audit, notify };
