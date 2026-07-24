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

    CREATE TABLE IF NOT EXISTS geo_cache (
      key TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS templates (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      items JSONB NOT NULL DEFAULT '[]',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS family_members (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      birthdate DATE NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_checklists_user ON checklists(user_id);
    CREATE INDEX IF NOT EXISTS idx_items_checklist ON items(checklist_id);
    CREATE INDEX IF NOT EXISTS idx_family_user ON family_members(user_id);
    CREATE INDEX IF NOT EXISTS idx_templates_user ON templates(user_id);
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
    ALTER TABLE checklists ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION;
    ALTER TABLE checklists ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;
    ALTER TABLE checklists ADD COLUMN IF NOT EXISTS border_countries JSONB NOT NULL DEFAULT '[]';
  `);

  // Data-hygiëne: 'Gedeeld' is het gereserveerde woord voor items zonder
  // eigenaar, maar was even als échte reizigersnaam op te slaan via het
  // vrije invoerveld. Idempotente opschoning van wat er zo in kwam.
  await pool.query("UPDATE items SET traveler = NULL WHERE traveler ILIKE 'gedeeld'").catch(() => {});
  await pool.query(`
    UPDATE checklists SET travelers = COALESCE(
      (SELECT jsonb_agg(t) FROM jsonb_array_elements(travelers) AS t
        WHERE NOT (lower(coalesce(t->>'name', '')) = 'gedeeld'
                   AND t->>'birthdate' IS NULL
                   AND t->>'category' IS NULL
                   AND t->>'age' IS NULL)),
      '[]'::jsonb)
    WHERE EXISTS (
      SELECT 1 FROM jsonb_array_elements(travelers) AS t
       WHERE lower(coalesce(t->>'name', '')) = 'gedeeld'
         AND t->>'birthdate' IS NULL
         AND t->>'category' IS NULL
         AND t->>'age' IS NULL)
  `).catch(() => {});

  // Ruim heel oude geo-cache op (best effort) en log de stand, zodat in
  // de Render-logs zichtbaar is of de omgevings-cache gevuld raakt.
  await pool.query("DELETE FROM geo_cache WHERE fetched_at < NOW() - interval '90 days'").catch(() => {});
  await pool.query('SELECT COUNT(*)::int AS n FROM geo_cache')
    .then(r => console.log(`[geo/cache] ${r.rows[0].n} locatie(s) in de database-cache`))
    .catch(() => {});
}

module.exports = { pool, init };
