const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.warn(
    'DATABASE_URL is not set. Copy backend/.env.example to backend/.env and fill in your Supabase connection string.'
  );
}

// Supabase's pooled connection string needs SSL; `rejectUnauthorized: false` matches
// what Supabase's own docs recommend for server-side connections.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
});

// Thin helper so route files can do `const { rows } = await db.query(sql, params)`.
const db = {
  query: (text, params) => pool.query(text, params),
  pool,
};

module.exports = { db };
