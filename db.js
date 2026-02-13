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
      title       TEXT NOT NULL,
      skills      JSONB NOT NULL DEFAULT '[]',
      stats       JSONB NOT NULL DEFAULT '[]',
      photo_url   TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  console.log('Database initialized');
}

module.exports = { pool, initDb };
