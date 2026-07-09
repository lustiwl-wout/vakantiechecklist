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

// Bounding box van ±km rond een punt, als Overpass-bbox-string.
function bboxFor(lat, lng, km) {
  const dLat = km / 111;
  const dLng = km / (111 * Math.max(0.2, Math.cos(lat * Math.PI / 180)));
  return `${(lat - dLat).toFixed(4)},${(lng - dLng).toFixed(4)},${(lat + dLat).toFixed(4)},${(lng + dLng).toFixed(4)}`;
}

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

// Overpass-categorieën → NL-labels + leeftijdsadvies + activiteit-koppeling.
// De 'activity' verwijst naar de activiteiten van de checklist zodat
// 'Zet op mijn programma' de paklijst kan bijwerken. Elke categorie heeft
// een eigen zoekstraal en resultaat-cap, zodat dichte categorieën
// (restaurants!) de rest niet verdringen.
const POI_CATEGORIES = [
  { key: 'themepark', selectors: ['["tourism"="theme_park"]'], radiusKm: 35, cap: 80, label: 'Pretparken', ages: 'kinderen en tieners', activity: 'themepark' },
  { key: 'zoo', selectors: ['["tourism"="zoo"]'], radiusKm: 35, cap: 120, label: 'Dierentuinen', ages: 'alle leeftijden', activity: 'daytrip' },
  // Kinderboerderijen zijn een lokaal uitje (kleinere straal) en horen
  // niet tussen de dierentuinen.
  { key: 'pettingzoo', selectors: ['["zoo"="petting_zoo"]'], radiusKm: 15, cap: 60, label: 'Kinderboerderijen', ages: 'jonge kinderen', activity: 'daytrip' },
  { key: 'aquarium', selectors: ['["tourism"="aquarium"]'], radiusKm: 35, cap: 40, label: 'Aquaria', ages: 'alle leeftijden', activity: 'daytrip' },
  // Bosbaden/openluchtzwembaden staan in OSM zelden als water_park maar
  // als swimming_pool of sports_centre+swimming. Die tags zijn ruizig
  // (elk privé-bassin), maar de naam-eis in de query en de bekendheids-
  // score filteren dat weg: alleen zwembaden met een eigen website of
  // wiki-vermelding komen door (Bosbad Zwinderen wél, losse bassins niet).
  { key: 'waterpark', selectors: ['["leisure"="water_park"]', '["leisure"="swimming_pool"]', '["leisure"="sports_centre"]["sport"="swimming"]'], radiusKm: 35, cap: 100, label: 'Zwembaden & waterparken', ages: 'alle leeftijden', activity: 'pool' },
  { key: 'nature', selectors: ['["boundary"="national_park"]', '["leisure"="nature_reserve"]'], radiusKm: 35, cap: 80, label: 'Natuur & wandelgebieden', ages: 'alle leeftijden', activity: 'hiking' },
  { key: 'museum', selectors: ['["tourism"="museum"]'], radiusKm: 25, cap: 100, label: 'Musea', ages: 'vanaf ± 6 jaar', activity: 'cultural' },
  { key: 'attraction', selectors: ['["tourism"="attraction"]'], radiusKm: 20, cap: 80, label: 'Bezienswaardigheden & uitjes', ages: 'alle leeftijden', activity: 'daytrip' },
  { key: 'beach', selectors: ['["natural"="beach"]'], radiusKm: 25, cap: 40, label: 'Stranden', ages: 'alle leeftijden', activity: 'beach' },
  { key: 'restaurant', selectors: ['["amenity"="restaurant"]'], radiusKm: 8, cap: 40, label: 'Restaurants', ages: 'alle leeftijden', activity: 'nightlife' },
];

