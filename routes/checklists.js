const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../auth');
const { generateItems, defaultQuantities } = require('../templates');

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

function cleanTravelers(input) {
  const arr = Array.isArray(input) ? input : [];
  const out = arr
    .map(t => ({
      name: t && typeof t.name === 'string' ? t.name.trim().slice(0, 60) : '',
      age: t && t.age != null && t.age !== '' ? Number(t.age) : null,
    }))
    .filter(t => t.name || t.age != null)
    .filter(t => t.age == null || (Number.isFinite(t.age) && t.age >= 0 && t.age <= 120));
  if (!out.length) out.push({ name: '', age: null });
  return out;
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
  for (const k of ['underwear', 'socks', 'tops', 'bottoms']) {
    if (input[k] !== undefined && input[k] !== '' && input[k] !== null) {
      const n = Number(input[k]);
      if (Number.isFinite(n) && n >= 0 && n <= 99) out[k] = Math.round(n);
    }
  }
  return out;
}

router.post('/', async (req, res) => {
  const {
    name, destination, startDate, endDate,
    travelers, transport, weather, accommodation,
    activities, medications, quantities,
  } = req.body || {};

  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'Naam is verplicht' });
  }

  const ct = cleanTravelers(travelers);
  const ca = Array.isArray(activities) ? [...new Set(activities.map(String))] : [];
  const cw = cleanWeather(weather);
  const cm = Array.isArray(medications)
    ? medications.map(m => String(m || '').trim()).filter(Boolean).slice(0, 50)
    : [];
  const cq = cleanQuantities(quantities);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO checklists (user_id, name, destination, start_date, end_date, travelers, transport, weather, accommodation, activities)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb, $9, $10::jsonb)
       RETURNING *`,
      [
        req.userId,
        String(name).trim(),
        destination || null,
        startDate || null,
        endDate || null,
        JSON.stringify(ct),
        transport || null,
        JSON.stringify(cw),
        accommodation || null,
        JSON.stringify(ca),
      ]
    );
    const checklist = rows[0];

    const generated = generateItems({
      destination, startDate, endDate,
      travelers: ct, transport, weather: cw,
      accommodation, activities: ca,
      medications: cm, quantities: cq,
    });

    if (generated.length) {
      const values = [];
      const params = [];
      generated.forEach((it, idx) => {
        const base = idx * 4;
        params.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`);
        values.push(checklist.id, it.text, it.category, it.position);
      });
      await client.query(
        `INSERT INTO items (checklist_id, text, category, position) VALUES ${params.join(', ')}`,
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
    'SELECT id, text, category, is_checked, position FROM items WHERE checklist_id = $1 ORDER BY position, id',
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

  if (typeof req.body.name === 'string' && req.body.name.trim()) set('name', req.body.name.trim());
  if ('destination' in req.body) set('destination', req.body.destination || null);
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

  if (!updates.length) return res.json({ ok: true });
  updates.push('updated_at = NOW()');
  params.push(checklist.id);
  await pool.query(`UPDATE checklists SET ${updates.join(', ')} WHERE id = $${p}`, params);
  res.json({ ok: true });
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
  const text = String(req.body.text || '').trim();
  const category = req.body.category ? String(req.body.category) : 'Overig';
  if (!text) return res.status(400).json({ error: 'Tekst is verplicht' });

  const { rows: max } = await pool.query(
    'SELECT COALESCE(MAX(position), -1) AS max FROM items WHERE checklist_id = $1',
    [checklist.id]
  );
  const position = Number(max[0].max) + 1;

  const { rows } = await pool.query(
    `INSERT INTO items (checklist_id, text, category, position)
     VALUES ($1, $2, $3, $4)
     RETURNING id, text, category, is_checked, position`,
    [checklist.id, text, category, position]
  );
  res.json({ item: rows[0] });
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
      `INSERT INTO checklists (user_id, name, destination, start_date, end_date, travelers, transport, weather, accommodation, activities)
       SELECT user_id, $2, destination, start_date, end_date, travelers, transport, weather, accommodation, activities
         FROM checklists WHERE id = $1
       RETURNING *`,
      [checklist.id, `${checklist.name} (kopie)`]
    );
    const newId = cl[0].id;
    await client.query(
      `INSERT INTO items (checklist_id, text, category, position)
       SELECT $2, text, category, position FROM items WHERE checklist_id = $1 ORDER BY position, id`,
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
