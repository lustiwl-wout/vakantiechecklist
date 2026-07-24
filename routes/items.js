const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();
router.use(requireAuth);

async function loadOwnedItem(userId, itemId) {
  const { rows } = await pool.query(
    `SELECT i.* FROM items i
       JOIN checklists c ON c.id = i.checklist_id
      WHERE i.id = $1 AND c.user_id = $2`,
    [itemId, userId]
  );
  return rows[0] || null;
}

router.patch('/:id', async (req, res) => {
  const item = await loadOwnedItem(req.userId, req.params.id);
  if (!item) return res.status(404).json({ error: 'Item niet gevonden' });

  // Nieuwe waarden bepalen; alles wat niet meegestuurd is blijft zoals het was.
  let quantity = item.quantity;
  if (req.body.quantity !== undefined) {
    const n = Number(req.body.quantity);
    if (!Number.isInteger(n) || n < 1 || n > 99) {
      return res.status(400).json({ error: 'Aantal moet tussen 1 en 99 liggen' });
    }
    quantity = n;
  }

  let packed = Math.min(item.packed, quantity);
  let isChecked;
  if (req.body.packed !== undefined) {
    const n = Number(req.body.packed);
    if (!Number.isInteger(n) || n < 0) {
      return res.status(400).json({ error: 'Ongeldig aantal ingepakt' });
    }
    packed = Math.min(n, quantity);
    isChecked = packed >= quantity;
  } else if (typeof req.body.is_checked === 'boolean') {
    // Vinkje direct aan/uit = alles of niets ingepakt.
    isChecked = req.body.is_checked;
    packed = isChecked ? quantity : 0;
  } else {
    isChecked = packed >= quantity;
  }

  const text = (typeof req.body.text === 'string' && req.body.text.trim())
    ? req.body.text.trim().slice(0, 200) : item.text;
  const category = (typeof req.body.category === 'string' && req.body.category)
    ? String(req.body.category).slice(0, 60) : item.category;
  let traveler = item.traveler;
  if ('traveler' in req.body) {
    traveler = (typeof req.body.traveler === 'string' && req.body.traveler.trim())
      ? req.body.traveler.trim().slice(0, 60) : null;
    // 'Gedeeld' is het gereserveerde woord voor 'geen persoon' — wie het
    // intypt bedoelt een gedeeld item, geen reiziger met die naam.
    if (traveler && traveler.toLowerCase() === 'gedeeld') traveler = null;
  }

  const { rows } = await pool.query(
    `UPDATE items SET quantity = $1, packed = $2, is_checked = $3, text = $4, category = $5, traveler = $6
      WHERE id = $7
      RETURNING id, text, category, is_checked, position, quantity, packed, traveler`,
    [quantity, packed, isChecked, text, category, traveler, item.id]
  );
  res.json({ ok: true, item: rows[0] });
});

router.delete('/:id', async (req, res) => {
  const item = await loadOwnedItem(req.userId, req.params.id);
  if (!item) return res.status(404).json({ error: 'Item niet gevonden' });
  await pool.query('DELETE FROM items WHERE id = $1', [item.id]);
  // Onthoud bewust verwijderde items zodat de generator ze bij een
  // latere bewerking niet opnieuw voorstelt.
  await pool.query(
    `UPDATE checklists SET removed_texts = (
       SELECT COALESCE(jsonb_agg(DISTINCT t), '[]'::jsonb) FROM (
         SELECT jsonb_array_elements_text(removed_texts) AS t
         UNION
         SELECT $2::text
       ) sub)
      WHERE id = $1`,
    [item.checklist_id, item.text.trim().toLowerCase()]
  );
  res.json({ ok: true });
});

module.exports = router;