function buildOverpassQuery(lat, lng) {
  // Een globale bounding box maakt de query fundamenteel goedkoop: elke
  // tag-zoekopdracht blijft binnen het 35km-gebied in plaats van tegen
  // wereldwijde indexen aan te lopen. Zonder bbox viel de eerste
  // categorie op drukke servers al om ('Query timed out at line 3').
  const bbox = bboxFor(lat, lng, 35);

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
  if (t.zoo === 'petting_zoo') return 'pettingzoo';
  if (t.tourism === 'zoo') return 'zoo';
  if (t.tourism === 'aquarium') return 'aquarium';
  if (t.leisure === 'water_park' || t.leisure === 'swimming_pool'
      || (t.leisure === 'sports_centre' && t.sport === 'swimming')) return 'waterpark';
  if (t.boundary === 'national_park' || t.leisure === 'nature_reserve') return 'nature';
  if (t.tourism === 'museum') return 'museum';
  if (t.natural === 'beach') return 'beach';
  if (t.amenity === 'restaurant') return 'restaurant';
  // 'attraction' als laatste: veel POI's hebben tourism=attraction als
  // extra tag naast een specifiekere.
  if (t.tourism === 'attraction') return 'attraction';
  return null;
}

// Bekendheids-score op basis van OSM-metadata. Bekende attracties hebben
// een Wikipedia-artikel, website en openingstijden; een obscuur
// hertenkampje of bosperceel heeft alleen een naam. Zonder externe
// beoordelingen is dit de beste maat voor 'is dit een échte uitje'.
// Compacte samenvatting van de tags die de validatie nodig heeft.
// Duplicaten van dezelfde plek (punt + gebied in OSM) worden hierop
// samengevoegd vóór validatie, zodat metadata van beide varianten telt.
function liteTags(tags) {
  const rawSite = tags.website || tags['contact:website'] || null;
  return {
    // Een Facebook-/Instagram-pagina is geen echte website — dat is
    // precies het profiel van heemkundekamertjes en clubjes.
    website: rawSite && !/facebook\.com|instagram\.com/i.test(rawSite) ? rawSite : null,
    wikipedia: Boolean(tags.wikipedia),
    wikidata: Boolean(tags.wikidata),
    openingHours: Boolean(tags.opening_hours),
    phone: Boolean(tags.phone || tags['contact:phone']),
    operator: Boolean(tags.operator || tags.brand),
    historic: Boolean(tags.historic || tags.heritage || tags['heritage:operator']),
    memorialArt: Boolean(tags.artwork_type || tags.memorial || tags['memorial:type'] || tags.tourism === 'artwork'),
    lodgingTag: LODGING_TOURISM_TAGS.has(String(tags.tourism || ''))
      || tags.building === 'hotel' || tags.leisure === 'summer_camp' || tags.leisure === 'resort',
    nationalPark: tags.boundary === 'national_park',
    // De specifieke water_park-tag is zelf al een sterk signaal (wordt
    // zelden misbruikt); de score-drempel geldt alleen voor de ruizige
    // swimming_pool-/sports_centre-varianten. Zo blijft Aqua Mundo
    // (kaal object zonder eigen website) zichtbaar.
    waterParkTag: tags.leisure === 'water_park',
  };
}

function mergeLite(a, b) {
  return {
    website: a.website || b.website,
    wikipedia: a.wikipedia || b.wikipedia,
    wikidata: a.wikidata || b.wikidata,
    openingHours: a.openingHours || b.openingHours,
    phone: a.phone || b.phone,
    operator: a.operator || b.operator,
    historic: a.historic || b.historic,
    memorialArt: a.memorialArt || b.memorialArt,
    lodgingTag: a.lodgingTag || b.lodgingTag,
    nationalPark: a.nationalPark || b.nationalPark,
    waterParkTag: a.waterParkTag || b.waterParkTag,
  };
}

// Bekendheids-score. Bekende attracties hebben een Wikipedia-artikel,
// website en openingstijden; obscure plekjes alleen een naam.
// Merk-/keten-punt telt niet voor restaurants (anders staat elke
// fastfoodketen boven de lokale restaurants).
function notabilityScore(cat, t) {
  let s = 0;
  if (t.wikipedia || t.wikidata) s += 4;
  if (t.website) s += 2;
  if (t.openingHours) s += 1;
  if (t.phone) s += 1;
  if (t.operator && cat !== 'restaurant') s += 1;
  return s;
}

