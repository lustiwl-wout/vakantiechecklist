// Geo-diensten:
//  - /search  → Nominatim: plaats zoeken voor de kaart-picker
//  - /reverse → Nominatim: coördinaat → plaats + land
//  - /nearby  → Google Places: uitjes in de omgeving, mét sterren
//  - buurlanden binnen ± 30 km via Nominatim-landpeiling
//
// De omgevingsdata komt volledig uit Google Places (New): één
// zoekopdracht per categorie levert namen, sterren én locaties in één
// keer. Nominatim (stabiel en gratis) doet alleen geocoding en de
// buurland-peiling; Overpass is volledig uitgefaseerd — de timeouts
// en 429's kwamen allemaal daarvandaan.

const express = require('express');
const { requireAuth } = require('../auth');
const { COUNTRIES } = require('../countries');
const { pool } = require('../db');

const router = express.Router();
router.use(requireAuth);

const UA = 'vakantiechecklist (persoonlijk hobbyproject; contact via repository)';
const NOMINATIM = 'https://nominatim.openstreetmap.org';

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

const TTL_NEARBY = 30 * 24 * 3600 * 1000;  // maximum dat Googles voorwaarden toestaan
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

/**
 * Haalt de beste plaats/regio-naam uit een Nominatim-adres.
 * @param {Record<string, string>|null|undefined} address Nominatim-adresobject.
 * @param {string} [fallbackName=''] Losse resultaatnaam als fallback.
 * @returns {string} Gevonden plaats/regio-naam of de fallback.
 */
function placeFromAddress(address, fallbackName = '') {
  return (address && (
    address.city
    || address.town
    || address.village
    || address.municipality
    || address.county
    || address.state
    || address.region
    || address.province
    || address.island
  )) || fallbackName || '';
}

const PLACE_SEARCH_TYPES = new Set([
  'city',
  'town',
  'village',
  'municipality',
  'hamlet',
  'county',
  'state',
  'region',
  'province',
  'district',
  'suburb',
  'quarter',
  'neighbourhood',
  'island',
  'archipelago',
]);

/**
 * Bepaalt of een Nominatim-resultaat een geldige plaats/regio is.
 * @param {Record<string, any>} r Nominatim-zoekresultaat.
 * @returns {boolean} True voor plaats/regio-resultaten, false voor losse POI's.
 */
function isValidPlaceResult(r) {
  const categoryValue = String(r.category || r.class || '').toLowerCase();
  const type = String(r.type || '').toLowerCase();
  const addresstype = String(r.addresstype || '').toLowerCase();
  if (categoryValue === 'place') {
    return PLACE_SEARCH_TYPES.has(type) || PLACE_SEARCH_TYPES.has(addresstype);
  }
  if (categoryValue === 'boundary') {
    return type === 'administrative' && PLACE_SEARCH_TYPES.has(addresstype);
  }
  return !categoryValue && (PLACE_SEARCH_TYPES.has(type) || PLACE_SEARCH_TYPES.has(addresstype));
}

function createCountryPlaceDedupeKey(country, place) {
  return `${String(country || '').toLowerCase()}:${String(place || '').toLowerCase()}`;
}

// ---- geocoding-routes (Nominatim) ----

router.get('/search', async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 120);
  if (q.length < 2) return res.json({ results: [] });
  const key = `search:v2:${q.toLowerCase()}`;
  const cached = await cacheGetAny(key, TTL_PLACES);
  if (cached && cached.fresh) return res.json(cached.data);

  try {
    const data = await nominatimFetch(
      `/search?format=jsonv2&limit=5&addressdetails=1&accept-language=nl&q=${encodeURIComponent(q)}`
    );
    const seenCountryPlacePairs = new Set();
    const results = [];
    for (const r of data) {
      if (!isValidPlaceResult(r)) continue;
      const country = matchCountryCode(r.address && r.address.country_code);
      const place = placeFromAddress(r.address, r.name);
      // Zonder land + plaats kunnen we de zoekhit niet betrouwbaar invullen.
      if (!country || !place) continue;
      const dedupeKey = createCountryPlaceDedupeKey(country, place);
      if (seenCountryPlacePairs.has(dedupeKey)) continue;
      seenCountryPlacePairs.add(dedupeKey);
      results.push({
        label: r.display_name,
        lat: Number(r.lat),
        lng: Number(r.lon),
        country,
        place,
      });
    }
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
      place: placeFromAddress(r.address, r.name),
    };
    cacheSet(key, payload);
    res.json(payload);
  } catch (err) {
    console.error('[geo/reverse]', err.message);
    res.status(502).json({ error: 'Locatie opzoeken is tijdelijk niet beschikbaar' });
  }
});

