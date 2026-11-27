const { createClient } = require('@supabase/supabase-js');
const { db } = require('../db');

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.warn(
    'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set. Copy backend/.env.example to backend/.env and fill them in.'
  );
}

// Service-role client: used ONLY on the backend to verify the access token a signed-in
// user sends us, and to look them up. Never expose this key to the frontend.
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Emails in this list are auto-promoted to 'admin' the first time they sign in, so
// there's a way in on a fresh project without an existing admin to add you. Comma-
// separated in .env, e.g. ADMIN_EMAILS=you@company.com,other-admin@company.com
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

async function requireAuth(req, res, next) {
  try {
    const token = req.headers['authorization']?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Not signed in' });

    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data?.user) {
      return res.status(401).json({ error: 'Session expired, sign in again' });
    }
    const authUser = data.user;
    const email = authUser.email?.toLowerCase();
    if (!email) return res.status(401).json({ error: 'Account has no email on file' });

    // Look up (or lazily create) the matching app-level user row.
    let { rows } = await db.query('SELECT * FROM users WHERE auth_user_id = $1', [authUser.id]);
    let user = rows[0];

    if (!user) {
      // Might already exist by email (e.g. an admin added them before they ever signed
      // in) — link it. Otherwise create a fresh row.
      ({ rows } = await db.query('SELECT * FROM users WHERE email = $1', [email]));
      user = rows[0];

      if (user) {
        ({ rows } = await db.query(
          'UPDATE users SET auth_user_id = $1 WHERE id = $2 RETURNING *',
          [authUser.id, user.id]
        ));
        user = rows[0];
      } else {
        const role = ADMIN_EMAILS.includes(email) ? 'admin' : 'fo';
        const stage = role === 'fo' ? 'ojt' : null;
        const name = authUser.user_metadata?.name || email.split('@')[0];
        ({ rows } = await db.query(
          `INSERT INTO users (auth_user_id, name, email, role, stage) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
          [authUser.id, name, email, role, stage]
        ));
        user = rows[0];

        if (role === 'fo') {
          const { rows: days } = await db.query('SELECT * FROM ojt_days ORDER BY day_number');
          for (let i = 0; i < days.length; i++) {
            await db.query(
              'INSERT INTO ojt_fo_days (fo_id, day_id, status) VALUES ($1,$2,$3)',
              [user.id, days[i].id, i === 0 ? 'in_progress' : 'locked']
            );
          }
        }
      }
    }

    req.user = user;
    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Auth check failed: ' + err.message });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not signed in' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: `Requires role: ${roles.join(' or ')}` });
    }
    next();
  };
}

async function audit(actorId, action, targetType, targetId, details) {
  await db.query(
    `INSERT INTO audit_log (actor_id, action, target_type, target_id, details) VALUES ($1,$2,$3,$4,$5)`,
    [actorId, action, targetType ?? null, targetId ?? null, details ? JSON.stringify(details) : null]
  );
}

async function notify(userId, type, message, relatedId) {
  await db.query(
    `INSERT INTO notifications (user_id, type, message, related_id) VALUES ($1,$2,$3,$4)`,
    [userId, type, message, relatedId ?? null]
  );
}

module.exports = { requireAuth, requireRole, audit, notify, supabaseAdmin };