// Minimale score per categorie: hoe ruisgevoeliger de OSM-tag, hoe
// strenger de drempel. Stranden hebben zelden metadata → geen drempel.
// zoo op 1 (niet 2): tourism=zoo wordt zelden misbruikt, en echte kleine
// parken (Almere Jungle) staan vaak mager getagd in OSM. Eén signaal
// volstaat; plekken zonder énige metadata (VéFauna) blijven buiten beeld.
const MIN_SCORE = {
  themepark: 2, zoo: 1, pettingzoo: 1, aquarium: 2, waterpark: 2,
  museum: 2, attraction: 2, restaurant: 1,
  nature: 0, beach: 0,
};

// Accommodaties zijn geen uitjes, maar duiken wel op in de resultaten:
// een groepsaccommodatie met recreatieplas draagt soms óók een
// water_park- of attraction-tag, en de naam verraadt vaak de rest.
// Bewust géén 'hotel'/'hostel' in de naam-regex: echte hotels dragen de
// tourism-tag, en bezienswaardigheden als Hotel New York (Rotterdam)
// zouden anders sneuvelen.
const LODGING_TOURISM_TAGS = new Set([
  'hotel', 'guest_house', 'hostel', 'motel', 'apartment',
  'chalet', 'camp_site', 'caravan_site', 'alpine_hut', 'resort', 'holiday_park',
]);
const LODGING_NAME_RE = /groepsaccommodatie|groepsverblijf|vakantiehuis|vakantiewoning|vakantiepark|recreatiepark|ferienpark|bungalowpark|\bresort\b|bed\s*&\s*breakfast|\bb\s?&\s?b\b|\bcamping\b|\bminicamping\b|\bpension\b/i;

// Bedrijven die zichzelf als attractie of waterpark taggen maar geen
// dagje uit zijn.
const ATTRACTION_NAME_BLOCK = /manege|ruitersport|partycentrum|zalencentrum|feestzaal|kinderopvang|kinderdagverblijf/i;
const WATERPARK_NAME_BLOCK = /zwemschool|zwemles|sportcentrum|sporthal|sportschool/i;

// Een naam die alleen een soortnaam is ("PARK", "Zwembad", "Museum") is
// vrijwel altijd data-vervuiling of een verkeerd getagd bedrijf — echte
// uitjes hebben een eigen naam. Alleen toestaan met wiki-bewijs.
const GENERIC_NAMES = new Set([
  'park', 'pretpark', 'attractiepark', 'speeltuin', 'speelpark',
  'zwembad', 'bosbad', 'waterpark', 'museum', 'strand', 'beach',
  'restaurant', 'café', 'cafe', 'dierentuin', 'zoo', 'aquarium',
  'kinderboerderij', 'speelparadijs', 'binnenspeeltuin', 'natuurgebied', 'bos',
]);

function hasGenericName(name, t) {
  const n = name.trim().toLowerCase();
  if (n.length < 3 || GENERIC_NAMES.has(n)) return !(t.wikipedia || t.wikidata);
  return false;
}

function isLodging(cat, name, t) {
  // Nationale parken en hotel-zwemparadijzen met dagkaarten (De Bonte
  // Wever, Preston Palace — herkenbaar aan hun wiki-vermelding) zijn
  // uitjes, ook al draagt het OSM-object een verblijfs-tag.
  if (t.nationalPark) return false;
  if (cat === 'waterpark' && (t.wikipedia || t.wikidata)) return false;
  if (t.lodgingTag) return true;
  // Naam-check niet voor restaurants ("Restaurant Hotel De Wereld") en
  // niet voor plekken met een wiki-vermelding ("Strand Camping Bakkum"
  // kán een begrip zijn).
  if (cat !== 'restaurant' && !(t.wikipedia || t.wikidata) && LODGING_NAME_RE.test(name)) return true;
  return false;
}