// ---- Google Places: budget en basis-aanroep ----

// Maandteller (persistent in geo_cache) kapt af vóór het gratis tegoed
// op is. Eén locatie kost ± 16 aanroepen per 30 dagen — ruim binnen
// het budget voor honderden locaties.
const GPLACES_MONTHLY_BUDGET = 4500;
// Crowd-validatie: pas serieus vanaf dit aantal Google-reviews.
const MIN_REVIEWS = 25;

async function googleBudgetOk() {
  const month = new Date().toISOString().slice(0, 7);
  try {
    const { rows } = await pool.query(
      `INSERT INTO geo_cache (key, data) VALUES ($1, '{"n":1}')
       ON CONFLICT (key) DO UPDATE
         SET data = jsonb_set(geo_cache.data, '{n}', (((geo_cache.data->>'n')::int) + 1)::text::jsonb)
       RETURNING (data->>'n')::int AS n`,
      [`gplaces:usage:${month}`]
    );
    const n = rows[0].n;
    if (n > GPLACES_MONTHLY_BUDGET) {
      if (n === GPLACES_MONTHLY_BUDGET + 1) console.warn('[gplaces] maandbudget bereikt — omgeving pauzeert tot volgende maand');
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

// De FieldMask bepaalt óók het tarief: naam, sterren en locatie is wat
// we tonen; primaryType valt binnen dezelfde tariefklasse en laat ons
// accommodaties (campings, hotels) uit de uitjes filteren.
const PLACES_FIELDMASK = 'places.displayName,places.rating,places.userRatingCount,places.location,places.primaryType';

async function placesCall(path, body) {
  if (!process.env.GOOGLE_PLACES_API_KEY) throw new Error('Omgeving vereist een Google Places API-sleutel');
  if (!(await googleBudgetOk())) throw new Error('Google-maandbudget bereikt — omgeving pauzeert tot volgende maand');
  const res = await fetch(`https://places.googleapis.com/v1/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': process.env.GOOGLE_PLACES_API_KEY,
      'X-Goog-FieldMask': PLACES_FIELDMASK,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Places ${res.status}`);
  const data = await res.json();
  return (data.places || [])
    .map(p => ({
      name: (p.displayName && p.displayName.text) || '',
      rating: p.rating || null,
      count: p.userRatingCount || 0,
      la: p.location ? Math.round(p.location.latitude * 1000) / 1000 : null,
      lo: p.location ? Math.round(p.location.longitude * 1000) / 1000 : null,
      pt: p.primaryType || null,
    }))
    .filter(p => p.name && p.la != null);
}

// ---- categorieën ----
//
// types  → places:searchNearby met die Google-typen (strak afgebakend).
// text   → places:searchText met een NL-zoekterm, voor soorten zonder
//          eigen Google-type (kinderboerderij, zwemplas, musical, tours).
// Beide mogen samen; resultaten worden op naam samengevoegd.
// De 'activity' koppelt aan de checklist-activiteiten zodat 'Zet op
// mijn programma' de paklijst kan bijwerken.
const PLACES_CATEGORIES = [
  { key: 'themepark', label: 'Pretparken', ages: 'kinderen en tieners', activity: 'themepark', radiusKm: 35, types: ['amusement_park'] },
  { key: 'zoo', label: 'Dierentuinen', ages: 'alle leeftijden', activity: 'daytrip', radiusKm: 35, types: ['zoo'] },
  { key: 'pettingzoo', label: 'Kinderboerderijen', ages: 'jonge kinderen', activity: 'daytrip', radiusKm: 15, text: 'kinderboerderij' },
  { key: 'aquarium', label: 'Aquaria', ages: 'alle leeftijden', activity: 'daytrip', radiusKm: 35, types: ['aquarium'] },
  { key: 'waterpark', label: 'Zwembaden & waterparken', ages: 'alle leeftijden', activity: 'pool', radiusKm: 30, types: ['water_park'], text: 'zwembad' },
  { key: 'nature', label: 'Natuur & wandelgebieden', ages: 'alle leeftijden', activity: 'hiking', radiusKm: 35, types: ['national_park', 'hiking_area'] },
  { key: 'museum', label: 'Musea', ages: 'vanaf ± 6 jaar', activity: 'cultural', radiusKm: 25, types: ['museum', 'art_gallery'] },
  { key: 'musical', label: 'Musicals', ages: 'vanaf ± 6 jaar', activity: 'cultural', radiusKm: 25, text: 'musical theater', strictType: 'performing_arts_theater' },
  { key: 'theatre', label: 'Theaters & voorstellingen', ages: 'vanaf ± 6 jaar', activity: 'cultural', radiusKm: 20, types: ['performing_arts_theater'] },
  { key: 'attraction', label: 'Bezienswaardigheden & uitjes', ages: 'alle leeftijden', activity: 'daytrip', radiusKm: 20, types: ['tourist_attraction'] },
  { key: 'beach', label: 'Stranden & zwemplassen', ages: 'alle leeftijden', activity: 'beach', radiusKm: 25, types: ['beach'], text: 'zwemplas' },
  { key: 'tours', label: 'Excursies & boottochten', ages: 'alle leeftijden', activity: 'daytrip', radiusKm: 25, text: 'boottochten, excursies en dagtours' },
  { key: 'restaurant', label: 'Restaurants', ages: 'alle leeftijden', activity: 'nightlife', radiusKm: 8, types: ['restaurant'] },
];

// ---- buurlanden (Nominatim-landpeiling) ----

// 12 punten op een cirkel van 28 km rond de bestemming omgekeerd
// geocoderen (landniveau): elk land dat je raakt is een buurland-hint.
// Traag maar gratis en betrouwbaar — draait uitsluitend op de
// achtergrond, dus niemand wacht erop.
async function neighboursViaNominatim(lat, lng) {
  const codes = new Set();
  for (let i = 0; i < 12; i++) {
    const ang = (i / 12) * 2 * Math.PI;
    const pLat = lat + (28 / 111) * Math.cos(ang);
    const pLng = lng + (28 / (111 * Math.max(0.2, Math.cos(lat * Math.PI / 180)))) * Math.sin(ang);
    try {
      const r = await nominatimFetch(
        `/reverse?format=jsonv2&zoom=3&accept-language=nl&lat=${pLat.toFixed(4)}&lon=${pLng.toFixed(4)}`
      );
      const code = String((r.address && r.address.country_code) || '').toLowerCase();
      if (code) codes.add(code);
    } catch { /* zee of storing: punt overslaan */ }
  }
  return codes.size ? [...codes] : null;
}

const resolveNeighbours = neighboursViaNominatim;

// Losgekoppeld van het laden: de omgeving hoeft nooit op de grens-
// detectie te wachten. Zodra er een uitkomst is wordt het cache-record
// bijgewerkt; bij falen volgen herkansingen.
const neighboursInFlight = new Set();
function updateNeighboursLater(lat, lng, attempt = 1) {
  const key = nearbyKey(lat, lng);
  if (neighboursInFlight.has(key)) return;
  neighboursInFlight.add(key);
  resolveNeighbours(lat, lng)
    .then(async nb => {
      if (nb === null) {
        if (attempt < 3) setTimeout(() => updateNeighboursLater(lat, lng, attempt + 1), attempt * 10 * 60 * 1000);
        return;
      }
      const hit = await cacheGetAny(key, TTL_NEARBY);
      if (hit && hit.data && hit.data.cats) {
        await cacheSet(key, { ...hit.data, neighbours: nb });
        console.log('[geo/borders] buurlanden opgeslagen voor', key, '→', nb.join(', ') || '(geen)');
      }
    })
    .catch(err => console.warn('[geo/borders]', err.message))
    .finally(() => neighboursInFlight.delete(key));
}

// ---- omgeving ophalen en cachen ----

// Alleen ophogen als de categorie-opzet verandert en de gecachte data
// dus soorten mist. Weergave-/filterwijzigingen draaien bij het lezen.
const PLACES_VERSION = 2; // v2: primaryType erbij (accommodatie-filter)

// Sommige bedrijven zijn geen uitje maar duiken wel op in de
// resultaten: een boerderijcamping met dieren telt bij Google soms als
// (kinder)dierentuin (Hoeve Sonneclaer), een dierenpension ook (Kampus
// Dierenhotel). Googles eigen primaire type is het betrouwbaarste
// signaal; de naamcheck vangt de rest en werkt ook op al gecachte data
// zonder primaryType.
const EXCLUDED_PRIMARY_TYPES = new Set([
  // accommodaties
  'campground', 'camping_cabin', 'rv_park', 'hotel', 'motel', 'resort_hotel',
  'extended_stay_hotel', 'bed_and_breakfast', 'guest_house', 'hostel',
  'farmstay', 'cottage', 'private_guest_room', 'inn', 'lodging',
  // huisdier-diensten
  'veterinary_care', 'pet_store', 'pet_boarding_service', 'dog_trainer',
]);
const EXCLUDED_NAME_RE = /\b(camping|kamperen|minicamping|boerderijcamping|groepsaccommodatie|bed\s*&\s*breakfast|b&b|hostel|dierenhotel|dierenpension|hondenpension|kattenpension|dierenasiel|dierenkliniek|dierenarts|trimsalon|hondenschool)\b/i;
function isExcludedPlace(p) {
  if (p.pt && EXCLUDED_PRIMARY_TYPES.has(p.pt)) return true;
  return EXCLUDED_NAME_RE.test(p.name);
}

function nearbyKey(lat, lng) {
  return `nearby:gp:${lat.toFixed(2)}:${lng.toFixed(2)}`;
}

async function fetchNearbyRaw(lat, lng) {
  const cats = {};
  for (const def of PLACES_CATEGORIES) {
    const radius = Math.min(def.radiusKm * 1000, 50000);
    const byName = new Map();
    const absorb = (list) => {
      for (const p of list) {
        const k = p.name.toLowerCase();
        if (!byName.has(k)) byName.set(k, p);
      }
    };
    if (def.types) {
      absorb(await placesCall('places:searchNearby', {
        includedTypes: def.types,
        maxResultCount: 20,
        languageCode: 'nl',
        rankPreference: 'POPULARITY',
        locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius } },
      }));
    }
    if (def.text) {
      absorb(await placesCall('places:searchText', {
        textQuery: def.text,
        maxResultCount: 20,
        languageCode: 'nl',
        ...(def.strictType ? { includedType: def.strictType, strictTypeFiltering: true } : {}),
        locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius } },
      }));
    }
    cats[def.key] = [...byName.values()];
  }

  // Buurlanden komen asynchroon: het laden wacht er nooit op. Een
  // eerdere waarde blijft staan; ontbreekt die, dan vult de peiling op
  // de achtergrond het cache-record aan (belangrijk voor het
  // milieuvignet bij grens-bestemmingen).
  const prev = await cacheGetAny(nearbyKey(lat, lng), TTL_NEARBY);
  const prevNb = (prev && prev.data && Array.isArray(prev.data.neighbours)) ? prev.data.neighbours : null;
  const raw = {
    v: PLACES_VERSION,
    cats,
    neighbours: prevNb || [],
  };
  await cacheSet(nearbyKey(lat, lng), raw);
  if (!prevNb || !prevNb.length) updateNeighboursLater(lat, lng);
  const total = Object.values(cats).reduce((n, a) => n + a.length, 0);
  console.log(`[geo/cache] omgeving opgeslagen (Places): ${nearbyKey(lat, lng)} (${total} plekken)`);
  return raw;
}

