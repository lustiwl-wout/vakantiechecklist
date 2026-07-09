require('dotenv').config();
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');

const { init } = require('./db');
const authRoutes = require('./routes/auth');
const checklistRoutes = require('./routes/checklists');
const itemRoutes = require('./routes/items');

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

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const port = process.env.PORT || 3000;

const { migrate } = require('./migrate');

init()
  .then(() => migrate().catch(err => {
    // Non-fatal: app moet kunnen starten ook als de oude DB onbereikbaar is.
    console.error('[migrate] Migratie mislukt (app start gewoon door):', err.message);
  }))
  .then(() => {
    app.listen(port, () => {
      console.log(`Vakantiechecklist draait op http://localhost:${port}`);
    });
  })
  .catch(err => {
    console.error('Database-init mislukt:', err);
    process.exit(1);
  });
