// Migreert data van OLD_DATABASE_URL naar DATABASE_URL (zelfde schema).
// Idempotent: draait alleen als de doel-DB nog géén users heeft.
// Als OLD_DATABASE_URL niet gezet is, is dit een no-op.
//
// Wordt aangeroepen vanuit server.js bij het opstarten (Render free tier
// heeft geen pre-deploy commands). Na een succesvolle migratie kan
// OLD_DATABASE_URL uit de env vars worden gehaald — de functie doet dan
// niets meer. Kan ook los draaien: `node migrate.js`.

require('dotenv').config();
const { Pool } = require('pg');

async function migrate() {
  const oldUrl = process.env.OLD_DATABASE_URL;
  const newUrl = process.env.DATABASE_URL;

  if (!newUrl) {
    console.error('[migrate] DATABASE_URL ontbreekt — niets te doen.');
    return;
  }
  if (!oldUrl) {
    console.log('[migrate] OLD_DATABASE_URL niet gezet — skip (dit is normaal na de eerste migratie).');
    return;
  }
  if (oldUrl === newUrl) {
    console.log('[migrate] OLD_DATABASE_URL == DATABASE_URL — skip.');
    return;
  }

  const { poolConfig } = require('./db');
  const src = new Pool(poolConfig(oldUrl, 3));
  const dst = new Pool(poolConfig(newUrl, 3));

  try {
    // Zorg dat het schema bestaat in de nieuwe DB.
    console.log('[migrate] Schema-check op DATABASE_URL…');
    const { init } = require('./db');
    await init();

    // Idempotent: skip als er al users staan.
    const { rows: existing } = await dst.query('SELECT COUNT(*)::int AS n FROM users');
    if (existing[0].n > 0) {
      console.log(`[migrate] Doel-DB heeft al ${existing[0].n} users — migratie overslaan.`);
      return;
    }

    // Check of de bron bereikbaar is + heeft data.
    let srcUsers;
    try {
      srcUsers = await src.query('SELECT COUNT(*)::int AS n FROM users');
    } catch (err) {
      console.error('[migrate] Kan OLD_DATABASE_URL niet bereiken:', err.message);
      console.error('[migrate] Deploy gaat door zonder migratie. Nieuwe DB blijft leeg.');
      return;
    }
    if (srcUsers.rows[0].n === 0) {
      console.log('[migrate] Bron-DB heeft geen users — niets te kopiëren.');
      return;
    }

    console.log(`[migrate] Kopieer ${srcUsers.rows[0].n} users + gerelateerde data…`);

    // Kopieer in transactie: users → checklists → items.
    const client = await dst.connect();
    try {
      await client.query('BEGIN');

      const { rows: users } = await src.query(
        'SELECT id, email, password_hash, created_at FROM users ORDER BY id'
      );
      for (const u of users) {
        await client.query(
          'INSERT INTO users (id, email, password_hash, created_at) VALUES ($1,$2,$3,$4)',
          [u.id, u.email, u.password_hash, u.created_at]
        );
      }

      const { rows: cls } = await src.query(
        `SELECT id, user_id, name, destination, start_date, end_date, travelers,
                transport, weather, accommodation, activities, created_at, updated_at
           FROM checklists ORDER BY id`
      );
      for (const c of cls) {
        await client.query(
          `INSERT INTO checklists
             (id, user_id, name, destination, start_date, end_date, travelers,
              transport, weather, accommodation, activities, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9::jsonb,$10,$11::jsonb,$12,$13)`,
          [
            c.id, c.user_id, c.name, c.destination, c.start_date, c.end_date,
            JSON.stringify(c.travelers),
            c.transport,
            JSON.stringify(c.weather),
            c.accommodation,
            JSON.stringify(c.activities),
            c.created_at, c.updated_at,
          ]
        );
      }

      // Oudere databases missen de kolommen quantity/packed — val dan
      // terug op de basis-kolommen (de '× N'-conversie herstelt de
      // aantallen daarna alsnog).
      let items;
      try {
        ({ rows: items } = await src.query(
          `SELECT id, checklist_id, text, category, is_checked, position, created_at, quantity, packed, traveler
             FROM items ORDER BY id`
        ));
      } catch {
        ({ rows: items } = await src.query(
          `SELECT id, checklist_id, text, category, is_checked, position, created_at
             FROM items ORDER BY id`
        ));
      }
      for (const it of items) {
        await client.query(
          `INSERT INTO items (id, checklist_id, text, category, is_checked, position, created_at, quantity, packed, traveler)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [it.id, it.checklist_id, it.text, it.category, it.is_checked, it.position, it.created_at,
           it.quantity ?? 1, it.packed ?? 0, it.traveler ?? null]
        );
      }

      // Reset sequences zodat AUTO_INCREMENT verder gaat vanaf max(id).
      await client.query(`SELECT setval(pg_get_serial_sequence('users','id'), COALESCE((SELECT MAX(id) FROM users), 1))`);
      await client.query(`SELECT setval(pg_get_serial_sequence('checklists','id'), COALESCE((SELECT MAX(id) FROM checklists), 1))`);
      await client.query(`SELECT setval(pg_get_serial_sequence('items','id'), COALESCE((SELECT MAX(id) FROM items), 1))`);

      await client.query('COMMIT');

      // Zet '× N'-teksten en '(Naam)'-labels uit de oude database om
      // naar de quantity- en traveler-velden.
      const { convertLegacyData } = require('./db');
      await convertLegacyData();

      console.log(`[migrate] Klaar: ${users.length} users, ${cls.length} checklists, ${items.length} items gekopieerd.`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } finally {
    await src.end().catch(() => {});
    await dst.end().catch(() => {});
  }
}

module.exports = { migrate };

// Los aangeroepen (node migrate.js): draai direct.
if (require.main === module) {
  migrate()
    .then(() => require('./db').pool.end())
    .catch(err => {
      console.error('[migrate] Migratie mislukt:', err);
      process.exit(1);
    });
}