function usableRaw(cached) {
  return !!(cached && cached.data && cached.data.cats && typeof cached.data.cats === 'object');
}

function currentVersion(cached) {
  return !!(cached && cached.data && cached.data.v === PLACES_VERSION);
}

// Bouwt het advies-antwoord uit de gecachte ruwe plekken — filters en
// sortering draaien bij het lezen, dus aanscherpen kost geen nieuwe fetch.
function buildPayload(lat, lng, raw) {
  const categories = PLACES_CATEGORIES.map(def => {
    const pois = (raw.cats[def.key] || [])
      .filter(p => !isExcludedPlace(p))
      .map(p => ({
        name: p.name,
        lat: p.la,
        lng: p.lo,
        rating: p.rating,
        ratingCount: p.count,
        distanceKm: Math.round(haversineKm(lat, lng, p.la, p.lo) * 10) / 10,
      }))
      // Crowd-validatie: zonder serieuze beoordelingen niet tonen.
      .filter(p => p.rating && p.ratingCount >= MIN_REVIEWS)
      // Tekst-zoeken kent geen harde straal en dwaalt soms ver af.
      .filter(p => p.distanceKm <= def.radiusKm * 1.4)
      .sort((a, b) =>
        (b.rating || 0) - (a.rating || 0)
        || (b.ratingCount || 0) - (a.ratingCount || 0)
        || a.distanceKm - b.distanceKm)
      .slice(0, 20);
    return { key: def.key, label: def.label, ages: def.ages, activity: def.activity, pois };
  });

  // Specifieke categorieën winnen van algemene: een kinderboerderij niet
  // óók bij dierentuinen, een musicaltheater niet óók bij theaters, en
  // wat al ergens staat niet nóg eens bij bezienswaardigheden.
  const names = key => new Set(
    (categories.find(c => c.key === key) || { pois: [] }).pois.map(p => p.name.toLowerCase()));
  const drop = (key, taken) => {
    const cat = categories.find(c => c.key === key);
    if (cat) cat.pois = cat.pois.filter(p => !taken.has(p.name.toLowerCase()));
  };
  drop('zoo', names('pettingzoo'));
  drop('theatre', names('musical'));
  const takenElsewhere = new Set();
  for (const c of categories) {
    if (c.key === 'attraction') continue;
    for (const p of c.pois) takenElsewhere.add(p.name.toLowerCase());
  }
  drop('attraction', takenElsewhere);

  const neighbours = (Array.isArray(raw.neighbours) ? raw.neighbours : [])
    .map(iso => COUNTRIES.find(cn => cn.code === iso))
    .filter(Boolean)
    .map(({ code, name, euro, idCard }) => ({ code, name, euro, idCard }));

  return { categories: categories.filter(c => c.pois.length), neighbours };
}

