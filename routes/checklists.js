const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../auth');
const { generateItems, defaultQuantities } = require('../templates');
const { getCountry } = require('../countries');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT c.id, c.name, c.destination, c.start_date, c.end_date, c.created_at,
            (SELECT COUNT(*) FROM items i WHERE i.checklist_id = c.id) AS total,
            (SELECT COUNT(*) FROM items i WHERE i.checklist_id = c.id AND i.is_checked) AS done
       FROM checklists c
      WHERE c.user_id = $1
      ORDER BY c.created_at DESC`,
    [req.userId]
  );
  res.json({ checklists: rows });
});

const TRAVELER_CATEGORIES = new Set(['baby', 'peuter', 'kind', 'tiener', 'volwassene', 'senior']);

// Drie vormen van reiziger:
//  - gezinslid:    { memberId, name, birthdate }  (leeftijd berekend op vertrekdatum)
//  - medereiziger: { name?, category }            (leeftijdscategorie)
//  - legacy:       { name?, age }                 (oudere checklists)
function cleanTravelers(input) {
  const arr = Array.isArray(input) ? input : [];
  const out = arr
    .map(t => {
      if (!t || typeof t !== 'object') return null;
      const name = typeof t.name === 'string' ? t.name.trim().slice(0, 60) : '';
      if (t.birthdate && /^\d{4}-\d{2}-\d{2}$/.test(String(t.birthdate))) {
        const memberId = Number.isInteger(Number(t.memberId)) ? Number(t.memberId) : null;
        return { memberId, name, birthdate: String(t.birthdate) };
      }
      if (t.category && TRAVELER_CATEGORIES.has(String(t.category))) {
        return { name, category: String(t.category) };
      }
      if (t.age != null && t.age !== '') {
        const age = Number(t.age);
        if (Number.isFinite(age) && age >= 0 && age <= 120) return { name, age };
        return null;
      }
      return name ? { name } : null;
    })
    .filter(Boolean);
  if (!out.length) out.push({ name: '' });
  return out.slice(0, 20);
}

function cleanWeather(input) {
  const valid = new Set(['hot','warm','mild','cool','cold','freezing','sunny','rainy','snow']);
  if (typeof input === 'string' && input) input = [input];
  if (!Array.isArray(input)) return [];
  return [...new Set(input.map(String).filter(v => valid.has(v)))];
}

function cleanQuantities(input) {
  if (!input || typeof input !== 'object') return {};
  const out = {};
  for (const k of ['underwear', 'socks', 'tshirts', 'sweaters', 'bottoms']) {
    if (input[k] !== undefined && input[k] !== '' && input[k] !== null) {
      const n = Number(input[k]);
      if (Number.isFinite(n) && n >= 0 && n <= 99) out[k] = Math.round(n);
    }
  }
  return out;
}

router.post('/', async (req, res) => {
  const {
    name, destination, country, startDate, endDate,
    travelers, transport, weather, accommodation,
    activities, medications, quantities, rentalCar,
    lat, lng,
  } = req.body || {};

  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'Naam is verplicht' });
  }
  if (startDate && endDate && endDate < startDate) {
    return res.status(400).json({ error: 'De terugkomstdatum ligt vóór de vertrekdatum' });
  }

  const ct = cleanTravelers(travelers);
  const ca = Array.isArray(activities) ? [...new Set(activities.map(String))] : [];
  const cw = cleanWeather(weather);
  const cm = Array.isArray(medications)
    ? medications.map(m => String(m || '').trim()).filter(Boolean).slice(0, 50)
    : [];
  const cq = cleanQuantities(quantities);
  const cc = getCountry(country) ? String(country).toLowerCase() : null;
  const rc = rentalCar === true;
  const cleanCoord = (v, max) => (Number.isFinite(Number(v)) && Math.abs(Number(v)) <= max) ? Number(v) : null;
  const clat = cleanCoord(lat, 90);
  const clng = cleanCoord(lng, 180);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO checklists (user_id, name, destination, country, start_date, end_date, travelers, transport, weather, accommodation, activities, rental_car, lat, lng)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::jsonb, $10, $11::jsonb, $12, $13, $14)
       RETURNING *`,
      [
        req.userId,
        String(name).trim(),
        destination || null,
        cc,
        startDate || null,
        endDate || null,
        JSON.stringify(ct),
        transport || null,
        JSON.stringify(cw),
        accommodation || null,
        JSON.stringify(ca),
        rc,
        clat,
        clng,
      ]
    );
    const checklist = rows[0];

    const generated = generateItems({
      destination, country: cc, startDate, endDate,
      travelers: ct, transport, weather: cw,
      accommodation, activities: ca,
      medications: cm, quantities: cq, rentalCar: rc,
    });

    if (generated.length) {
      const values = [];
      const params = [];
      generated.forEach((it, idx) => {
        const base = idx * 6;
        params.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, 'generated')`);
        values.push(checklist.id, it.text, it.category, it.position, it.quantity || 1, it.traveler || null);
      });
      await client.query(
        `INSERT INTO items (checklist_id, text, category, position, quantity, traveler, origin) VALUES ${params.join(', ')}`,
        values
      );
    }

    await client.query('COMMIT');
    res.json({ checklist });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Kon checklist niet aanmaken' });
  } finally {
    client.release();
  }
});

async function loadOwnedChecklist(userId, id) {
  const { rows } = await pool.query(
    'SELECT * FROM checklists WHERE id = $1 AND user_id = $2',
    [id, userId]
  );
  return rows[0] || null;
}

router.get('/:id', async (req, res) => {
  const checklist = await loadOwnedChecklist(req.userId, req.params.id);
  if (!checklist) return res.status(404).json({ error: 'Checklist niet gevonden' });
  const { rows: items } = await pool.query(
    'SELECT id, text, category, is_checked, position, quantity, packed, traveler FROM items WHERE checklist_id = $1 ORDER BY position, id',
    [checklist.id]
  );
  res.json({ checklist, items });
});

router.patch('/:id', async (req, res) => {
  const checklist = await loadOwnedChecklist(req.userId, req.params.id);
  if (!checklist) return res.status(404).json({ error: 'Checklist niet gevonden' });

  const updates = [];
  const params = [];
  let p = 1;
  const set = (col, val) => { updates.push(`${col} = $${p++}`); params.push(val); };

  if ('startDate' in req.body && 'endDate' in req.body
      && req.body.startDate && req.body.endDate
      && req.body.endDate < req.body.startDate) {
    return res.status(400).json({ error: 'De terugkomstdatum ligt vóór de vertrekdatum' });
  }

  if (typeof req.body.name === 'string' && req.body.name.trim()) set('name', req.body.name.trim());
  if ('destination' in req.body) set('destination', req.body.destination || null);
  if ('country' in req.body) set('country', getCountry(req.body.country) ? String(req.body.country).toLowerCase() : null);
  if ('rentalCar' in req.body) set('rental_car', req.body.rentalCar === true);
  if ('lat' in req.body) set('lat', Number.isFinite(Number(req.body.lat)) && Math.abs(req.body.lat) <= 90 ? Number(req.body.lat) : null);
  if ('lng' in req.body) set('lng', Number.isFinite(Number(req.body.lng)) && Math.abs(req.body.lng) <= 180 ? Number(req.body.lng) : null);
  if ('startDate' in req.body) set('start_date', req.body.startDate || null);
  if ('endDate' in req.body) set('end_date', req.body.endDate || null);
  if ('transport' in req.body) set('transport', req.body.transport || null);
  if ('accommodation' in req.body) set('accommodation', req.body.accommodation || null);
  if ('weather' in req.body) {
    updates.push(`weather = $${p++}::jsonb`);
    params.push(JSON.stringify(cleanWeather(req.body.weather)));
  }
  if ('travelers' in req.body) {
    updates.push(`travelers = $${p++}::jsonb`);
    params.push(JSON.stringify(cleanTravelers(req.body.travelers)));
  }
  if ('activities' in req.body) {
    updates.push(`activities = $${p++}::jsonb`);
    params.push(JSON.stringify(Array.isArray(req.body.activities) ? [...new Set(req.body.activities.map(String))] : []));
  }

  if (!updates.length) return res.json({ ok: true, suggestions: [], removals: [] });
  updates.push('updated_at = NOW()');
  params.push(checklist.id);
  await pool.query(`UPDATE checklists SET ${updates.join(', ')} WHERE id = $${p}`, params);

  // Vergelijk wat de generator vóór en ná de wijziging zou maken.
  // Nieuw t.o.v. de lijst → suggestie om toe te voegen (behalve wat de
  // gebruiker ooit bewust verwijderde). Wél op de lijst maar niet meer
  // nodig volgens de nieuwe gegevens → suggestie om te verwijderen.
  const genInput = (c) => ({
    destination: c.destination,
    country: c.country,
    startDate: c.start_date,
    endDate: c.end_date,
    travelers: c.travelers,
    transport: c.transport,
    weather: c.weather,
    accommodation: c.accommodation,
    activities: c.activities,
    rentalCar: c.rental_car,
  });

  const { rows: fresh } = await pool.query('SELECT * FROM checklists WHERE id = $1', [checklist.id]);
  const cur = fresh[0];
  const { rows: existing } = await pool.query(
    'SELECT id, text, category, is_checked, origin FROM items WHERE checklist_id = $1', [checklist.id]
  );
  const norm = s => s.trim().toLowerCase();
  const have = new Set(existing.map(r => norm(r.text)));
  const hasMedItems = existing.some(r => /^medicijn:/i.test(r.text.trim()));
  const removedTexts = new Set(Array.isArray(cur.removed_texts) ? cur.removed_texts : []);

  const oldTexts = new Set(generateItems(genInput(checklist)).map(it => norm(it.text)));
  const newGenerated = generateItems(genInput(cur));
  const newTexts = new Set(newGenerated.map(it => norm(it.text)));

  const suggestions = newGenerated
    .filter(it => !have.has(norm(it.text)))
    .filter(it => !removedTexts.has(norm(it.text)))
    .filter(it => !(hasMedItems && it.text === 'Persoonlijke medicijnen'))
    .map(({ text, category, quantity, traveler }) => ({ text, category, quantity, traveler }));

  // Verwijder-kandidaten: destijds door de generator geplaatst en niet
  // meer in de nieuwe uitvoer. Herkenning via het origin-veld; voor
  // oudere items (origin onbekend) via de oude generator-uitvoer.
  const removals = existing
    .filter(r => (r.origin === 'generated' || oldTexts.has(norm(r.text))) && r.origin !== 'user')
    .filter(r => !newTexts.has(norm(r.text)))
    .map(({ id, text, category, is_checked }) => ({ id, text, category, is_checked }));

  res.json({ ok: true, suggestions, removals });
});

router.delete('/:id', async (req, res) => {
  const result = await pool.query(
    'DELETE FROM checklists WHERE id = $1 AND user_id = $2',
    [req.params.id, req.userId]
  );
  if (result.rowCount === 0) return res.status(404).json({ error: 'Checklist niet gevonden' });
  res.json({ ok: true });
});

router.post('/:id/items', async (req, res) => {
  const checklist = await loadOwnedChecklist(req.userId, req.params.id);
  if (!checklist) return res.status(404).json({ error: 'Checklist niet gevonden' });
  const text = String(req.body.text || '').trim().slice(0, 200);
  const category = req.body.category ? String(req.body.category).slice(0, 60) : 'Overig';
  if (!text) return res.status(400).json({ error: 'Tekst is verplicht' });
  let quantity = Number(req.body.quantity);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) quantity = 1;
  const traveler = (typeof req.body.traveler === 'string' && req.body.traveler.trim())
    ? req.body.traveler.trim().slice(0, 60) : null;

  // Positie in hetzelfde statement bepalen: geen race bij gelijktijdige adds.
  const { rows } = await pool.query(
    `INSERT INTO items (checklist_id, text, category, position, quantity, traveler, origin)
     VALUES ($1, $2, $3,
             (SELECT COALESCE(MAX(position), -1) + 1 FROM items WHERE checklist_id = $1),
             $4, $5, 'user')
     RETURNING id, text, category, is_checked, position, quantity, packed, traveler`,
    [checklist.id, text, category, quantity, traveler]
  );
  res.json({ item: rows[0] });
});

// Meerdere items in één keer toevoegen (gekozen suggesties na bewerken).
router.post('/:id/items/bulk', async (req, res) => {
  const checklist = await loadOwnedChecklist(req.userId, req.params.id);
  if (!checklist) return res.status(404).json({ error: 'Checklist niet gevonden' });

  const list = Array.isArray(req.body.items) ? req.body.items : [];
  const cleaned = list
    .map(it => ({
      text: String((it && it.text) || '').trim().slice(0, 200),
      category: (it && it.category) ? String(it.category).slice(0, 60) : 'Overig',
      quantity: (Number.isInteger(Number(it && it.quantity)) && it.quantity >= 1 && it.quantity <= 99)
        ? Number(it.quantity) : 1,
      traveler: (it && typeof it.traveler === 'string' && it.traveler.trim())
        ? it.traveler.trim().slice(0, 60) : null,
    }))
    .filter(it => it.text)
    .slice(0, 200);
  if (!cleaned.length) return res.json({ items: [] });

  const { rows: max } = await pool.query(
    'SELECT COALESCE(MAX(position), -1) AS max FROM items WHERE checklist_id = $1',
    [checklist.id]
  );
  let position = Number(max[0].max);

  const params = [];
  const values = [];
  cleaned.forEach((it, idx) => {
    const base = idx * 6;
    params.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, 'generated')`);
    values.push(checklist.id, it.text, it.category, ++position, it.quantity, it.traveler);
  });
  const { rows } = await pool.query(
    `INSERT INTO items (checklist_id, text, category, position, quantity, traveler, origin)
     VALUES ${params.join(', ')}
     RETURNING id, text, category, is_checked, position, quantity, packed, traveler`,
    values
  );

  // Wie een eerder verwijderd item opnieuw accepteert, wil het blijkbaar
  // weer — haal het uit het verwijder-geheugen.
  const accepted = cleaned.map(it => it.text.trim().toLowerCase());
  await pool.query(
    `UPDATE checklists SET removed_texts = COALESCE(
       (SELECT jsonb_agg(t) FROM jsonb_array_elements_text(removed_texts) AS t
         WHERE t <> ALL($2::text[])), '[]'::jsonb)
      WHERE id = $1`,
    [checklist.id, accepted]
  );

  res.json({ items: rows });
});

