// Publieke alleen-lezen weergave van een gedeelde checklist. Geen login:
// wie de (onraadbare) deellink heeft, mag kijken en afdrukken — meer niet.
// Er lekken bewust alleen weergavevelden, geen id's of e-mailadressen.

const express = require('express');
const { pool } = require('../db');

const router = express.Router();

router.get('/:token', async (req, res) => {
  const token = String(req.params.token || '');
  if (!/^[a-f0-9]{16,64}$/.test(token)) {
    return res.status(404).json({ error: 'Gedeelde lijst niet gevonden' });
  }
  const { rows } = await pool.query(
    `SELECT id, name, destination, start_date, end_date,
            use_categories, use_travelers, use_quantities, traveler_order
       FROM checklists WHERE share_token = $1`,
    [token]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Gedeelde lijst niet gevonden' });
  const c = rows[0];
  const { rows: items } = await pool.query(
    `SELECT text, category, is_checked, quantity, packed, traveler
       FROM items WHERE checklist_id = $1 ORDER BY position, id`,
    [c.id]
  );
  res.json({
    checklist: {
      name: c.name,
      destination: c.destination,
      start_date: c.start_date,
      end_date: c.end_date,
      use_categories: c.use_categories,
      use_travelers: c.use_travelers,
      use_quantities: c.use_quantities,
      traveler_order: c.traveler_order,
    },
    items,
  });
});

module.exports = router;