// Eén ophaal-actie per locatie, hoeveel bezoekers er ook tegelijk
// wachten; na een mislukking 2 minuten afkoeltijd zodat de 15-seconden-
// poll van de frontend geen nieuwe stormen ontketent.
const rawInFlight = new Map(); // key → Promise<raw>
const FAIL_COOLDOWN_MS = 2 * 60 * 1000;
const lastFail = new Map(); // key → timestamp

function fetchNearbyRawShared(lat, lng) {
  const key = nearbyKey(lat, lng);
  const existing = rawInFlight.get(key);
  if (existing) return existing;
  const failedAt = lastFail.get(key);
  if (failedAt && Date.now() - failedAt < FAIL_COOLDOWN_MS) {
    return Promise.reject(new Error('De omgevingsdienst had het even moeilijk — over een paar minuten proberen we het automatisch opnieuw'));
  }
  const p = fetchNearbyRaw(lat, lng)
    .then(raw => { lastFail.delete(key); return raw; })
    .catch(err => { lastFail.set(key, Date.now()); throw err; })
    .finally(() => rawInFlight.delete(key));
  rawInFlight.set(key, p);
  return p;
}

// Verse fetch op de achtergrond, zonder de aanvrager te laten wachten.
const refreshInFlight = new Set();
function backgroundRefresh(lat, lng) {
  const key = nearbyKey(lat, lng);
  if (refreshInFlight.has(key)) return;
  refreshInFlight.add(key);
  console.log('[geo/cache] cache verouderd — automatische verversing voor', key);
  fetchNearbyRawShared(lat, lng)
    .catch(err => console.warn('[geo/cache] achtergrond-verversing mislukt:', err.message))
    .finally(() => refreshInFlight.delete(key));
}

