// Geo-diensten op basis van OpenStreetMap:
//  - /search  → Nominatim: plaats zoeken (voor de kaart-picker)
//  - /reverse → Nominatim: coördinaat → plaats + land
//  - /nearby  → Overpass: uitjes in de omgeving + buurlanden binnen 30 km
//
// Publieke OSM-diensten hebben fair-use regels: we sturen een duidelijke
// User-Agent, houden ≥1,1 s tussen Nominatim-calls en cachen antwoorden.

const express = require('express');
const { requireAuth } = require('../auth');
const { COUNTRIES } = require('../countries');

const router = express.Router();
router.use(requireAuth);

const UA = 'vakantiechecklist (persoonlijk hobbyproject; contact via repository)';
const NOMINATIM = 'https://nominatim.openstreetmap.org';
const OVERPASS = 'https://overpass-api.de/api/interpreter';

// ---- cache + throttle ----

const cache = new Map(); // key → { at, data }
function cacheGet(key, ttlMs) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.data;
  return null;
}
function cacheSet(key, data) {
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  cache.set(key, { at: Date.now(), data });
}

let lastNominatim = 0;
async function nominatimFetch(path) {
  const wait = lastNominatim + 1100 - Date.now();
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastNominatim = Date.now();
  const res = await fetch(`${NOMINATIM}${path}`, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  return res.json();
}

async function overpassFetch(query) {
  const res = await fetch(OVERPASS, {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'data=' + encodeURIComponent(query),
  });
  if (!res.ok) throw new Error(`Overpass ${res.status}`);
  return res.json();
}

// ---- helpers ----

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function parseCoords(req) {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return null;
  }
  return { lat, lng };
}

function matchCountryCode(nominatimCode) {
  const code = String(nominatimCode || '').toLowerCase();
  return COUNTRIES.some(c => c.code === code) ? code : null;
}

// Overpass-categorieën → NL-labels + leeftijdsadvies + activiteit-koppeling.
// De 'activity' verwijst naar de activiteiten van de checklist zodat
// 'Zet op mijn programma' de paklijst kan bijwerken.
const POI_CATEGORIES = [
  { key: 'themepark', selector: '["tourism"="theme_park"]', label: 'Pretparken', ages: 'kinderen en tieners', activity: 'themepark' },
  { key: 'zoo', selector: '["tourism"="zoo"]', label: 'Dierentuinen', ages: 'alle leeftijden', activity: 'daytrip' },
  { key: 'aquarium', selector: '["tourism"="aquarium"]', label: 'Aquaria', ages: 'alle leeftijden', activity: 'daytrip' },
  { key: 'waterpark', selector: '["leisure"="water_park"]', label: 'Waterparken / zwemparadijzen', ages: 'kinderen en tieners', activity: 'pool' },
  { key: 'museum', selector: '["tourism"="museum"]', label: 'Musea', ages: 'vanaf ± 6 jaar', activity: 'cultural' },
  { key: 'beach', selector: '["natural"="beach"]["name"]', label: 'Stranden', ages: 'alle leeftijden', activity: 'beach' },
];

function buildOverpassQuery(lat, lng, radiusM) {
  const parts = POI_CATEGORIES.map(c =>
    `nwr${c.selector}["name"](around:${radiusM},${lat},${lng});`
  ).join('\n');
  return `[out:json][timeout:20];
(
${parts}
);
out center 120;
(
relation["boundary"="administrative"]["admin_level"="2"](around:30000,${lat},${lng});
);
out tags 10;`;
}

function classify(el) {
  const t = el.tags || {};
  if (t.tourism === 'theme_park') return 'themepark';
  if (t.tourism === 'zoo') return 'zoo';
  if (t.tourism === 'aquarium') return 'aquarium';
  if (t.leisure === 'water_park') return 'waterpark';
  if (t.tourism === 'museum') return 'museum';
  if (t.natural === 'beach') return 'beach';
  return null;
}

// ---- routes ----

