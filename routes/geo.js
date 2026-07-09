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
const { pool } = require('../db');

const router = express.Router();
router.use(requireAuth);

const UA = 'vakantiechecklist (persoonlijk hobbyproject; contact via repository)';
const NOMINATIM = 'https://nominatim.openstreetmap.org';
// De publieke hoofdserver is vaak druk; kumi.systems is een bekende
// snelle mirror. We proberen ze op volgorde.
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

// ---- cache: memory (L1) + database (L2, overleeft Render-herstarts) ----

const memCache = new Map(); // key → { at, data }

async function cacheGetAny(key, ttlMs) {
  const hit = memCache.get(key);
  if (hit) return { data: hit.data, fresh: Date.now() - hit.at < ttlMs };
  try {
    const { rows } = await pool.query(
      'SELECT data, fetched_at FROM geo_cache WHERE key = $1', [key]
    );
    if (rows[0]) {
      const at = new Date(rows[0].fetched_at).getTime();
      memCache.set(key, { at, data: rows[0].data });
      return { data: rows[0].data, fresh: Date.now() - at < ttlMs };
    }
  } catch (err) {
    console.error('[geo/cache] lezen mislukt:', err.message);
  }
  return null;
}

async function cacheSet(key, data) {
  if (memCache.size > 500) memCache.delete(memCache.keys().next().value);
  memCache.set(key, { at: Date.now(), data });
  try {
    await pool.query(
      `INSERT INTO geo_cache (key, data, fetched_at) VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, fetched_at = NOW()`,
      [key, JSON.stringify(data)]
    );
  } catch (err) {
    console.error('[geo/cache] schrijven mislukt:', err.message);
  }
}

const TTL_NEARBY = 30 * 24 * 3600 * 1000;  // POI's veranderen zelden
const TTL_PLACES = 7 * 24 * 3600 * 1000;

let lastNominatim = 0;
async function nominatimFetch(path) {
  const wait = lastNominatim + 1100 - Date.now();
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastNominatim = Date.now();
  const res = await fetch(`${NOMINATIM}${path}`, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  return res.json();
}

async function overpassFetch(query) {
  let lastErr = null;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query),
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) throw new Error(`Overpass ${res.status} (${endpoint})`);
      const data = await res.json();
      // Een drukke server geeft timeouts als HTTP 200 met een 'remark' en
      // nul elementen terug. Dat telt als fout — probeer de mirror.
      if (data.remark && (data.elements || []).length === 0) {
        throw new Error(`Overpass remark (${endpoint}): ${data.remark}`);
      }
      return data;
    } catch (err) {
      lastErr = err;
      console.warn('[geo] endpoint faalde, probeer volgende:', endpoint, '-', err.message);
    }
  }
  throw lastErr;
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
// 'Zet op mijn programma' de paklijst kan bijwerken. Elke categorie heeft
// een eigen zoekstraal en resultaat-cap, zodat dichte categorieën
// (restaurants!) de rest niet verdringen.
const POI_CATEGORIES = [
  { key: 'themepark', selectors: ['["tourism"="theme_park"]'], radiusKm: 35, cap: 40, label: 'Pretparken', ages: 'kinderen en tieners', activity: 'themepark' },
  { key: 'zoo', selectors: ['["tourism"="zoo"]'], radiusKm: 35, cap: 40, label: 'Dierentuinen', ages: 'alle leeftijden', activity: 'daytrip' },
  { key: 'aquarium', selectors: ['["tourism"="aquarium"]'], radiusKm: 35, cap: 20, label: 'Aquaria', ages: 'alle leeftijden', activity: 'daytrip' },
  { key: 'waterpark', selectors: ['["leisure"="water_park"]'], radiusKm: 35, cap: 20, label: 'Waterparken / zwemparadijzen', ages: 'kinderen en tieners', activity: 'pool' },
  { key: 'nature', selectors: ['["boundary"="national_park"]', '["leisure"="nature_reserve"]'], radiusKm: 35, cap: 40, label: 'Natuur & wandelgebieden', ages: 'alle leeftijden', activity: 'hiking' },
  { key: 'museum', selectors: ['["tourism"="museum"]'], radiusKm: 25, cap: 40, label: 'Musea', ages: 'vanaf ± 6 jaar', activity: 'cultural' },
  { key: 'attraction', selectors: ['["tourism"="attraction"]'], radiusKm: 20, cap: 40, label: 'Bezienswaardigheden & uitjes', ages: 'alle leeftijden', activity: 'daytrip' },
  { key: 'beach', selectors: ['["natural"="beach"]'], radiusKm: 25, cap: 20, label: 'Stranden', ages: 'alle leeftijden', activity: 'beach' },
  { key: 'restaurant', selectors: ['["amenity"="restaurant"]'], radiusKm: 8, cap: 30, label: 'Restaurants', ages: 'alle leeftijden', activity: 'nightlife' },
];

