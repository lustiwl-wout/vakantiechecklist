const { Pool } = require('pg');

const url = process.env.DATABASE_URL || '';
const useSSL = /sslmode=(require|verify-ca|verify-full)/i.test(url) || /\.neon\.tech/i.test(url);

const pool = new Pool({
  connectionString: url,
  ssl: useSSL ? { rejectUnauthorized: false } : false,
  max: 5,
});

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS checklists (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      destination TEXT,
      start_date DATE,
      end_date DATE,
      travelers JSONB NOT NULL DEFAULT '[]',
      transport TEXT,
      weather TEXT,
      accommodation TEXT,
      activities JSONB NOT NULL DEFAULT '[]',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS items (
      id SERIAL PRIMARY KEY,
      checklist_id INTEGER NOT NULL REFERENCES checklists(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      category TEXT,
      is_checked BOOLEAN NOT NULL DEFAULT FALSE,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_checklists_user ON checklists(user_id);
    CREATE INDEX IF NOT EXISTS idx_items_checklist ON items(checklist_id);
  `);

  // Migratie: weather van TEXT naar JSONB (multi-select).
  // Idempotent: alleen als de kolom nog text is.
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_name = 'checklists'
           AND column_name = 'weather'
           AND data_type = 'text'
      ) THEN
        ALTER TABLE checklists
          ALTER COLUMN weather TYPE jsonb
          USING CASE
            WHEN weather IS NULL OR weather = '' THEN '[]'::jsonb
            WHEN weather LIKE '[%' THEN weather::jsonb
            ELSE jsonb_build_array(weather)
          END;
        ALTER TABLE checklists ALTER COLUMN weather SET DEFAULT '[]'::jsonb;
      END IF;
    END $$;
  `);
}

module.exports = { pool, init };
