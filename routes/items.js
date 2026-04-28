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

  const updates = [];
  const params = [];
  let p = 1;
  if (typeof req.body.is_checked === 'boolean') {
    updates.push(`is_checked = $${p++}`);
    params.push(req.body.is_checked);
  }
  if (typeof req.body.text === 'string' && req.body.text.trim()) {
    updates.push(`text = $${p++}`);
    params.push(req.body.text.trim());
  }
  if (typeof req.body.category === 'string') {
    updates.push(`category = $${p++}`);
    params.push(req.body.category);
  }
  if (!updates.length) return res.json({ ok: true });

  params.push(item.id);
  await pool.query(`UPDATE items SET ${updates.join(', ')} WHERE id = $${p}`, params);
  res.json({ ok: true });
});

router.delete('/:id', async (req, res) => {
  const item = await loadOwnedItem(req.userId, req.params.id);
  if (!item) return res.status(404).json({ error: 'Item niet gevonden' });
  await pool.query('DELETE FROM items WHERE id = $1', [item.id]);
  res.json({ ok: true });
});

module.exports = router;
