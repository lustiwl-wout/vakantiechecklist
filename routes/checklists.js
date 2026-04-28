const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../auth');
const { generateItems } = require('../templates');

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

router.post('/', async (req, res) => {
  const {
    name,
    destination,
    startDate,
    endDate,
    travelers,
    transport,
    weather,
    accommodation,
    activities,
  } = req.body || {};

  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'Naam is verplicht' });
  }

  const cleanTravelers = Array.isArray(travelers)
    ? travelers
        .map(t => ({ age: t && t.age != null && t.age !== '' ? Number(t.age) : null }))
        .filter(t => t.age == null || (Number.isFinite(t.age) && t.age >= 0 && t.age <= 120))
    : [];
  if (cleanTravelers.length === 0) cleanTravelers.push({ age: null });

  const cleanActivities = Array.isArray(activities) ? activities.map(String) : [];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO checklists (user_id, name, destination, start_date, end_date, travelers, transport, weather, accommodation, activities)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10::jsonb)
       RETURNING *`,
      [
        req.userId,
        String(name).trim(),
        destination || null,
        startDate || null,
        endDate || null,
        JSON.stringify(cleanTravelers),
        transport || null,
        weather || null,
        accommodation || null,
        JSON.stringify(cleanActivities),
      ]
    );
    const checklist = rows[0];

    const generated = generateItems({
      destination,
      startDate,
      endDate,
      travelers: cleanTravelers,
      transport,
      weather,
      accommodation,
      activities: cleanActivities,
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
  const { name } = req.body || {};
  if (name != null && String(name).trim()) {
    await pool.query('UPDATE checklists SET name = $1, updated_at = NOW() WHERE id = $2', [String(name).trim(), checklist.id]);
  }
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

module.exports = router;
