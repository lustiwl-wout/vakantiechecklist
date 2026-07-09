// Admin-portal op /admin, beveiligd met HTTP Basic Auth.
// Credentials komen uit de env vars ADMIN_USER en ADMIN_PASSWORD
// (in Render in te stellen). Zonder die vars is het portal uitgeschakeld.

const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');

const router = express.Router();

function safeEq(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function adminAuth(req, res, next) {
  const user = process.env.ADMIN_USER;
  const pass = process.env.ADMIN_PASSWORD;
  if (!user || !pass) {
    return res.status(503).send('Admin-portal is uitgeschakeld. Zet de env vars ADMIN_USER en ADMIN_PASSWORD.');
  }
  const hdr = req.headers.authorization || '';
  if (hdr.startsWith('Basic ')) {
    const decoded = Buffer.from(hdr.slice(6), 'base64').toString();
    const sep = decoded.indexOf(':');
    if (sep !== -1) {
      const u = decoded.slice(0, sep);
      const p = decoded.slice(sep + 1);
      if (safeEq(u, user) && safeEq(p, pass)) return next();
    }
  }
  res.set('WWW-Authenticate', 'Basic realm="Vakantiechecklist admin"');
  res.status(401).send('Inloggen vereist');
}

router.use(adminAuth);
router.use(express.urlencoded({ extended: false }));

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

  const body = rows.length
    ? `<table>
        <tr><th>ID</th><th>E-mail</th><th>Aangemaakt</th><th>Lijsten</th><th>Acties</th></tr>
        ${rowsHtml}
      </table>`
    : '<p>Geen gebruikers in de database.</p>';

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
