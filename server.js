require('dotenv').config();
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');

const { init } = require('./db');
const authRoutes = require('./routes/auth');
const checklistRoutes = require('./routes/checklists');
const itemRoutes = require('./routes/items');
const metaRoutes = require('./routes/meta');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL ontbreekt. Stel hem in (.env of Render env vars).');
  process.exit(1);
}
if (!process.env.JWT_SECRET) {
  console.error('JWT_SECRET ontbreekt. Stel hem in (.env of Render env vars).');
  process.exit(1);
}

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '256kb' }));
app.use(cookieParser());

app.use('/api/auth', authRoutes);
app.use('/api/checklists', checklistRoutes);
app.use('/api/items', itemRoutes);
app.use('/api/meta', metaRoutes);
app.use('/api/geo', require('./routes/geo'));
app.use('/api/family', require('./routes/family'));
app.use('/admin', require('./routes/admin'));

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use(express.static(path.join(__dirname, 'public')));
// SPA-fallback: alles wat geen API of bestand is krijgt de app-shell.
app.use((req, res, next) => {
  if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Fouten in (async) routes horen hier te eindigen — nooit in een crash.
// Express 5 geeft afgewezen promises automatisch door aan deze middleware.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  console.error(`[error] ${req.method} ${req.path}:`, err.message);
  const wantsJson = req.path.startsWith('/api/');
  if (wantsJson) res.status(500).json({ error: 'Er ging iets mis op de server' });
  else res.status(500).send('Er ging iets mis op de server');
});

// Vangnet: een vergeten rejection of uitzondering mag het proces niet doden.
process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection]', err);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});

const port = process.env.PORT || 3000;

init()
  .then(() => {
    app.listen(port, () => {
      console.log(`Vakantiechecklist draait op http://localhost:${port}`);
    });
  })
  .catch(err => {
    console.error('Database-init mislukt:', err);
    process.exit(1);
  });
