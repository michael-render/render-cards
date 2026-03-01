const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cards (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name        TEXT NOT NULL,
      title       TEXT NOT NULL DEFAULT '',
      fun_title   TEXT NOT NULL DEFAULT '',
      tagline     TEXT NOT NULL DEFAULT '',
      responses   JSONB NOT NULL DEFAULT '{}',
      skills      JSONB NOT NULL DEFAULT '[]',
      stats       JSONB NOT NULL DEFAULT '[]',
      photo_url   TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Add columns if upgrading from old schema
  const cols = ['fun_title', 'tagline', 'responses'];
  for (const col of cols) {
    await pool.query(`
      ALTER TABLE cards ADD COLUMN IF NOT EXISTS ${col} ${col === 'responses' ? 'JSONB NOT NULL DEFAULT \'{}\'': 'TEXT NOT NULL DEFAULT \'\''}
    `).catch(() => {});
  }

  console.log('Database initialized');
}

module.exports = { pool, initDb };
