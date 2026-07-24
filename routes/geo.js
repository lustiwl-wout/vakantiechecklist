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
  'https://overpass.private.coffee/api/interpreter',
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

async function overpassFetch(query, clientTimeoutMs = 30000) {
  let lastErr = null;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query),
        signal: AbortSignal.timeout(clientTimeoutMs),
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
// gtype: het Google Places-type waarop de sterren-opzoeking strikt mag
// matchen. Zonder gtype zoekt Google vrij op naam — en dan matcht
// "Museum GGZ Drenthe" op de zorginstelling GGZ Drenthe (honderden
// reviews) in plaats van op het miniatuurmuseum, en glipt zo'n plek
// langs de reviews-drempel. Alleen gezet waar Googles typering
// betrouwbaar is; bosbaden (swimming_pool vs water_park) en
// kinderboerderijen typeert Google te wisselend voor een strikt filter.
const POI_CATEGORIES = [
  { key: 'themepark', selectors: ['["tourism"="theme_park"]'], radiusKm: 35, cap: 80, label: 'Pretparken', ages: 'kinderen en tieners', activity: 'themepark', gtype: 'amusement_park' },
  { key: 'zoo', selectors: ['["tourism"="zoo"]'], radiusKm: 35, cap: 120, label: 'Dierentuinen', ages: 'alle leeftijden', activity: 'daytrip', gtype: 'zoo' },
  // Kinderboerderijen zijn een lokaal uitje (kleinere straal) en horen
  // niet tussen de dierentuinen.
  { key: 'pettingzoo', selectors: ['["zoo"="petting_zoo"]'], radiusKm: 15, cap: 60, label: 'Kinderboerderijen', ages: 'jonge kinderen', activity: 'daytrip' },
  { key: 'aquarium', selectors: ['["tourism"="aquarium"]'], radiusKm: 35, cap: 40, label: 'Aquaria', ages: 'alle leeftijden', activity: 'daytrip', gtype: 'aquarium' },
  // Bosbaden/openluchtzwembaden staan in OSM zelden als water_park maar
  // als swimming_pool of sports_centre+swimming. Die tags zijn ruizig
  // (elk privé-bassin), maar de naam-eis in de query en de bekendheids-
  // score filteren dat weg: alleen zwembaden met een eigen website of
  // wiki-vermelding komen door (Bosbad Zwinderen wél, losse bassins niet).
  // De vierde selector vangt zwembaden die als sports_centre getagd
  // staan zónder sport=swimming maar mét een zwem-naam (het Bosbad-
  // diagnosegeval); de naam-regex draait alleen op sports_centres
  // binnen de bbox en is dus betaalbaar.
  { key: 'waterpark', selectors: ['["leisure"="water_park"]', '["leisure"="swimming_pool"]', '["leisure"="sports_centre"]["sport"="swimming"]', '["leisure"="sports_centre"]["name"~"zwembad|bosbad|zwemparadijs",i]'], radiusKm: 35, cap: 100, label: 'Zwembaden & waterparken', ages: 'alle leeftijden', activity: 'pool' },
  { key: 'nature', selectors: ['["boundary"="national_park"]', '["leisure"="nature_reserve"]'], radiusKm: 35, cap: 80, label: 'Natuur & wandelgebieden', ages: 'alle leeftijden', activity: 'hiking' },
  // Galerieën horen bij musea: het Tate en Rijksmuseum-achtige plekken
  // staan in OSM als tourism=gallery, niet als museum.
  { key: 'museum', selectors: ['["tourism"="museum"]', '["tourism"="gallery"]'], radiusKm: 25, cap: 100, label: 'Musea', ages: 'vanaf ± 6 jaar', activity: 'cultural', gtype: 'museum' },
  // Voor stedentrips: theaters en concertzalen. Musicaltheaters krijgen
  // een eigen categorie — grote steden (West End, Broadway, Hamburg)
  // zijn er beroemd om, en in OSM dragen ze theatre:genre=musical.
  { key: 'musical', selectors: ['["amenity"="theatre"]["theatre:genre"="musical"]'], radiusKm: 25, cap: 40, label: 'Musicals', ages: 'vanaf ± 6 jaar', activity: 'cultural', gtype: 'performing_arts_theater' },
  { key: 'theatre', selectors: ['["amenity"="theatre"]'], radiusKm: 20, cap: 60, label: 'Theaters & voorstellingen', ages: 'vanaf ± 6 jaar', activity: 'cultural', gtype: 'performing_arts_theater' },
  { key: 'attraction', selectors: ['["tourism"="attraction"]'], radiusKm: 20, cap: 80, label: 'Bezienswaardigheden & uitjes', ages: 'alle leeftijden', activity: 'daytrip' },
  // Zwemplassen dragen zelden natural=beach: recreatieplassen staan als
  // leisure=beach_resort (dagstrand met voorzieningen) of
  // leisure=swimming_area (aangewezen zwemwater). Bekende zwemmeren
  // (Blauwe Meer) zijn soms alleen een natural=water-vlak — die nemen we
  // mee als er een Wikipedia-artikel aan hangt: dat onderscheidt een
  // begrip van elke willekeurige vijver of sloot.
  { key: 'beach', selectors: ['["natural"="beach"]', '["leisure"="beach_resort"]', '["leisure"="swimming_area"]', '["natural"="water"]["wikipedia"]'], radiusKm: 25, cap: 40, label: 'Stranden & zwemplassen', ages: 'alle leeftijden', activity: 'beach' },
  { key: 'restaurant', selectors: ['["amenity"="restaurant"]'], radiusKm: 8, cap: 40, label: 'Restaurants', ages: 'alle leeftijden', activity: 'nightlife', gtype: 'restaurant' },
];

