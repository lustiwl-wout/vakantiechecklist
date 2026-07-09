const { Pool, types } = require('pg');

// DATE-kolommen als 'YYYY-MM-DD'-string laten i.p.v. JS Date op lokale
// middernacht: dat voorkomt een dag verschuiving op niet-UTC-servers.
types.setTypeParser(types.builtins.DATE, v => v);

// We stellen ssl expliciet in via de ssl-optie en strippen de ssl-params
// uit de URL — anders geeft pg >= 8.16 een (onterechte) security warning
// over sslmode-aliassen.
function poolConfig(url, max = 5) {
  const useSSL = /sslmode=(require|verify-ca|verify-full)/i.test(url) || /\.neon\.tech/i.test(url);
  let clean = url;
  try {
    const u = new URL(url);
    u.searchParams.delete('sslmode');
    u.searchParams.delete('channel_binding');
    clean = u.toString();
  } catch { /* geen geldige URL — laat pg zelf klagen */ }
  // Certificaat-verificatie staat aan (Neon gebruikt publiek vertrouwde
  // certificaten). PGSSL_NO_VERIFY=1 is de nooduitgang voor omgevingen
  // met een eigen CA.
  const verify = process.env.PGSSL_NO_VERIFY !== '1';
  return {
    connectionString: clean,
    ssl: useSSL ? { rejectUnauthorized: verify } : false,
    max,
  };
}

const pool = new Pool(poolConfig(process.env.DATABASE_URL || ''));

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

  // Migratie: aantallen als echte velden (quantity = hoeveel mee,
  // packed = hoeveel al ingepakt) i.p.v. '× N' in de item-tekst.
  await pool.query(`
    ALTER TABLE items ADD COLUMN IF NOT EXISTS quantity INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE items ADD COLUMN IF NOT EXISTS packed INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE items ADD COLUMN IF NOT EXISTS traveler TEXT;
    ALTER TABLE checklists ADD COLUMN IF NOT EXISTS country TEXT;
    ALTER TABLE checklists ADD COLUMN IF NOT EXISTS rental_car BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE checklists ADD COLUMN IF NOT EXISTS removed_texts JSONB NOT NULL DEFAULT '[]';
    ALTER TABLE items ADD COLUMN IF NOT EXISTS origin TEXT;
  `);
  await convertLegacyData();
}

// Zet data uit oudere versies om naar de huidige velden. Idempotent en
// apart aanroepbaar omdat migrate.js data uit een oude database kan
// invoegen nádat init() al gedraaid heeft.
async function convertLegacyData() {
  // '× N' in de item-tekst → quantity-veld.
  await pool.query(`
    UPDATE items SET
      quantity = (regexp_match(text, '×\\s*(\\d+)'))[1]::int,
      text = trim(regexp_replace(text, '\\s*×\\s*\\d+', ''))
    WHERE text ~ '×\\s*\\d+' AND quantity = 1
  `);
  await pool.query('UPDATE items SET packed = quantity WHERE is_checked AND packed = 0');

  // '(reiziger N)' of '(Naam)' achteraan de tekst → traveler-veld.
  await pool.query(`
    UPDATE items SET traveler = initcap((regexp_match(text, '\\((reiziger \\d+)\\)\\s*$'))[1])
    WHERE traveler IS NULL AND text ~ '\\(reiziger \\d+\\)\\s*$'
  `);
  const { rows: cls } = await pool.query('SELECT id, travelers FROM checklists');
  for (const cl of cls) {
    const names = (Array.isArray(cl.travelers) ? cl.travelers : [])
      .map(t => t && t.name && String(t.name).trim())
      .filter(Boolean);
    for (const name of names) {
      await pool.query(
        `UPDATE items SET traveler = $1
          WHERE checklist_id = $2 AND traveler IS NULL AND text LIKE '%(' || $1 || ')'`,
        [name, cl.id]
      );
    }
  }

  // Vrije-tekst bestemming → landcode (best effort, alleen waar leeg).
  const { guessCountry } = require('./countries');
  const { rows: noCountry } = await pool.query(
    "SELECT id, destination FROM checklists WHERE country IS NULL AND destination IS NOT NULL AND destination <> ''"
  );
  for (const cl of noCountry) {
    const c = guessCountry(cl.destination);
    if (c) await pool.query('UPDATE checklists SET country = $1 WHERE id = $2', [c.code, cl.id]);
  }
}

module.exports = { pool, init, poolConfig, convertLegacyData };
