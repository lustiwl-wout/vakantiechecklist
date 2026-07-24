// Sjablonen: een bewaarde momentopname van de items van een lijst, onder
// een eigen naam. Bij het aanmaken van een nieuwe vakantie kun je zo'n
// sjabloon als startpunt kiezen — de items worden gekopieerd (onaangevinkt).
// Niet te verwarren met ../templates.js (de item-generator).

const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, name, jsonb_array_length(items) AS count, created_at
       FROM templates WHERE user_id = $1 ORDER BY name`,
    [req.userId]
  );
  res.json({ templates: rows });
});

router.post('/', async (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 80);
  const checklistId = Number(req.body.checklistId);
  if (!name) return res.status(400).json({ error: 'Geef het sjabloon een naam' });
  if (!Number.isInteger(checklistId)) return res.status(400).json({ error: 'Checklist ontbreekt' });

  const { rows: cl } = await pool.query(
    'SELECT id FROM checklists WHERE id = $1 AND user_id = $2', [checklistId, req.userId]
  );
  if (!cl[0]) return res.status(404).json({ error: 'Checklist niet gevonden' });

  const { rows: cnt } = await pool.query(
    'SELECT COUNT(*)::int AS n FROM templates WHERE user_id = $1', [req.userId]
  );
  if (cnt[0].n >= 30) return res.status(400).json({ error: 'Maximaal 30 sjablonen — verwijder er eerst één' });

  // Snapshot van de items; aangevinkt/ingepakt gaat bewust niet mee.
  // origin blijft behouden: zo weet 'Automatisch vullen' later nog welke
  // items ooit door de generator kwamen (en dus weg mogen bij gewijzigde
  // plannen) en welke de gebruiker zelf toevoegde.
  const { rows: items } = await pool.query(
    'SELECT text, category, quantity, traveler, origin FROM items WHERE checklist_id = $1 ORDER BY position, id',
    [checklistId]
  );
  if (!items.length) return res.status(400).json({ error: 'Een lege lijst kun je niet als sjabloon opslaan' });

  const { rows } = await pool.query(
    'INSERT INTO templates (user_id, name, items) VALUES ($1, $2, $3::jsonb) RETURNING id, name',
    [req.userId, name, JSON.stringify(items)]
  );
  res.json({ template: rows[0] });
});

router.get('/:id', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, name, items, created_at FROM templates WHERE id = $1 AND user_id = $2',
    [req.params.id, req.userId]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Sjabloon niet gevonden' });
  res.json({ template: rows[0] });
});

// Sjabloon bewerken: naam en/of de volledige item-lijst vervangen.
router.put('/:id', async (req, res) => {
  const { rows: cur } = await pool.query(
    'SELECT id FROM templates WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]
  );
  if (!cur[0]) return res.status(404).json({ error: 'Sjabloon niet gevonden' });

  const name = String(req.body.name || '').trim().slice(0, 80);
  if (!name) return res.status(400).json({ error: 'Geef het sjabloon een naam' });

  const list = Array.isArray(req.body.items) ? req.body.items : [];
  const cleaned = list
    .map(it => ({
      text: String((it && it.text) || '').trim().slice(0, 200),
      category: (it && it.category && String(it.category).trim())
        ? String(it.category).trim().slice(0, 60) : 'Overig',
      quantity: (Number.isInteger(Number(it && it.quantity)) && it.quantity >= 1 && it.quantity <= 99)
        ? Number(it.quantity) : 1,
      traveler: (it && typeof it.traveler === 'string' && it.traveler.trim())
        ? it.traveler.trim().slice(0, 60) : null,
      origin: (it && it.origin === 'generated') ? 'generated' : 'user',
    }))
    .filter(it => it.text)
    .slice(0, 500);
  if (!cleaned.length) {
    return res.status(400).json({ error: 'Een sjabloon zonder items is niet zinvol — verwijder het dan liever' });
  }

  const { rows } = await pool.query(
    'UPDATE templates SET name = $2, items = $3::jsonb WHERE id = $1 RETURNING id, name',
    [req.params.id, name, JSON.stringify(cleaned)]
  );
  res.json({ template: rows[0] });
});

router.delete('/:id', async (req, res) => {
  const result = await pool.query(
    'DELETE FROM templates WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]
  );
  if (!result.rowCount) return res.status(404).json({ error: 'Sjabloon niet gevonden' });
  res.json({ ok: true });
});

module.exports = router;