// Alleen cache-check: geen live-fetch. Geeft { ready } terug zodat de
// frontend de Omgeving-knop pas activeert als er iets te tonen is.
router.get('/nearby/ready', async (req, res) => {
  const c = parseCoords(req);
  if (!c) return res.status(400).json({ error: 'Ongeldige coördinaten' });
  const cached = await cacheGetAny(nearbyKey(c.lat, c.lng), TTL_NEARBY);
  const usable = usableRaw(cached);
  if (usable && (!cached.fresh || !currentVersion(cached))) backgroundRefresh(c.lat, c.lng);
  res.json({ ready: usable });
});

router.get('/nearby', async (req, res) => {
  const c = parseCoords(req);
  if (!c) return res.status(400).json({ error: 'Ongeldige coördinaten' });
  const refresh = req.query.refresh === '1';

  const cached = await cacheGetAny(nearbyKey(c.lat, c.lng), TTL_NEARBY);
  const usable = usableRaw(cached);

  // Bruikbare cache direct serveren (ook verouderd — beter snel iets
  // dan traag alles) en op de achtergrond verversen. Alleen de
  // Vernieuwen-knop (refresh=1) wacht op verse data.
  if (!refresh && usable) {
    if (!cached.fresh || !currentVersion(cached)) backgroundRefresh(c.lat, c.lng);
    // Buurlanden nog onbekend (bv. de peiling was eerder mislukt)?
    // Alsnog op de achtergrond aanvullen.
    if (!Array.isArray(cached.data.neighbours) || !cached.data.neighbours.length) {
      updateNeighboursLater(c.lat, c.lng);
    }
    return res.json(buildPayload(c.lat, c.lng, cached.data));
  }

  try {
    const raw = await fetchNearbyRawShared(c.lat, c.lng);
    res.json(buildPayload(c.lat, c.lng, raw));
  } catch (err) {
    console.error('[geo/nearby]', err.message);
    // Verouderde data is beter dan een foutmelding.
    if (usable) return res.json(buildPayload(c.lat, c.lng, cached.data));
    res.status(502).json({ error: 'Omgevingsinformatie is tijdelijk niet beschikbaar — probeer het later opnieuw' });
  }
});

