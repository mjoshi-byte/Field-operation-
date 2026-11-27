const express = require('express');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// All real auth (sending the magic link, verifying it, issuing a session) happens via
// Supabase Auth on the frontend. The frontend sends us the Supabase access_token as a
// Bearer header; requireAuth verifies it and looks up (or lazily creates) the matching
// app user row. This endpoint just hands that row back once verification succeeds.
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