function isValidNearbyPoi(cat, name, t) {
  if (!cat || !name) return false;
  if (t.memorialArt) return false;
  if (hasGenericName(name, t)) return false;
  if (isLodging(cat, name, t)) return false;

  if (cat === 'attraction') {
    if (ATTRACTION_NAME_BLOCK.test(name)) return false;
    // Bezoekbaar-signaal vereist: website of openingstijden. Wikipedia
    // alléén volstaat voor grote bezienswaardigheden zonder kassa
    // (Oosterscheldekering), maar niet voor monumentjes met een
    // historic-tag (Poepenhemeltje).
    return Boolean(t.website || t.openingHours || (t.wikipedia && !t.historic));
  }
  if (cat === 'waterpark' && WATERPARK_NAME_BLOCK.test(name)) return false;
  // Natuur: elk bosperceel staat in OSM als nature_reserve, en bulk-
  // imports gaven ze massaal een wikidata-tag. Alleen nationale parken,
  // gebieden met een écht Wikipedia-artikel, of met een eigen website
  // (boswachterijen van Staatsbosbeheer).
  if (cat === 'nature') {
    return t.nationalPark || t.wikipedia || Boolean(t.website);
  }
  // Voor echte water_park-objecten geldt de tag zelf als bewijs
  // (Aqua Mundo heeft geen eigen website in OSM); de drempel is er
  // voor de ruizige swimming_pool-varianten.
  let min = MIN_SCORE[cat] ?? 0;
  if (cat === 'waterpark' && t.waterParkTag) min = 0;
  return notabilityScore(cat, t) >= min;
}

// ---- routes ----

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

// Alleen ophogen als buildOverpassQuery of de selectors veranderen —
// dán mist de gecachte ruwe data elementsoorten en is een verse fetch
// nodig. Filter-/score-wijzigingen vereisen GEEN nieuwe fetch: die
// draaien bij het lezen over de gecachte ruwe data.
const QUERY_VERSION = 2;

function nearbyKey(lat, lng) {
  return `nearby:raw:${lat.toFixed(2)}:${lng.toFixed(2)}`;
}

// Haalt de ruwe omgevingsdata op bij Overpass en cachet die 30 dagen.
// We bewaren bewust de ONGEFILTERDE elementen: zo profiteren
// filter-verbeteringen direct van de bestaande cache in plaats van
// telkens een trage nieuwe zoektocht af te dwingen.
async function fetchNearbyRaw(lat, lng) {
  const data = await overpassFetch(buildOverpassQuery(lat, lng));

  // Overpass geeft bij een timeout vaak HTTP 200 met een 'remark' en
  // (vrijwel) lege elements terug. Dat is een fout, geen 'niets in de
  // buurt' — anders tonen we ten onrechte een lege adviespagina.
  const elements = data.elements || [];
  if (data.remark && elements.length === 0) {
    throw new Error(`Overpass remark: ${data.remark}`);
  }
  if (data.remark) console.warn('[geo/nearby] Overpass remark (deels resultaat):', data.remark);

  const raw = {
    qv: QUERY_VERSION,
    els: elements
      .map(el => ({
        la: el.lat ?? (el.center && el.center.lat) ?? null,
        lo: el.lon ?? (el.center && el.center.lon) ?? null,
        tags: el.tags || {},
      }))
      .filter(e => Object.keys(e.tags).length),
  };
  await cacheSet(nearbyKey(lat, lng), raw);
  console.log(`[geo/cache] omgeving opgeslagen: ${nearbyKey(lat, lng)} (${raw.els.length} elementen)`);
  return raw;
}

function usableRaw(cached) {
  return !!(cached && cached.data && cached.data.qv === QUERY_VERSION && Array.isArray(cached.data.els));
}

