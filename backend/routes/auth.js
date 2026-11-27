const express = require('express');
const crypto = require('crypto');
const { db } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// NOTE: "FO access: access method and identity checks for people without company
// email" is an OPEN decision in the blueprint. This implements phone number + OTP
// as a reasonable placeholder for everyone (FO/Trainer/Supervisor/Admin all have
// mobile_number). Swap sendOtpViaSms() for a real SMS gateway when that decision
// is made; everything downstream (sessions, roles) stays the same.

function genCode() {
  return String(Math.floor(100000 + Math.random() * 900000)); // 6 digits
}

function sendOtpViaSms(mobileNumber, code) {
  // Placeholder: no SMS gateway wired up yet. Logged server-side so you can test.
  console.log(`[OTP] ${mobileNumber} -> ${code}`);
}

// POST /api/auth/request-otp { mobile_number }
router.post('/request-otp', (req, res) => {
  const { mobile_number } = req.body;
  if (!mobile_number) return res.status(400).json({ error: 'mobile_number required' });

  const user = db.prepare('SELECT * FROM users WHERE mobile_number = ?').get(mobile_number);
  if (!user) return res.status(404).json({ error: 'No account with this mobile number. Ask your admin to add you.' });

  const code = genCode();
  const expires = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO otp_codes (mobile_number, code, expires_at) VALUES (?,?,?)').run(
    mobile_number,
    code,
    expires
  );
  sendOtpViaSms(mobile_number, code);

  // dev_code is only returned because there's no SMS gateway wired up yet — remove in production.
  res.json({ ok: true, dev_code: code });
});

// POST /api/auth/verify-otp { mobile_number, code }
router.post('/verify-otp', (req, res) => {
  const { mobile_number, code } = req.body;
  const row = db
    .prepare(
      `SELECT * FROM otp_codes WHERE mobile_number = ? AND code = ? AND used = 0 AND expires_at > datetime("now")
       ORDER BY id DESC LIMIT 1`
    )
    .get(mobile_number, code);
  if (!row) return res.status(401).json({ error: 'Invalid or expired code' });

  db.prepare('UPDATE otp_codes SET used = 1 WHERE id = ?').run(row.id);

  const user = db.prepare('SELECT * FROM users WHERE mobile_number = ?').get(mobile_number);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const token = crypto.randomBytes(24).toString('hex');
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString(); // 14 days
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)').run(
    token,
    user.id,
    expiresAt
  );

  res.json({ token, user: sanitize(user) });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: sanitize(req.user) });
});

router.post('/logout', requireAuth, (req, res) => {
  const token = req.headers['authorization']?.replace('Bearer ', '');
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.json({ ok: true });
});

function sanitize(user) {
  const { ...u } = user;
  return u;
}

module.exports = router;
