// Admin-portal op /admin met een eigen inlogpagina.
// Credentials komen uit de env vars ADMIN_USER en ADMIN_PASSWORD
// (in Render in te stellen). Zonder die vars is het portal uitgeschakeld.
// Na inloggen krijg je een aparte admin-cookie (JWT, 12 uur geldig).

const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../db');

const router = express.Router();
const ADMIN_COOKIE = 'vc_admin';

function safeEq(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function isAdminSession(req) {
  const token = req.cookies && req.cookies[ADMIN_COOKIE];
  if (!token) return false;
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    return payload.role === 'admin';
  } catch {
    return false;
  }
}

router.use(express.urlencoded({ extended: false }));

router.use((req, res, next) => {
  if (!process.env.ADMIN_USER || !process.env.ADMIN_PASSWORD) {
    return res.status(503).send('Admin-portal is uitgeschakeld. Zet de env vars ADMIN_USER en ADMIN_PASSWORD.');
  }
  next();
});

function loginPage(error) {
  return page(`
    <form method="post" action="/admin/login" style="display:block; max-width:340px;">
      <p><label>Gebruikersnaam<br><input type="text" name="user" required autofocus style="width:100%"></label></p>
      <p><label>Wachtwoord<br><input type="password" name="password" required style="width:100%"></label></p>
      ${error ? `<p style="color:#dc3545">${esc(error)}</p>` : ''}
      <button class="primary" type="submit">Inloggen</button>
    </form>
    <p class="muted">Gebruik de waarden van de env vars ADMIN_USER en ADMIN_PASSWORD (niet je gewone site-account).</p>
  `);
}

router.post('/login', (req, res) => {
  const u = String(req.body.user || '');
  const p = String(req.body.password || '');
  if (safeEq(u, process.env.ADMIN_USER) && safeEq(p, process.env.ADMIN_PASSWORD)) {
    const token = jwt.sign({ role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '12h' });
    res.cookie(ADMIN_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 12 * 60 * 60 * 1000,
    });
    return res.redirect('/admin');
  }
  res.status(401).send(loginPage('Verkeerde gebruikersnaam of wachtwoord.'));
});

router.post('/logout', (req, res) => {
  res.clearCookie(ADMIN_COOKIE);
  res.redirect('/admin');
});

// Alles hieronder vereist een geldige admin-sessie.
router.use((req, res, next) => {
  if (isAdminSession(req)) return next();
  res.status(401).send(loginPage());
});

function esc(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function page(body, msg) {
  return `<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Admin — Vakantiechecklist</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 860px; margin: 24px auto; padding: 0 16px; color: #1d2433; }
  h1 { font-size: 22px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #e3e7ef; font-size: 14px; vertical-align: middle; }
  th { background: #f0f3f9; }
  input[type="password"], input[type="text"] { padding: 6px 8px; border: 1px solid #ccc; border-radius: 6px; }
  button { padding: 6px 12px; border-radius: 6px; border: 1px solid #ccc; background: #fff; cursor: pointer; }
  button.primary { background: #0d6efd; border-color: #0d6efd; color: #fff; }
  button.danger { background: #fdecee; border-color: #f5c2c7; color: #dc3545; }
  form { display: inline-flex; gap: 6px; margin: 0; }
  .msg { background: #e7f0ff; border: 1px solid #b6d4fe; padding: 10px 14px; border-radius: 8px; margin-bottom: 16px; }
  .muted { color: #5b6473; }
</style>
</head>
<body>
<h1>🧳 Vakantiechecklist — gebruikersbeheer</h1>
${msg ? `<div class="msg">${esc(msg)}</div>` : ''}
${body}
<p class="muted">Beveiligd met Basic Auth (ADMIN_USER / ADMIN_PASSWORD env vars).</p>
</body>
</html>`;
}

router.get('/', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.created_at, COUNT(c.id)::int AS lists
       FROM users u LEFT JOIN checklists c ON c.user_id = u.id
      GROUP BY u.id ORDER BY u.id`
  );
  const rowsHtml = rows.map(u => `
    <tr>
      <td>${u.id}</td>
      <td>${esc(u.email)}</td>
      <td>${new Date(u.created_at).toLocaleDateString('nl-NL')}</td>
      <td>${u.lists}</td>
      <td>
        <form method="post" action="/admin/reset">
          <input type="hidden" name="id" value="${u.id}">
          <input type="password" name="password" placeholder="Nieuw wachtwoord (min. 8)" minlength="8" required>
          <button class="primary" type="submit">Reset</button>
        </form>
        <form method="post" action="/admin/delete" onsubmit="return confirm('Gebruiker ${esc(u.email)} en al zijn lijsten definitief verwijderen?')">
          <input type="hidden" name="id" value="${u.id}">
          <button class="danger" type="submit">Verwijder</button>
        </form>
      </td>
    </tr>`).join('');

  const table = rows.length
    ? `<table>
        <tr><th>ID</th><th>E-mail</th><th>Aangemaakt</th><th>Lijsten</th><th>Acties</th></tr>
        ${rowsHtml}
      </table>`
    : '<p>Geen gebruikers in de database.</p>';

  const body = table + `
    <p style="margin-top:16px">
      <form method="post" action="/admin/logout"><button type="submit">Uitloggen</button></form>
    </p>`;

  res.send(page(body, req.query.msg));
});

router.post('/reset', async (req, res) => {
  const id = Number(req.body.id);
  const password = String(req.body.password || '');
  if (!Number.isInteger(id) || password.length < 8) {
    return res.redirect('/admin?msg=' + encodeURIComponent('Ongeldig: wachtwoord moet minimaal 8 tekens zijn.'));
  }
  const hash = await bcrypt.hash(password, 10);
  const { rows } = await pool.query(
    'UPDATE users SET password_hash = $1 WHERE id = $2 RETURNING email',
    [hash, id]
  );
  const msg = rows.length
    ? `Wachtwoord van ${rows[0].email} is gereset.`
    : 'Gebruiker niet gevonden.';
  res.redirect('/admin?msg=' + encodeURIComponent(msg));
});

router.post('/delete', async (req, res) => {
  const id = Number(req.body.id);
  if (!Number.isInteger(id)) return res.redirect('/admin');
  const { rows } = await pool.query('DELETE FROM users WHERE id = $1 RETURNING email', [id]);
  const msg = rows.length
    ? `Gebruiker ${rows[0].email} en alle bijbehorende lijsten zijn verwijderd.`
    : 'Gebruiker niet gevonden.';
  res.redirect('/admin?msg=' + encodeURIComponent(msg));
});

module.exports = router;
