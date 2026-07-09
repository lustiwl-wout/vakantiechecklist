// Admin-CLI voor account-herstel. Draai via Render Shell of lokaal:
//
//   node admin.js list                       — toon alle e-mailadressen
//   node admin.js reset <email> <nieuw-ww>   — reset wachtwoord van gebruiker
//
// Vereist DATABASE_URL in de env (Render heeft die al).

require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool } = require('./db');

async function list() {
  const { rows } = await pool.query(
    'SELECT id, email, created_at FROM users ORDER BY created_at'
  );
  if (!rows.length) {
    console.log('Geen gebruikers in de database.');
    return;
  }
  console.log('id  | e-mail                        | aangemaakt');
  console.log('----+-------------------------------+--------------------');
  for (const u of rows) {
    console.log(
      String(u.id).padEnd(4) + '| ' +
      u.email.padEnd(30) + '| ' +
      new Date(u.created_at).toISOString().slice(0, 19).replace('T', ' ')
    );
  }
}

async function reset(email, password) {
  if (!email || !password) {
    console.error('Gebruik: node admin.js reset <email> <nieuw-wachtwoord>');
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('Wachtwoord moet minimaal 8 tekens zijn.');
    process.exit(1);
  }
  const norm = email.trim().toLowerCase();
  const hash = await bcrypt.hash(password, 10);
  const { rowCount } = await pool.query(
    'UPDATE users SET password_hash = $1 WHERE email = $2',
    [hash, norm]
  );
  if (rowCount === 0) {
    console.error(`Geen gebruiker gevonden met e-mail "${norm}".`);
    console.error('Tip: draai "node admin.js list" om te zien welke accounts er zijn.');
    process.exit(1);
  }
  console.log(`Wachtwoord van ${norm} is gereset. Je kunt nu inloggen.`);
}

async function main() {
  const [, , cmd, ...args] = process.argv;
  if (cmd === 'list') return list();
  if (cmd === 'reset') return reset(args[0], args[1]);
  console.log('Vakantiechecklist admin-CLI');
  console.log('');
  console.log('  node admin.js list');
  console.log('  node admin.js reset <email> <nieuw-wachtwoord>');
  process.exit(1);
}

main()
  .then(() => pool.end())
  .catch(err => { console.error(err); pool.end(); process.exit(1); });