function buildOverpassQuery(lat, lng) {
  // Een globale bounding box maakt de query fundamenteel goedkoop: elke
  // tag-zoekopdracht blijft binnen het 35km-gebied in plaats van tegen
  // wereldwijde indexen aan te lopen. Zonder bbox viel de eerste
  // categorie op drukke servers al om ('Query timed out at line 3').
  const dLat = 35 / 111;
  const dLng = 35 / (111 * Math.max(0.2, Math.cos(lat * Math.PI / 180)));
  const bbox = `${(lat - dLat).toFixed(4)},${(lng - dLng).toFixed(4)},${(lat + dLat).toFixed(4)},${(lng + dLng).toFixed(4)}`;

  // Elk blok krijgt zijn eigen 'out' met cap. De landsgrens-detectie
  // gebruikt bewust grens-wégen + rel(bw): een 'around' op complete
  // landsrelaties is zó zwaar dat Overpass de query afkapt en (met een
  // remark) níets teruggeeft — de oorzaak van eerdere lege resultaten.
  const blocks = POI_CATEGORIES.map(c => {
    const sel = c.selectors
      .map(s => `nwr${s}["name"](around:${c.radiusKm * 1000},${lat},${lng});`)
      .join('\n  ');
    return `(\n  ${sel}\n);\nout center ${c.cap};`;
  }).join('\n');
  return `[out:json][timeout:25][bbox:${bbox}];
${blocks}
way["boundary"="administrative"]["admin_level"="2"](around:30000,${lat},${lng});
rel(bw)["boundary"="administrative"]["admin_level"="2"];
out tags 10;`;
}

function classify(el) {
  const t = el.tags || {};
  if (t.tourism === 'theme_park') return 'themepark';
  if (t.tourism === 'zoo') return 'zoo';
  if (t.tourism === 'aquarium') return 'aquarium';
  if (t.leisure === 'water_park') return 'waterpark';
  if (t.boundary === 'national_park' || t.leisure === 'nature_reserve') return 'nature';
  if (t.tourism === 'museum') return 'museum';
  if (t.natural === 'beach') return 'beach';
  if (t.amenity === 'restaurant') return 'restaurant';
  // 'attraction' als laatste: veel POI's hebben tourism=attraction als
  // extra tag naast een specifiekere.
  if (t.tourism === 'attraction') return 'attraction';
  return null;
}

// ---- routes ----

router.get('/search', async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 120);
  if (q.length < 2) return res.json({ results: [] });
  const key = `search:${q.toLowerCase()}`;
  const cached = await cacheGetAny(key, TTL_PLACES);
  if (cached && cached.fresh) return res.json(cached.data);

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
  const cached = await cacheGetAny(key, TTL_PLACES);
  if (cached && cached.fresh) return res.json(cached.data);

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

function nearbyKey(lat, lng) {
  return `nearby:v3:${lat.toFixed(2)}:${lng.toFixed(2)}`;
}

// Haalt omgevingsdata live op bij Overpass en schrijft hem in de cache.
async function fetchNearbyLive(lat, lng) {
  const data = await overpassFetch(buildOverpassQuery(lat, lng));

  // Overpass geeft bij een timeout vaak HTTP 200 met een 'remark' en
  // (vrijwel) lege elements terug. Dat is een fout, geen 'niets in de
  // buurt' — anders tonen we ten onrechte een lege adviespagina.
  const elements = data.elements || [];
  if (data.remark && elements.length === 0) {
    throw new Error(`Overpass remark: ${data.remark}`);
  }
  if (data.remark) console.warn('[geo/nearby] Overpass remark (deels resultaat):', data.remark);

  const radiusByCat = Object.fromEntries(POI_CATEGORIES.map(x => [x.key, x.radiusKm]));
  const groups = {};
  const countriesNearby = new Set();

  for (const el of elements) {
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
    const dist = haversineKm(lat, lng, plat, plng);
    if (dist > (radiusByCat[cat] || 35)) continue;
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
        .slice(0, 15),
    }));

  // Buurlanden: alle admin-grenzen binnen 30 km behalve het land zelf.
  const neighbours = [...countriesNearby]
    .map(iso => COUNTRIES.find(cn => cn.code === iso))
    .filter(Boolean);

  const payload = { categories, neighbours: neighbours.map(({ code, name, euro, idCard }) => ({ code, name, euro, idCard })) };
  await cacheSet(nearbyKey(lat, lng), payload);
  return payload;
}

// Alleen cache-check: geen live-fetch. Geeft { ready: true/false } terug
// zodat de frontend de Omgeving-knop pas toont als de data beschikbaar is.
router.get('/nearby/ready', async (req, res) => {
  const c = parseCoords(req);
  if (!c) return res.status(400).json({ error: 'Ongeldige coördinaten' });
  const cached = await cacheGetAny(nearbyKey(c.lat, c.lng), TTL_NEARBY);
  res.json({ ready: !!(cached && cached.fresh) });
});

router.get('/nearby', async (req, res) => {
  const c = parseCoords(req);
  if (!c) return res.status(400).json({ error: 'Ongeldige coördinaten' });

  const cached = await cacheGetAny(nearbyKey(c.lat, c.lng), TTL_NEARBY);
  if (cached && cached.fresh) return res.json(cached.data);

  try {
    res.json(await fetchNearbyLive(c.lat, c.lng));
  } catch (err) {
    console.error('[geo/nearby]', err.message);
    // Verouderde data is beter dan een foutmelding.
    if (cached) return res.json(cached.data);
    res.status(502).json({ error: 'Omgevingsinformatie is tijdelijk niet beschikbaar — probeer het later opnieuw' });
  }
});

// Fire-and-forget: omgevingsdata alvast ophalen zodra een checklist een
// kaartlocatie krijgt — dan is de Omgeving-pagina daarna meteen snel.
function prefetchNearby(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
  cacheGetAny(nearbyKey(lat, lng), TTL_NEARBY)
    .then(hit => {
      if (hit && hit.fresh) return null;
      console.log('[geo/prefetch] omgeving voorladen voor', lat.toFixed(2), lng.toFixed(2));
      return fetchNearbyLive(lat, lng);
    })
    .catch(err => console.warn('[geo/prefetch] mislukt (geen probleem):', err.message));
}

module.exports = router;
module.exports.prefetchNearby = prefetchNearby;