// Bouwt het advies-antwoord uit de (gecachte) ruwe elementen — hier
// leven classificatie, validatie, merge en sortering.
function buildPayload(lat, lng, raw) {
  const radiusByCat = Object.fromEntries(POI_CATEGORIES.map(x => [x.key, x.radiusKm]));
  const groups = {}; // cat → Map(naam-sleutel → kandidaat)
  const countriesNearby = new Set();

  for (const el of raw.els) {
    const tags = el.tags;
    if (tags.boundary === 'administrative' && tags.admin_level === '2') {
      const iso = String(tags['ISO3166-1'] || '').toLowerCase();
      if (iso) countriesNearby.add(iso);
      continue;
    }
    const cat = classify({ tags });
    if (!cat || !tags.name) continue;
    const plat = el.la;
    const plng = el.lo;
    if (plat == null) continue;
    const dist = haversineKm(lat, lng, plat, plng);
    // Grote gebieden (natuur, strand) hebben hun centroid soms ver van de
    // rand die bij jou om de hoek ligt — ruimere afstandsdrempel.
    const maxDist = (radiusByCat[cat] || 35) * ((cat === 'nature' || cat === 'beach') ? 2 : 1);
    if (dist > maxDist) continue;

    // Samenvoegen vóór validatie: hetzelfde park staat in OSM vaak dubbel
    // (punt + gebied) met verschillende metadata — de één heeft de wiki-
    // verwijzing, de ander de website. Alleen mergen als het écht dezelfde
    // plek is (zelfde naam én < 2 km uit elkaar), anders worden twee
    // dorpsmusea met dezelfde naam één item met de verkeerde afstand.
    const byName = (groups[cat] = groups[cat] || new Map());
    const t = liteTags(tags);
    const baseKey = tags.name.toLowerCase();
    let entry = null;
    for (let i = 0; ; i++) {
      const k = i === 0 ? baseKey : `${baseKey}#${i}`;
      const cur = byName.get(k);
      if (!cur) { entry = { key: k, name: tags.name, distanceKm: dist, t }; byName.set(k, entry); break; }
      if (Math.abs(cur.distanceKm - dist) < 2) {
        cur.t = mergeLite(cur.t, t);
        cur.distanceKm = Math.min(cur.distanceKm, dist);
        break;
      }
    }
  }

  const categories = POI_CATEGORIES
    .map(cdef => {
      const candidates = groups[cdef.key] ? [...groups[cdef.key].values()] : [];
      // Valideren ná het samenvoegen, op de gecombineerde metadata.
      const pois = candidates
        .filter(c2 => isValidNearbyPoi(cdef.key, c2.name, c2.t))
        .map(c2 => ({
          name: c2.name,
          distanceKm: Math.round(c2.distanceKm * 10) / 10,
          website: c2.t.website,
          score: notabilityScore(cdef.key, c2.t),
        }))
        // Bekendste eerst; afstand als tiebreaker. Zo wint Wildlands (met
        // Wikipedia + website) van een naamloos hertenkampje om de hoek.
        .sort((a, b) => (b.score - a.score) || (a.distanceKm - b.distanceKm))
        .slice(0, 15);
      return { key: cdef.key, label: cdef.label, ages: cdef.ages, activity: cdef.activity, pois };
    })
    .filter(cdef => cdef.pois.length);

  // Buurlanden: alle admin-grenzen binnen 30 km behalve het land zelf.
  const neighbours = [...countriesNearby]
    .map(iso => COUNTRIES.find(cn => cn.code === iso))
    .filter(Boolean);

  return { categories, neighbours: neighbours.map(({ code, name, euro, idCard }) => ({ code, name, euro, idCard })) };
}

// Verse fetch op de achtergrond, zonder de aanvrager te laten wachten.
let refreshInFlight = new Set();
function backgroundRefresh(lat, lng) {
  const key = nearbyKey(lat, lng);
  if (refreshInFlight.has(key)) return;
  refreshInFlight.add(key);
  console.log('[geo/cache] cache verlopen — automatische verversing voor', key);
  fetchNearbyRaw(lat, lng)
    .catch(err => console.warn('[geo/cache] achtergrond-verversing mislukt:', err.message))
    .finally(() => refreshInFlight.delete(key));
}

// Alleen cache-check: geen live-fetch. Geeft { ready: true/false } terug
// zodat de frontend de Omgeving-knop pas toont als de data beschikbaar is.
router.get('/nearby/ready', async (req, res) => {
  const c = parseCoords(req);
  if (!c) return res.status(400).json({ error: 'Ongeldige coördinaten' });
  const cached = await cacheGetAny(nearbyKey(c.lat, c.lng), TTL_NEARBY);
  const usable = usableRaw(cached);
  // Verlopen maar bruikbaar telt als 'klaar' (we serveren de oude data
  // direct) en start meteen de automatische verversing.
  if (usable && !cached.fresh) backgroundRefresh(c.lat, c.lng);
  res.json({ ready: usable });
});