// Meerdere items in één keer verwijderen. remember=true onthoudt de teksten
// zodat de generator ze niet opnieuw voorstelt (bewuste gebruikerskeuze);
// het verwijder-suggestie-scherm gebruikt remember=false zodat items
// terugkomen als de reisplannen weer veranderen.
router.post('/:id/items/bulk-delete', async (req, res) => {
  const checklist = await loadOwnedChecklist(req.userId, req.params.id);
  if (!checklist) return res.status(404).json({ error: 'Checklist niet gevonden' });
  const ids = Array.isArray(req.body.ids)
    ? req.body.ids.map(Number).filter(Number.isInteger).slice(0, 500)
    : [];
  if (!ids.length) return res.json({ ok: true, deleted: 0 });
  const remember = req.body.remember === true;

  const { rows } = await pool.query(
    'DELETE FROM items WHERE checklist_id = $1 AND id = ANY($2::int[]) RETURNING text',
    [checklist.id, ids]
  );
  if (remember && rows.length) {
    const texts = rows.map(r => r.text.trim().toLowerCase());
    await pool.query(
      `UPDATE checklists SET removed_texts = (
         SELECT COALESCE(jsonb_agg(DISTINCT t), '[]'::jsonb) FROM (
           SELECT jsonb_array_elements_text(removed_texts) AS t
           UNION
           SELECT unnest($2::text[])
         ) sub)
        WHERE id = $1`,
      [checklist.id, texts]
    );
  }
  res.json({ ok: true, deleted: rows.length });
});