// Fire-and-forget: omgevingsdata alvast ophalen zodra een checklist een
// kaartlocatie krijgt — met herkansingen, zodat de data er meestal al
// staat vóór iemand op Omgeving drukt.
function prefetchNearby(lat, lng, attempt = 1) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
  cacheGetAny(nearbyKey(lat, lng), TTL_NEARBY)
    .then(hit => {
      if (usableRaw(hit) && hit.fresh) return null;
      console.log(`[geo/prefetch] omgeving voorladen voor ${lat.toFixed(2)} ${lng.toFixed(2)}${attempt > 1 ? ` (poging ${attempt})` : ''}`);
      return fetchNearbyRawShared(lat, lng);
    })
    .catch(err => {
      if (attempt < 3) {
        console.warn(`[geo/prefetch] mislukt, nieuwe poging over 3 min (${attempt}/3):`, err.message);
        setTimeout(() => prefetchNearby(lat, lng, attempt + 1), 3 * 60 * 1000);
      } else {
        console.warn('[geo/prefetch] definitief mislukt — wordt opnieuw geprobeerd zodra iemand de Omgeving-pagina opent:', err.message);
      }
    });
}

// Diagnose: wat vindt Google Places rond dit punt voor deze zoekterm,
// en waarom zou het wel/niet getoond worden? Voor het onderzoeken van
// 'ik mis plek X'-meldingen zonder te gissen.
router.get('/debug', async (req, res) => {
  const c = parseCoords(req);
  const q = String(req.query.q || '').trim().slice(0, 80);
  if (!c || q.length < 2) {
    return res.status(400).json({ error: 'lat, lng en q (zoekterm) zijn verplicht' });
  }
  try {
    const places = await placesCall('places:searchText', {
      textQuery: q,
      maxResultCount: 10,
      languageCode: 'nl',
      locationBias: { circle: { center: { latitude: c.lat, longitude: c.lng }, radius: 40000 } },
    });
    const results = places.map(p => {
      const distanceKm = Math.round(haversineKm(c.lat, c.lng, p.la, p.lo) * 10) / 10;
      return {
        name: p.name,
        rating: p.rating,
        ratingCount: p.count,
        distanceKm,
        primaryType: p.pt,
        verdict: {
          genoegReviews: (p.count || 0) >= MIN_REVIEWS,
          minReviews: MIN_REVIEWS,
          uitgesloten: isExcludedPlace(p),
        },
      };
    });
    res.json({ source: 'debug-v3-places', query: q, around: c, count: results.length, results });
  } catch (err) {
    res.status(502).json({ error: `Diagnose mislukt: ${err.message}` });
  }
});

module.exports = router;
module.exports.prefetchNearby = prefetchNearby;