router.get('/search', async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 120);
  if (q.length < 2) return res.json({ results: [] });
  const key = `search:${q.toLowerCase()}`;
  const cached = cacheGet(key, 24 * 3600 * 1000);
  if (cached) return res.json(cached);

  try {
    const data = await nominatimFetch(
      `/search?format=jsonv2&limit=5&addressdetails=1&accept-language=nl&q=${encodeURIComponent(q)}`
    );
    const results = data.map(r => ({
      label: r.display_name,
      lat: Number(r.lat),
      lng: Number(r.lon),
      country: matchCountryCode(r.address && r.address.country_code),
      place: (r.address && (r.address.city || r.address.town || r.address.village || r.address.municipality)) || r.name || '',
    }));
    const payload = { results };
    cacheSet(key, payload);
    res.json(payload);
  } catch (err) {
    console.error('[geo/search]', err.message);
    res.status(502).json({ error: 'Zoeken is tijdelijk niet beschikbaar' });
  }
});

router.get('/reverse', async (req, res) => {
  const c = parseCoords(req);
  if (!c) return res.status(400).json({ error: 'Ongeldige coördinaten' });
  const key = `rev:${c.lat.toFixed(3)}:${c.lng.toFixed(3)}`;
  const cached = cacheGet(key, 24 * 3600 * 1000);
  if (cached) return res.json(cached);

  try {
    const r = await nominatimFetch(
      `/reverse?format=jsonv2&zoom=10&accept-language=nl&lat=${c.lat}&lon=${c.lng}`
    );
    const payload = {
      label: r.display_name || '',
      country: matchCountryCode(r.address && r.address.country_code),
      place: (r.address && (r.address.city || r.address.town || r.address.village || r.address.municipality)) || r.name || '',
    };
    cacheSet(key, payload);
    res.json(payload);
  } catch (err) {
    console.error('[geo/reverse]', err.message);
    res.status(502).json({ error: 'Locatie opzoeken is tijdelijk niet beschikbaar' });
  }
});

router.get('/nearby', async (req, res) => {
  const c = parseCoords(req);
  if (!c) return res.status(400).json({ error: 'Ongeldige coördinaten' });
  const radiusKm = 35;
  const key = `nearby:${c.lat.toFixed(2)}:${c.lng.toFixed(2)}`;
  const cached = cacheGet(key, 24 * 3600 * 1000);
  if (cached) return res.json(cached);

  try {
    const data = await overpassFetch(buildOverpassQuery(c.lat, c.lng, radiusKm * 1000));
    const groups = {};
    const countriesNearby = new Set();

    for (const el of data.elements || []) {
      const tags = el.tags || {};
      if (tags.boundary === 'administrative' && tags.admin_level === '2') {
        const iso = String(tags['ISO3166-1'] || '').toLowerCase();
        if (iso) countriesNearby.add(iso);
        continue;
      }
      const cat = classify(el);
      if (!cat || !tags.name) continue;
      const plat = el.lat ?? (el.center && el.center.lat);
      const plng = el.lon ?? (el.center && el.center.lon);
      if (plat == null) continue;
      const dist = haversineKm(c.lat, c.lng, plat, plng);
      if (dist > radiusKm) continue;
      (groups[cat] = groups[cat] || []).push({
        name: tags.name,
        distanceKm: Math.round(dist * 10) / 10,
        website: tags.website || tags['contact:website'] || null,
      });
    }

    const categories = POI_CATEGORIES
      .filter(cdef => groups[cdef.key] && groups[cdef.key].length)
      .map(cdef => ({
        key: cdef.key,
        label: cdef.label,
        ages: cdef.ages,
        activity: cdef.activity,
        pois: groups[cdef.key]
          .sort((a, b) => a.distanceKm - b.distanceKm)
          // Dedupliceer op naam (zelfde park kan als node én relation in OSM staan)
          .filter((p, i, arr) => arr.findIndex(x => x.name === p.name) === i)
          .slice(0, 6),
      }));

    // Buurlanden: alle admin-grenzen binnen 30 km behalve het land zelf.
    const neighbours = [...countriesNearby]
      .map(iso => COUNTRIES.find(cn => cn.code === iso))
      .filter(Boolean);

    const payload = { categories, neighbours: neighbours.map(({ code, name, euro, idCard }) => ({ code, name, euro, idCard })) };
    cacheSet(key, payload);
    res.json(payload);
  } catch (err) {
    console.error('[geo/nearby]', err.message);
    res.status(502).json({ error: 'Omgevingsinformatie is tijdelijk niet beschikbaar — probeer het later opnieuw' });
  }
});

module.exports = router;