router.post('/:id/reorder', async (req, res) => {
  const checklist = await loadOwnedChecklist(req.userId, req.params.id);
  if (!checklist) return res.status(404).json({ error: 'Checklist niet gevonden' });
  const ids = Array.isArray(req.body.itemIds)
    ? req.body.itemIds.map(Number).filter(Number.isInteger)
    : [];
  if (!ids.length) return res.json({ ok: true });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT id FROM items WHERE checklist_id = $1 AND id = ANY($2::int[])',
      [checklist.id, ids]
    );
    if (rows.length !== ids.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Ongeldige items' });
    }
    const values = ids.map((id, i) => `(${id}, ${i})`).join(', ');
    await client.query(
      `UPDATE items SET position = v.pos
         FROM (VALUES ${values}) AS v(id, pos)
        WHERE items.id = v.id AND items.checklist_id = $1`,
      [checklist.id]
    );
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Kon volgorde niet opslaan' });
  } finally {
    client.release();
  }
});

router.post('/:id/duplicate', async (req, res) => {
  const checklist = await loadOwnedChecklist(req.userId, req.params.id);
  if (!checklist) return res.status(404).json({ error: 'Checklist niet gevonden' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: cl } = await client.query(
      `INSERT INTO checklists (user_id, name, destination, country, start_date, end_date, travelers, transport, weather, accommodation, activities, rental_car, lat, lng, removed_texts)
       SELECT user_id, $2, destination, country, start_date, end_date, travelers, transport, weather, accommodation, activities, rental_car, lat, lng, removed_texts
         FROM checklists WHERE id = $1
       RETURNING *`,
      [checklist.id, `${checklist.name} (kopie)`]
    );
    const newId = cl[0].id;
    await client.query(
      `INSERT INTO items (checklist_id, text, category, position, quantity, traveler, origin)
       SELECT $2, text, category, position, quantity, traveler, origin FROM items WHERE checklist_id = $1 ORDER BY position, id`,
      [checklist.id, newId]
    );
    await client.query('COMMIT');
    res.json({ checklist: cl[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Kon checklist niet dupliceren' });
  } finally {
    client.release();
  }
});

router.get('/_meta/defaults', (req, res) => {
  const start = req.query.start;
  const end = req.query.end;
  const a = start ? new Date(start) : null;
  const b = end ? new Date(end) : null;
  let days = 7;
  if (a && b && !isNaN(a) && !isNaN(b)) {
    days = Math.max(1, Math.round((b - a) / 86400000) + 1);
  }
  res.json({ days, quantities: defaultQuantities(days) });
});

module.exports = router;
