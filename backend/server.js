require('dotenv').config();
require('express-async-errors'); // lets thrown/rejected errors in async route handlers reach the error middleware below
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
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

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`FO Training API listening on http://localhost:${PORT}`));