router.get('/nearby', async (req, res) => {
  const c = parseCoords(req);
  if (!c) return res.status(400).json({ error: 'Ongeldige coördinaten' });
  const refresh = req.query.refresh === '1';

  const cached = await cacheGetAny(nearbyKey(c.lat, c.lng), TTL_NEARBY);
  const usable = usableRaw(cached);

  // Cache mag 30 dagen oud worden. Vers → direct serveren. Verlopen →
  // óók direct serveren (geen wachttijd voor de gebruiker) en op de
  // achtergrond automatisch volledig verversen. Alleen de
  // Vernieuwen-knop (refresh=1) wacht op verse data.
  if (!refresh && usable) {
    if (!cached.fresh) backgroundRefresh(c.lat, c.lng);
    return res.json(buildPayload(c.lat, c.lng, cached.data));
  }

  try {
    const raw = await fetchNearbyRaw(c.lat, c.lng);
    res.json(buildPayload(c.lat, c.lng, raw));
  } catch (err) {
    console.error('[geo/nearby]', err.message);
    // Verouderde data is beter dan een foutmelding.
    if (usable) return res.json(buildPayload(c.lat, c.lng, cached.data));
    res.status(502).json({ error: 'Omgevingsinformatie is tijdelijk niet beschikbaar — probeer het later opnieuw' });
  }
});

// Fire-and-forget: omgevingsdata alvast ophalen zodra een checklist een
// kaartlocatie krijgt — dan is de Omgeving-pagina daarna meteen snel.
function prefetchNearby(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
  cacheGetAny(nearbyKey(lat, lng), TTL_NEARBY)
    .then(hit => {
      if (usableRaw(hit) && hit.fresh) return null;
      console.log('[geo/prefetch] omgeving voorladen voor', lat.toFixed(2), lng.toFixed(2));
      return fetchNearbyRaw(lat, lng);
    })
    .catch(err => console.warn('[geo/prefetch] mislukt (geen probleem):', err.message));
}

// Diagnose: zoek op naam rond een punt en laat per gevonden OSM-object
// zien waarom het wel/niet in het omgevingsadvies belandt. Voor het
// onderzoeken van 'ik mis plek X'-meldingen zonder te gissen naar tags.
router.get('/debug', async (req, res) => {
  const c = parseCoords(req);
  const q = String(req.query.q || '').trim().slice(0, 60);
  if (!c || q.length < 2) return res.status(400).json({ error: 'lat, lng en q zijn verplicht' });

  try {
    // Zoeken-op-naam via Nominatim: daar is die dienst voor gebouwd
    // (naam-index, subseconde-antwoord) en extratags levert de OSM-tags.
    // Overpass bleek hiervoor het verkeerde gereedschap: een naam-regex
    // time-out zelfs met bbox en tag-voorfilters in dichte gebieden.
    const [s, w, n, e] = bboxFor(c.lat, c.lng, 40).split(',');
    const viewbox = `${w},${s},${e},${n}`; // Nominatim wil west,zuid,oost,noord
    const data = await nominatimFetch(
      `/search?format=jsonv2&limit=8&extratags=1&addressdetails=0&bounded=1&viewbox=${viewbox}&q=${encodeURIComponent(q)}`
    );

    const results = data.map(r => {
      // Reconstrueer een tags-object zoals Overpass het zou geven:
      // class/type is de hoofd-tag, extratags bevat de rest.
      const name = r.name || String(r.display_name || '').split(',')[0];
      const tags = { name, ...(r.extratags || {}) };
      // jsonv2 noemt het veld 'category'; oudere formaten 'class'.
      const mainKey = r.category || r.class;
      if (mainKey && r.type) tags[mainKey] = r.type;
      const cat = classify({ tags });
      const t = liteTags(tags);
      return {
        name,
        osm: `${r.osm_type}/${r.osm_id}`,
        distanceKm: Math.round(haversineKm(c.lat, c.lng, Number(r.lat), Number(r.lon)) * 10) / 10,
        category: cat,
        verdict: {
          valid: cat ? isValidNearbyPoi(cat, name, t) : false,
          lodging: cat ? isLodging(cat, name, t) : null,
          genericName: hasGenericName(name, t),
          score: cat ? notabilityScore(cat, t) : null,
          minRequired: cat ? (MIN_SCORE[cat] ?? 0) : null,
        },
        tags,
      };
    });
    res.json({ source: 'debug-v2-nominatim', query: q, around: c, count: results.length, results });
  } catch (err) {
    res.status(502).json({ error: `Diagnose mislukt: ${err.message}` });
  }
});

module.exports = router;
module.exports.prefetchNearby = prefetchNearby;
