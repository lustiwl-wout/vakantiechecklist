const express = require('express');
const { pool } = require('../db');
const {
  setAuthCookie,
  clearAuthCookie,
  requireAuth,
  hashPassword,
  verifyPassword,
} = require('../auth');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post('/register', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Ongeldig e-mailadres' });
  if (password.length < 8) return res.status(400).json({ error: 'Wachtwoord moet minimaal 8 tekens zijn' });

  try {
    const hash = await hashPassword(password);
    const { rows } = await pool.query(
      'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email',
      [email, hash]
    );
    setAuthCookie(res, rows[0].id);
    res.json({ user: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Dit e-mailadres is al geregistreerd' });
    console.error(err);
    res.status(500).json({ error: 'Registratie mislukt' });
  }
});

router.post('/login', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const { rows } = await pool.query('SELECT id, email, password_hash FROM users WHERE email = $1', [email]);
  const user = rows[0];
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return res.status(401).json({ error: 'Verkeerde combinatie van e-mail en wachtwoord' });
  }
  setAuthCookie(res, user.id);
  res.json({ user: { id: user.id, email: user.email } });
});

router.post('/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

router.get('/me', requireAuth, async (req, res) => {
  const { rows } = await pool.query('SELECT id, email FROM users WHERE id = $1', [req.userId]);
  if (!rows[0]) return res.status(404).json({ error: 'Gebruiker niet gevonden' });
  res.json({ user: rows[0] });
});

module.exports = router;