// De 'zware' selectors maken de query in extreem dichte gebieden
// (Londen, Parijs) onbetaalbaar: elk benoemd zwembadje, een naam-regex
// over duizenden sportcentra, elk watervlak met een wiki-link. De lite-
// variant laat ze weg zodat er in elk geval íets geladen kan worden;
// de volledige query volgt dan op de achtergrond.
const HEAVY_SELECTORS = new Set([
  '["leisure"="swimming_pool"]',
  '["leisure"="sports_centre"]["sport"="swimming"]',
  '["leisure"="sports_centre"]["name"~"zwembad|bosbad|zwemparadijs",i]',
  '["natural"="water"]["wikipedia"]',
]);

function buildOverpassQuery(lat, lng, timeoutS = 25, lite = false) {
  // Een globale bounding box maakt de query fundamenteel goedkoop: elke
  // tag-zoekopdracht blijft binnen het 35km-gebied in plaats van tegen
  // wereldwijde indexen aan te lopen. Zonder bbox viel de eerste
  // categorie op drukke servers al om ('Query timed out at line 3').
  const bbox = bboxFor(lat, lng, 35);

  // Elk blok krijgt zijn eigen 'out' met cap. De landsgrens-detectie
  // gebruikt bewust grens-wégen + rel(bw): een 'around' op complete
  // landsrelaties is zó zwaar dat Overpass de query afkapt en (met een
  // remark) níets teruggeeft — de oorzaak van eerdere lege resultaten.
  // Eén blok per SELECTOR (niet per categorie): anders vult een ruizige
  // tag (swimming_pool: elk benoemd bassin) de categorie-limiet voordat
  // de andere tag-soorten aan de beurt zijn, en valt bv. een bosbad
  // verderop achter de afkap.
  const blocks = POI_CATEGORIES.flatMap(c =>
    c.selectors
      .filter(s => !lite || !HEAVY_SELECTORS.has(s))
      .map(s =>
        `(\n  nwr${s}["name"](around:${c.radiusKm * 1000},${lat},${lng});\n);\nout center ${c.cap};`
      )
  ).join('\n');
  return `[out:json][timeout:${timeoutS}][bbox:${bbox}];
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
  // Duikstekken dragen soms een water_park-tag maar zijn geen zwem-uitje.
  if (t.sport === 'scuba_diving') return null;
  if (t.leisure === 'water_park' || t.leisure === 'swimming_pool'
      || (t.leisure === 'sports_centre'
          && (t.sport === 'swimming' || /zwembad|bosbad|zwemparadijs/i.test(String(t.name || ''))))) return 'waterpark';
  if (t.boundary === 'national_park' || t.leisure === 'nature_reserve') return 'nature';
  if (t.tourism === 'museum' || t.tourism === 'gallery') return 'museum';
  // Genre kan een lijst zijn ('musical;drama') — musical wint.
  if (t.amenity === 'theatre' && /musical/i.test(String(t['theatre:genre'] || ''))) return 'musical';
  if (t.amenity === 'theatre') return 'theatre';
  if (t.natural === 'beach' || t.leisure === 'beach_resort' || t.leisure === 'swimming_area'
      || (t.natural === 'water' && t.wikipedia)) return 'beach';
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
    // Expliciet besloten toegang (alleen gasten/privé) = geen uitje.
    accessRestricted: ['customers', 'private', 'no'].includes(String(tags.access || '')),
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
    accessRestricted: a.accessRestricted || b.accessRestricted,
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
  museum: 2, attraction: 2, restaurant: 1, theatre: 2, musical: 2,
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
// Zwemscholen, losse sub-bassins (peuterbad, wedstrijdbad…) én
// attractie-onderdelen ín een zwemparadijs (wildwaterbaan, glijbaan,
// golfslagbad…) zijn geen eigen uitje — het park zelf staat al op de
// lijst.
const WATERPARK_NAME_BLOCK = /zwemschool|zwemles|sportcentrum|sporthal|sportschool|wildwaterbaan|glijbaan|golfslagbad|bubbelbad|springkuil|duikkuil|stroomversnelling|^(peuterbad|kleuterbad|babybad|wedstrijdbad|buitenbad|binnenbad|recreatiebad|doelgroepenbad|instructiebad|therapiebad|whirlpool)$/i;

// Een naam die alleen een soortnaam is ("PARK", "Zwembad", "Museum") is
// vrijwel altijd data-vervuiling of een verkeerd getagd bedrijf — echte
// uitjes hebben een eigen naam. Alleen toestaan met wiki-bewijs.
const GENERIC_NAMES = new Set([
  'park', 'pretpark', 'attractiepark', 'speeltuin', 'speelpark',
  'zwembad', 'bosbad', 'waterpark', 'museum', 'strand', 'beach',
  'restaurant', 'café', 'cafe', 'dierentuin', 'zoo', 'aquarium',
  'kinderboerderij', 'speelparadijs', 'binnenspeeltuin', 'natuurgebied', 'bos',
]);

// Soortnamen die binnen hun eigen categorie juist bevéstigen wat het is:
// een zwembad dat 'Bosbad' heet is geen mistag (naam en tag kloppen met
// elkaar — Bosbad Putten heet in OSM gewoon 'Bosbad'). 'PARK' als
// pretpark blijft verdacht: 'park' zegt niets over een pretpark.
const CATEGORY_GENERIC_OK = {
  waterpark: new Set(['zwembad', 'bosbad', 'waterpark', 'zwemparadijs']),
  pettingzoo: new Set(['kinderboerderij']),
  zoo: new Set(['dierentuin']),
  themepark: new Set(['pretpark', 'attractiepark']),
  museum: new Set(['museum']),
  beach: new Set(['strand', 'beach', 'zwemplas', 'recreatieplas', 'zwemstrand']),
  restaurant: new Set(['restaurant', 'café', 'cafe']),
};

function hasGenericName(cat, name, t) {
  const n = name.trim().toLowerCase();
  if (n.length >= 3 && !GENERIC_NAMES.has(n)) return false;
  if (t.wikipedia || t.wikidata) return false;
  const ok = CATEGORY_GENERIC_OK[cat];
  return !(ok && ok.has(n));
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
  if (t.accessRestricted) return false;
  if (hasGenericName(cat, name, t)) return false;
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
  // (Aqua Mundo heeft geen eigen website in OSM). Ook benoemde openbare
  // zwembaden zonder metadata (Bosbad Putten: score 0) tellen mee — de
  // echte ruis (naamloze bassins, sub-bassins, besloten baden,
  // zwemscholen) is hierboven al uitgesloten via naam- en toegang-checks.
  let min = MIN_SCORE[cat] ?? 0;
  if (cat === 'waterpark') min = 0;
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
const QUERY_VERSION = 8; // v8: musicals (v7: theaters + galerieën)

function nearbyKey(lat, lng) {
  return `nearby:raw:${lat.toFixed(2)}:${lng.toFixed(2)}`;
}

// Al het zware Overpass-werk in een rij: máx één omgevings-zoektocht
// tegelijk vanaf dit IP. Parallel stapelen (meerdere locaties plus de
// verversingen na een versie-bump) lokte 429's en timeouts uit — de
// publieke servers wegen belasting per IP, en tien gelijktijdige
// queries maken elkaar alleen maar langzamer.
let overpassQueue = Promise.resolve();
function queuedOverpass(fn) {
  const run = overpassQueue.then(fn, fn);
  // De rij mag nooit stuklopen op een mislukte voorganger.
  overpassQueue = run.catch(() => {});
  return run;
}

// Na een mislukte poging even niets voor deze locatie: de frontend
// pollt elke 15 s en zou anders telkens een nieuwe (kansloze) storm
// van drie mirrors × volledig + lite ontketenen.
const FAIL_COOLDOWN_MS = 2 * 60 * 1000;
const lastFail = new Map(); // nearbyKey → timestamp

// Haalt de ruwe omgevingsdata op bij Overpass en cachet die 30 dagen.
// We bewaren bewust de ONGEFILTERDE elementen: zo profiteren
// filter-verbeteringen direct van de bestaande cache in plaats van
// telkens een trage nieuwe zoektocht af te dwingen.
// opts.patient: achtergrondtaken (voorladen, verversen) mogen véél langer
// wachten dan een gebruiker die naar een spinner kijkt — drukke Overpass-
// servers halen het dan vaak alsnog.
async function fetchNearbyRaw(lat, lng, opts = {}) {
  return queuedOverpass(() => fetchNearbyRawNow(lat, lng, opts));
}

async function fetchNearbyRawNow(lat, lng, opts = {}) {
  let data;
  let partial = false;
  try {
    data = opts.patient
      ? await overpassFetch(buildOverpassQuery(lat, lng, 55), 65000)
      : await overpassFetch(buildOverpassQuery(lat, lng));
  } catch (err) {
    // Volledige query te zwaar (extreem dicht gebied zoals Londen) of
    // servers overbelast: probeer de lichte variant, zodat er in elk
    // geval íets te tonen valt. partial=true zorgt dat de volledige
    // query op de achtergrond opnieuw geprobeerd blijft worden.
    console.warn('[geo/nearby] volledige query mislukt, probeer lichte variant:', err.message);
    data = opts.patient
      ? await overpassFetch(buildOverpassQuery(lat, lng, 40, true), 50000)
      : await overpassFetch(buildOverpassQuery(lat, lng, 20, true), 25000);
    partial = true;
  }

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
    ...(partial ? { partial: true } : {}),
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

// Bruikbaar = het els-formaat klopt (elke qv ≥ 2 deelt dat formaat).
// Een oude query-versie mist hooguit de nieuwste categorie-soorten en is
// dus prima om DIRECT te tonen — verversen gebeurt op de achtergrond.
// Zo veroorzaakt een versie-bump geen lange wachttijd meer bij de
// eerstvolgende bezoeker.
function usableRaw(cached) {
  return !!(cached && cached.data && Array.isArray(cached.data.els));
}

function currentQv(cached) {
  return !!(cached && cached.data && cached.data.qv === QUERY_VERSION);
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
      if (!cur) { entry = { key: k, name: tags.name, distanceKm: dist, la: plat, lo: plng, t }; byName.set(k, entry); break; }
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
          lat: Math.round(c2.la * 1000) / 1000,
          lng: Math.round(c2.lo * 1000) / 1000,
          website: c2.t.website,
          score: notabilityScore(cdef.key, c2.t),
        }))
        // Dichtbij eerst; bekendheid als tiebreaker. De rommel is al door
        // het filter tegengehouden, dus score-eerst sorteren loste een
        // verdwenen probleem op en verdrong juist échte uitjes om de
        // hoek: in de Randstad duwden vijftien verre zwembaden-met-website
        // het bad op 2 km én Aqua Mundo (score 0) van de lijst.
        .sort((a, b) => (a.distanceKm - b.distanceKm) || (b.score - a.score))
        .slice(0, 20);
      return { key: cdef.key, label: cdef.label, ages: cdef.ages, activity: cdef.activity, pois };
    })
    .filter(cdef => cdef.pois.length);

  // Buurlanden: alle admin-grenzen binnen 30 km behalve het land zelf.
  const neighbours = [...countriesNearby]
    .map(iso => COUNTRIES.find(cn => cn.code === iso))
    .filter(Boolean);

  return { categories, neighbours: neighbours.map(({ code, name, euro, idCard }) => ({ code, name, euro, idCard })) };
}

// ---- Google-sterren (optioneel, vereist GOOGLE_PLACES_API_KEY) ----
//
// Beoordelingen komen uit de Places API en worden per uitje 30 dagen
// gecachet — het maximum dat Googles voorwaarden toestaan, en genoeg om
// binnen het gratis maandtegoed te blijven. Een maandteller (persistent
// in geo_cache) kapt af vóór het tegoed op is; zonder sleutel of boven
// budget verschijnen er simpelweg geen sterren.

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
      if (n === GPLACES_MONTHLY_BUDGET + 1) console.warn('[gplaces] maandbudget bereikt — sterren pauzeren tot volgende maand');
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

// Cachesleutel voor één sterren-opzoeking. v2: het type-filter zit in de
// sleutel, zodat oude type-loze matches (de GGZ-klasse) vanzelf uitspoelen.
function ratingKey(name, lat, lng, gtype) {
  return `grating:v2:${gtype || 'any'}:${name.toLowerCase()}:${lat.toFixed(2)}:${lng.toFixed(2)}`;
}

// Naam-verificatie van de Google-match. Het strikte type-filter voorkomt
// matches op een ander sóórt plek, maar binnen het type springt tekst-
// zoeken nog steeds naar de bekendste naamgenoot: "Museum GGZ Drenthe"
// leverde het Drents Museum op (4,5 ★, 5.446 reviews — andermans sterren).
// Eis: (vrijwel) elke betekenisvolle woord-token uit de OSM-naam komt in
// de Google-naam terug. Extra woorden bij Google mogen ("Aqua Mundo" ⊂
// "Aqua Mundo Center Parcs De Eemhof"); spellingsvarianten tellen via een
// prefix-vergelijking ("Attractiepark" ~ "Attractie- & Vakantiepark").
const NAME_STOPWORDS = new Set(['de', 'het', 'een', 'en', 'van', 'der', 'den', 'ter', 'ten', 't', 's', 'aan', 'bij', 'in', 'op', 'the', 'of']);
// Soortwoorden beschrijven w\u00e1t iets is, niet w\u00e9lke het is. Ze tellen
// niet mee als identiteitswoord: "Speelpark Sprookjeshof" moet matchen
// op "Sprookjeshof Zuidlaren" (identiteit: sprookjeshof \u2713), terwijl
// "Museum GGZ Drenthe" op "Drents Museum" blijft sneuvelen (identiteit
// ggz+drenthe \u2717 \u2014 'museum' als soortwoord redt de match niet meer).
const GENERIC_NAME_TOKENS = new Set([
  'museum', 'openluchtmuseum', 'speelpark', 'speeltuin', 'park', 'pretpark',
  'attractiepark', 'vakantiepark', 'dierentuin', 'dierenpark', 'kinderboerderij',
  'hertenkamp', 'zwembad', 'bosbad', 'buitenbad', 'binnenbad', 'zwemparadijs',
  'strand', 'meer', 'plas', 'recreatieplas', 'natuurgebied', 'wandelgebied',
  'bezoekerscentrum', 'informatiecentrum', 'restaurant', 'eetcafe', 'cafe',
  'cafetaria', 'snackbar', 'bistro', 'brasserie', 'pannenkoekenhuis',
  'ijssalon', 'koffie', 'salon', 'speelboerderij', 'aquarium',
]);
function nameTokens(s) {
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(w => w && !NAME_STOPWORDS.has(w));
}
function namesMatch(poiName, gname) {
  if (!gname) return true; // geen naam meegekregen: niet blokkeren
  const a = nameTokens(poiName);
  const b = nameTokens(gname);
  if (!a.length || !b.length) return true;
  const aj = a.join(' ');
  const bj = b.join(' ');
  if (bj.includes(aj) || aj.includes(bj)) return true;
  // Alleen identiteitswoorden vergelijken; bestaat de naam uitsluitend
  // uit soortwoorden, dan valt er niets te verifi\u00ebren \u2014 dan tellen ze
  // alsnog allemaal mee.
  let sig = a.filter(t => !GENERIC_NAME_TOKENS.has(t));
  if (!sig.length) sig = a;
  const matched = sig.filter(t => b.some(u =>
    t === u || (t.length >= 5 && u.length >= 5 && (t.startsWith(u) || u.startsWith(t))))).length;
  return matched / sig.length >= 0.65;
}

// Zet gecachte/opgehaalde rating-data om naar wat de payload mag tonen:
// een match op de verkeerde plek telt als 'geen beoordeling', waarna het
// minimum-reviews-filter de locatie verbergt. De controle draait bij het
// lézen, dus ook al foutief gecachte matches worden hiermee geneutraliseerd.
function verifiedRating(name, data) {
  if (data && data.rating && !namesMatch(name, data.gname)) {
    console.log(`[gplaces] "${name}" ≠ Google-match "${data.gname}" — sterren genegeerd`);
    return { rating: null };
  }
  return data;
}

async function googleRating(name, lat, lng, gtype) {
  const key = ratingKey(name, lat, lng, gtype);
  const hit = await cacheGetAny(key, TTL_NEARBY);
  if (hit && hit.fresh) return verifiedRating(name, hit.data);
  if (!process.env.GOOGLE_PLACES_API_KEY) return null;
  if (!(await googleBudgetOk())) return null;

  try {
    const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': process.env.GOOGLE_PLACES_API_KEY,
        // FieldMask beperkt tot wat we tonen — bepaalt ook het tarief.
        // displayName valt binnen dezelfde tariefklasse en maakt in de
        // logs zichtbaar wélke plek Google gematcht heeft.
        'X-Goog-FieldMask': 'places.displayName,places.rating,places.userRatingCount',
      },
      body: JSON.stringify({
        textQuery: name,
        // Strikt type-filter waar de categorie dat toelaat: de zoekopdracht
        // "Museum GGZ Drenthe" mag dan alleen nog op een múseum matchen,
        // niet op de gelijknamige zorginstelling met honderden reviews.
        ...(gtype ? { includedType: gtype, strictTypeFiltering: true } : {}),
        locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius: 3000 } },
        maxResultCount: 1,
        languageCode: 'nl',
      }),
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) throw new Error(`Places ${res.status}`);
    const data = await res.json();
    const p = (data.places || [])[0];
    // Ook 'geen match' cachen we 30 dagen: anders blijft een uitje zonder
    // Google-vermelding elke keer opnieuw (betaald) opgezocht worden.
    const gname = p && p.displayName && p.displayName.text;
    const out = (p && p.rating)
      ? { rating: p.rating, count: p.userRatingCount || 0, ...(gname ? { gname } : {}) }
      : { rating: null };
    if (gname && gname.toLowerCase() !== name.toLowerCase()) {
      console.log(`[gplaces] "${name}" → Google-match "${gname}"${gtype ? ` (type ${gtype})` : ''}`);
    }
    // De ruwe uitkomst (mét gname) gaat de cache in; teruggeven doen we
    // de geverifieerde versie — zo blijft de naamregel achteraf bij te
    // stellen zonder nieuwe (betaalde) opzoekingen.
    await cacheSet(key, out);
    return verifiedRating(name, out);
  } catch (err) {
    console.warn('[gplaces]', name, '-', err.message);
    return null;
  }
}

// Verrijkt de payload met sterren — met precies evenveel Google-
// opzoekingen als er getoonde locaties zónder verse cache zijn, en één
// gebundelde database-vraag voor alle cache-hits (i.p.v. één per
// locatie). Draait alleen op het moment dat iemand de pagina echt
// bekijkt; voorladen en achtergrond-verversing doen géén opzoekingen.
async function enrichWithRatings(payload) {
  if (!process.env.GOOGLE_PLACES_API_KEY) return payload;
  const gtypeByCat = Object.fromEntries(POI_CATEGORIES.map(x => [x.key, x.gtype || null]));
  const pois = payload.categories.flatMap(c =>
    c.pois.map(p => ({ p, gtype: gtypeByCat[c.key] || null }))
  ).filter(e => e.p.lat != null && e.p.lng != null);
  if (!pois.length) return payload;

  // Eén query voor alle rating-sleutels tegelijk; primet ook de memCache
  // zodat googleRating() hieronder geen extra leesbeurten doet.
  const wanted = new Map(pois.map(e => [ratingKey(e.p.name, e.p.lat, e.p.lng, e.gtype), e]));
  try {
    const { rows } = await pool.query(
      'SELECT key, data, fetched_at FROM geo_cache WHERE key = ANY($1)',
      [[...wanted.keys()]]
    );
    for (const r of rows) {
      memCache.set(r.key, { at: new Date(r.fetched_at).getTime(), data: r.data });
    }
  } catch (err) {
    console.error('[gplaces] batch-lees mislukt:', err.message);
  }

  const need = [];
  for (const [key, { p, gtype }] of wanted) {
    const hit = memCache.get(key);
    if (hit && Date.now() - hit.at < TTL_NEARBY) {
      p.ratingChecked = true;
      const d = verifiedRating(p.name, hit.data);
      if (d && d.rating) {
        p.rating = d.rating;
        p.ratingCount = d.count || 0;
        // De geverifieerde Google-naam is vaak de officiële ("WILDLANDS
        // Adventure Zoo Emmen") — de frontend toont die en zoekt er op
        // in Maps; p.name blijft de OSM-naam (sleutel voor wegklikken).
        if (d.gname) p.gname = d.gname;
      }
    } else {
      need.push({ p, gtype });
    }
  }

  for (let i = 0; i < need.length; i += 6) {
    await Promise.all(need.slice(i, i + 6).map(async ({ p, gtype }) => {
      const r = await googleRating(p.name, p.lat, p.lng, gtype);
      if (r) {
        p.ratingChecked = true;
        if (r.rating) {
          p.rating = r.rating;
          p.ratingCount = r.count;
          if (r.gname) p.gname = r.gname;
        }
      }
    }));
  }

  // Crowd-validatie als laatste filter: pas serieus vanaf een minimum
  // aantal Google-reviews. Echte uitjes (ook kleine kinderboerderijen en
  // bosbaden) halen dat ruim; een veentje met drie beoordelingen niet
  // (Moordenaarsveen-klasse). Fail-open: kon de opzoeking niet
  // plaatsvinden (budget op, storing), dan blijft de locatie staan.
  for (const cat of payload.categories) {
    cat.pois = cat.pois.filter(p =>
      !p.ratingChecked || (p.rating && (p.ratingCount || 0) >= MIN_REVIEWS));
    for (const p of cat.pois) delete p.ratingChecked;
    // Binnen de categorie: beste Google-score bovenaan; bij gelijke
    // score wint het grootste aantal beoordelingen, daarna afstand.
    // (De afstand-sortering vóór de verrijking bepaalt wélke ~20
    // dichtstbijzijnde locaties meedoen; dit bepaalt hun volgorde.)
    cat.pois.sort((a, b) =>
      (b.rating || 0) - (a.rating || 0)
      || (b.ratingCount || 0) - (a.ratingCount || 0)
      || a.distanceKm - b.distanceKm);
    // Meerdere OSM-objecten kunnen op dezelfde Google-vermelding
    // uitkomen (deel-attracties van Orvelte → 'Monumentendorp Orvelte');
    // toon elke vermelding maar één keer.
    const seenNames = new Set();
    cat.pois = cat.pois.filter(p => {
      const k = String(p.gname || p.name).toLowerCase();
      if (seenNames.has(k)) return false;
      seenNames.add(k);
      return true;
    });
  }
  payload.categories = payload.categories.filter(c => c.pois.length);
  return payload;
}

// Eén ophaal-actie per locatie, hoeveel bezoekers er ook tegelijk wachten:
// gelijktijdige aanvragen delen dezelfde promise in plaats van Overpass
// dubbel te belasten (wat het IP-limiet juist uitlokt).
const rawInFlight = new Map(); // key → Promise<raw>
function fetchNearbyRawShared(lat, lng, opts = {}) {
  const key = nearbyKey(lat, lng);
  const existing = rawInFlight.get(key);
  if (existing) return existing;
  // Afkoelperiode na een mislukking: niet elke 15 s dezelfde kansloze
  // storm van mirrors ontketenen.
  const failedAt = lastFail.get(key);
  if (failedAt && Date.now() - failedAt < FAIL_COOLDOWN_MS) {
    return Promise.reject(new Error('De kaartservers hebben het druk — over een paar minuten proberen we het automatisch opnieuw'));
  }
  const p = fetchNearbyRaw(lat, lng, opts)
    .then(raw => { lastFail.delete(key); return raw; })
    .catch(err => { lastFail.set(key, Date.now()); throw err; })
    .finally(() => rawInFlight.delete(key));
  rawInFlight.set(key, p);
  return p;
}

// Verse fetch op de achtergrond, zonder de aanvrager te laten wachten.
let refreshInFlight = new Set();
function backgroundRefresh(lat, lng) {
  const key = nearbyKey(lat, lng);
  if (refreshInFlight.has(key)) return;
  refreshInFlight.add(key);
  console.log('[geo/cache] cache verouderd — automatische verversing voor', key);
  fetchNearbyRawShared(lat, lng, { patient: true })
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
  // Verlopen, oudere query-versie of een lite-resultaat telt als 'klaar'
  // (we serveren die data direct) en start meteen de verversing.
  if (usable && (!cached.fresh || !currentQv(cached) || cached.data.partial)) backgroundRefresh(c.lat, c.lng);
  res.json({ ready: usable });
});

// Boekbare excursies (boottochten, dagtours, snorkeltrips) staan
// nauwelijks in OSM — het zijn diensten, geen plekken. Google Places
// kent ze wél: één tekst-zoekopdracht per locatie (30 dagen gecachet)
// vult de categorie 'Excursies & boottochten'. Alleen aanbieders met
// een stevige beoordeling komen erdoor; zonder API-sleutel verschijnt
// de categorie simpelweg niet.
async function fetchTours(lat, lng) {
  const key = `gtours:v1:${lat.toFixed(2)}:${lng.toFixed(2)}`;
  const hit = await cacheGetAny(key, TTL_NEARBY);
  if (hit && hit.fresh) return hit.data;
  if (!process.env.GOOGLE_PLACES_API_KEY) return null;
  if (!(await googleBudgetOk())) return null;
  try {
    const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': process.env.GOOGLE_PLACES_API_KEY,
        'X-Goog-FieldMask': 'places.displayName,places.rating,places.userRatingCount,places.location',
      },
      body: JSON.stringify({
        textQuery: 'boottochten, excursies en dagtours',
        locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius: 25000 } },
        maxResultCount: 12,
        languageCode: 'nl',
      }),
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) throw new Error(`Places ${res.status}`);
    const data = await res.json();
    const out = (data.places || [])
      .map(p => ({
        name: (p.displayName && p.displayName.text) || '',
        rating: p.rating || null,
        ratingCount: p.userRatingCount || 0,
        lat: p.location ? Math.round(p.location.latitude * 1000) / 1000 : null,
        lng: p.location ? Math.round(p.location.longitude * 1000) / 1000 : null,
      }))
      .filter(p => p.name && p.lat != null && p.rating && p.rating >= 4 && p.ratingCount >= MIN_REVIEWS)
      .map(p => ({ ...p, distanceKm: Math.round(haversineKm(lat, lng, p.lat, p.lng) * 10) / 10 }))
      // Tekst-zoeken kent geen harde straal; verder dan ~40 km is geen
      // dagje-uit meer vanaf de accommodatie.
      .filter(p => p.distanceKm <= 40)
      .sort((a, b) => b.rating - a.rating || b.ratingCount - a.ratingCount)
      .slice(0, 10);
    await cacheSet(key, out);
    return out;
  } catch (err) {
    console.warn('[gtours]', err.message);
    return null;
  }
}

async function respondNearby(res, lat, lng, raw) {
  const payload = await enrichWithRatings(buildPayload(lat, lng, raw));
  const tours = await fetchTours(lat, lng);
  if (tours && tours.length) {
    payload.categories.push({
      key: 'tours', label: 'Excursies & boottochten',
      ages: 'alle leeftijden', activity: 'daytrip', pois: tours,
    });
  }
  res.json(payload);
}

router.get('/nearby', async (req, res) => {
  const c = parseCoords(req);
  if (!c) return res.status(400).json({ error: 'Ongeldige coördinaten' });
  const refresh = req.query.refresh === '1';

  const cached = await cacheGetAny(nearbyKey(c.lat, c.lng), TTL_NEARBY);
  const usable = usableRaw(cached);

  // Cache mag 30 dagen oud worden. Vers → direct serveren. Verlopen of
  // van een oudere query-versie → óók direct serveren (geen wachttijd
  // voor de gebruiker) en op de achtergrond automatisch verversen.
  // Alleen de Vernieuwen-knop (refresh=1) wacht op verse data.
  if (!refresh && usable) {
    if (!cached.fresh || !currentQv(cached) || cached.data.partial) backgroundRefresh(c.lat, c.lng);
    return respondNearby(res, c.lat, c.lng, cached.data);
  }

  try {
    const raw = await fetchNearbyRawShared(c.lat, c.lng);
    await respondNearby(res, c.lat, c.lng, raw);
  } catch (err) {
    console.error('[geo/nearby]', err.message);
    // Verouderde data is beter dan een foutmelding.
    if (usable) return respondNearby(res, c.lat, c.lng, cached.data);
    res.status(502).json({ error: 'Omgevingsinformatie is tijdelijk niet beschikbaar — probeer het later opnieuw' });
  }
});

// Fire-and-forget: omgevingsdata alvast ophalen zodra een checklist een
// kaartlocatie krijgt — dan is de Omgeving-pagina daarna meteen snel.
function prefetchNearby(lat, lng, attempt = 1) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
  cacheGetAny(nearbyKey(lat, lng), TTL_NEARBY)
    .then(hit => {
      if (usableRaw(hit) && hit.fresh) return null;
      console.log(`[geo/prefetch] omgeving voorladen voor ${lat.toFixed(2)} ${lng.toFixed(2)}${attempt > 1 ? ` (poging ${attempt})` : ''}`);
      // Alleen de ruwe omgevingsdata voorladen. Google-opzoekingen doen
      // we uitsluitend voor pagina's die iemand écht bekijkt.
      return fetchNearbyRawShared(lat, lng, { patient: true });
    })
    .catch(err => {
      // Overpass heeft drukke momenten; op de achtergrond proberen we
      // het gewoon nog eens — tegen de tijd dat iemand op Omgeving
      // drukt staat de data er dan meestal alsnog.
      if (attempt < 3) {
        console.warn(`[geo/prefetch] mislukt, nieuwe poging over 3 min (${attempt}/3):`, err.message);
        setTimeout(() => prefetchNearby(lat, lng, attempt + 1), 3 * 60 * 1000);
      } else {
        console.warn('[geo/prefetch] definitief mislukt — wordt opnieuw geprobeerd zodra iemand de Omgeving-pagina opent:', err.message);
      }
    });
}

// Diagnose: zoek op naam rond een punt en laat per gevonden OSM-object
// zien waarom het wel/niet in het omgevingsadvies belandt. Voor het
// onderzoeken van 'ik mis plek X'-meldingen zonder te gissen naar tags.
router.get('/debug', async (req, res) => {
  const c = parseCoords(req);
  const q = String(req.query.q || '').trim().slice(0, 60);
  const tag = String(req.query.tag || '').trim().slice(0, 60);
  if (!c || (q.length < 2 && !tag)) {
    return res.status(400).json({ error: 'lat, lng en q (naam) of tag (bv. leisure=water_park) zijn verplicht' });
  }

  // Tag-modus: alle objecten met deze tag in de buurt, óók zonder naam.
  // Tag-zoekopdrachten zijn bij Overpass geïndexeerd en dus snel —
  // anders dan naam-regexes.
  if (tag) {
    const m = tag.match(/^([a-z_:]+)(?:=([\w -]+))?$/i);
    if (!m) return res.status(400).json({ error: 'Ongeldige tag; gebruik key of key=value' });
    const selector = m[2] ? `["${m[1]}"="${m[2]}"]` : `["${m[1]}"]`;
    try {
      const data = await overpassFetch(`[out:json][timeout:15][bbox:${bboxFor(c.lat, c.lng, 25)}];
nwr${selector};
out center tags 50;`);
      const results = (data.elements || []).map(el => {
        const tags = el.tags || {};
        const la = el.lat ?? (el.center && el.center.lat) ?? null;
        const lo = el.lon ?? (el.center && el.center.lon) ?? null;
        const cat = classify({ tags });
        const t = liteTags(tags);
        const name = tags.name || '(zonder naam)';
        return {
          name,
          osm: `${el.type}/${el.id}`,
          distanceKm: la != null ? Math.round(haversineKm(c.lat, c.lng, la, lo) * 10) / 10 : null,
          category: cat,
          verdict: cat && tags.name ? {
            valid: isValidNearbyPoi(cat, tags.name, t),
            lodging: isLodging(cat, tags.name, t),
            score: notabilityScore(cat, t),
            minRequired: cat === 'waterpark' ? 0 : (MIN_SCORE[cat] ?? 0),
          } : { valid: false, reden: tags.name ? 'geen categorie' : 'geen naam — onzichtbaar voor de app' },
          tags,
        };
      }).sort((a, b) => (a.distanceKm ?? 99) - (b.distanceKm ?? 99));
      return res.json({ source: 'debug-v2-tag', tag, around: c, count: results.length, results });
    } catch (err) {
      return res.status(502).json({ error: `Diagnose mislukt: ${err.message}` });
    }
  }

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
          genericName: hasGenericName(cat, name, t),
          score: cat ? notabilityScore(cat, t) : null,
          minRequired: cat ? (cat === 'waterpark' ? 0 : (MIN_SCORE[cat] ?? 0)) : null,
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
