// Gezinsleden van de ingelogde gebruiker: naam + geboortedatum.
// De leeftijd wordt nooit opgeslagen — die berekenen we op de
// vertrekdatum van een reis.

const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();
router.use(requireAuth);

function validBirthdate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))) return false;
  const d = new Date(s);
  if (isNaN(d)) return false;
  const year = Number(s.slice(0, 4));
  const now = new Date();
  return year >= 1900 && d <= now;
}

router.get('/', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, name, birthdate FROM family_members WHERE user_id = $1 ORDER BY birthdate, id',
    [req.userId]
  );
  res.json({ members: rows });
});

router.post('/', async (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 60);
  const birthdate = String(req.body.birthdate || '');
  if (!name) return res.status(400).json({ error: 'Naam is verplicht' });
  if (!validBirthdate(birthdate)) {
    return res.status(400).json({ error: 'Vul een geldige geboortedatum in (niet in de toekomst)' });
  }
  const { rows: count } = await pool.query(
    'SELECT COUNT(*)::int AS n FROM family_members WHERE user_id = $1', [req.userId]
  );
  if (count[0].n >= 20) return res.status(400).json({ error: 'Maximaal 20 gezinsleden' });

  const { rows } = await pool.query(
    'INSERT INTO family_members (user_id, name, birthdate) VALUES ($1, $2, $3) RETURNING id, name, birthdate',
    [req.userId, name, birthdate]
  );
  res.json({ member: rows[0] });
});

router.delete('/:id', async (req, res) => {
  const result = await pool.query(
    'DELETE FROM family_members WHERE id = $1 AND user_id = $2',
    [req.params.id, req.userId]
  );
  if (result.rowCount === 0) return res.status(404).json({ error: 'Gezinslid niet gevonden' });
  res.json({ ok: true });
});

module.exports = router;
