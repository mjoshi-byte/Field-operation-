require('dotenv').config();
require('express-async-errors'); // lets thrown/rejected errors in async route handlers reach the error middleware below
const express = require('express');
const cors = require('cors');

const app = express();

// In production (Vercel) the frontend is a different origin, so CORS must be scoped
// to it explicitly. Locally, with no ALLOWED_ORIGIN set, allow anything.
const allowedOrigin = process.env.ALLOWED_ORIGIN; // e.g. https://your-frontend.vercel.app
app.use(cors(allowedOrigin ? { origin: allowedOrigin } : {}));
app.use(express.json({ limit: '5mb' }));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/ojt', require('./routes/ojt'));
app.use('/api/updates', require('./routes/updates'));
app.use('/api/library', require('./routes/library'));
app.use('/api/dashboard', require('./routes/dashboard'));

app.get('/api/health', (req, res) => res.json({ ok: true }));

// Centralized error handler so a thrown/rejected promise in a route doesn't crash silently.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Server error' });
});

// Running locally (`npm start`) starts a real server. On Vercel, this file is only
// ever `require`d by api/index.js (see vercel.json), which exports `app` instead —
// Vercel wraps it as a serverless function and calls `app` directly per request, so
// app.listen() never runs there.
if (require.main === module) {
  const PORT = process.env.PORT || 4000;
  app.listen(PORT, () => console.log(`FO Training API listening on http://localhost:${PORT}`));
}

module.exports = app;
