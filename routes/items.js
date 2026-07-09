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
    ? req.body.text.trim() : item.text;
  const category = (typeof req.body.category === 'string' && req.body.category)
    ? req.body.category : item.category;

  const { rows } = await pool.query(
    `UPDATE items SET quantity = $1, packed = $2, is_checked = $3, text = $4, category = $5
      WHERE id = $6
      RETURNING id, text, category, is_checked, position, quantity, packed`,
    [quantity, packed, isChecked, text, category, item.id]
  );
  res.json({ ok: true, item: rows[0] });
});

router.delete('/:id', async (req, res) => {
  const item = await loadOwnedItem(req.userId, req.params.id);
  if (!item) return res.status(404).json({ error: 'Item niet gevonden' });
  await pool.query('DELETE FROM items WHERE id = $1', [item.id]);
  res.json({ ok: true });
});

module.exports = router;
