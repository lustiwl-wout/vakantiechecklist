const express = require('express');
const { COUNTRIES } = require('../countries');

const router = express.Router();

router.get('/countries', (req, res) => {
  res.set('Cache-Control', 'public, max-age=86400');
  res.json({ countries: COUNTRIES.map(({ code, name }) => ({ code, name })) });
});

module.exports = router;
