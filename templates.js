// Genereert een lijst inpak-items op basis van de checklist-inputs.
// Alle items hebben een tekst, categorie en positie. De gebruiker kan ze
// achteraf gewoon aanpassen, verwijderen of nieuwe toevoegen.

const NL_LIKE = ['nederland', 'netherlands', 'nl', 'belgium', 'belgië', 'belgie', 'be'];
const EU_EURO_LIKE = [
  'duitsland', 'germany', 'frankrijk', 'france', 'spanje', 'spain', 'italië', 'italie', 'italy',
  'oostenrijk', 'austria', 'portugal', 'griekenland', 'greece', 'ierland', 'ireland',
  'finland', 'estland', 'estonia', 'letland', 'latvia', 'litouwen', 'lithuania',
  'luxemburg', 'luxembourg', 'malta', 'cyprus', 'slowakije', 'slovakia', 'slovenië', 'slovenie', 'slovenia',
  'kroatië', 'kroatie', 'croatia',
];

function normCountry(s) {
  return String(s || '').trim().toLowerCase();
}

function isHomeCountry(dest) {
  return NL_LIKE.includes(normCountry(dest));
}

function usesEuro(dest) {
  const c = normCountry(dest);
  return NL_LIKE.includes(c) || EU_EURO_LIKE.includes(c);
}

function daysBetween(start, end) {
  if (!start || !end) return 7;
  const a = new Date(start);
  const b = new Date(end);
  if (isNaN(a) || isNaN(b)) return 7;
  return Math.max(1, Math.round((b - a) / 86400000) + 1);
}

// Suggesties voor hoeveelheid kleding per persoon, op basis van duur.
// Houdt er rekening mee dat je op de vertrekdag al iets aan hebt.
function defaultQuantities(days) {
  return {
    underwear: Math.max(1, Math.min(days, 14)),
    socks: Math.max(1, Math.min(days, 14)),
    tops: Math.max(1, Math.min(Math.ceil(days / 1.5) - 1, 14)),
    bottoms: Math.max(1, Math.min(Math.ceil(days / 3) - 1, 7)),
  };
}

function travelerLabel(t, idx, total) {
  const name = t && t.name ? String(t.name).trim() : '';
  if (name) return ` (${name})`;
  if (total > 1) return ` (reiziger ${idx + 1})`;
  return '';
}

function generateItems({
  destination,
  startDate,
  endDate,
  travelers = [],
  transport,
  weather = [],
  accommodation,
  activities = [],
  medications = [],
  quantities = {},
}) {
  const items = [];
  const add = (text, category) => items.push({ text, category });

  const days = daysBetween(startDate, endDate);
  const home = isHomeCountry(destination);
  const euro = usesEuro(destination);
  const hasBaby = travelers.some(t => t.age != null && t.age < 2);
  const hasToddler = travelers.some(t => t.age != null && t.age >= 2 && t.age < 5);
  const hasChild = travelers.some(t => t.age != null && t.age >= 5 && t.age < 13);
  const hasSenior = travelers.some(t => t.age != null && t.age >= 65);

  const w = new Set(Array.isArray(weather) ? weather : []);
  const has = (...ks) => ks.some(k => w.has(k));
  const acts = new Set(Array.isArray(activities) ? activities : []);
  const doesAct = (...ks) => ks.some(k => acts.has(k));

  const defaults = defaultQuantities(days);
  const q = {
    underwear: quantities.underwear != null ? Number(quantities.underwear) : defaults.underwear,
    socks: quantities.socks != null ? Number(quantities.socks) : defaults.socks,
    tops: quantities.tops != null ? Number(quantities.tops) : defaults.tops,
    bottoms: quantities.bottoms != null ? Number(quantities.bottoms) : defaults.bottoms,
  };

  // ===== Documenten =====
  add(home ? 'ID-kaart' : 'Paspoort (geldig)', 'Documenten');
  if (!home && !euro) add('Visum / ESTA controleren voor dit land', 'Documenten');
  add('Digitale kopie paspoort / ID (in e-mail of cloud)', 'Documenten');
  add('Reisverzekering / polisnummer', 'Documenten');
  if (!home) add('Europees ziekteverzekeringsbewijs (EHIC)', 'Documenten');
  if (transport === 'plane') add('Vliegtickets / boarding pass', 'Documenten');
  if (transport === 'car') {
    add('Rijbewijs', 'Documenten');
    add('Auto-papieren (kentekenbewijs, groene kaart)', 'Documenten');
  }
  if (accommodation) add('Reservering accommodatie (bevestigingsmail / adres)', 'Documenten');

  // ===== Geld =====
  add('Pinpas', 'Geld');
  add('Creditcard', 'Geld');
  add('Reservekaart of noodcontant (apart bewaren)', 'Geld');
  if (!euro && !home) add(`Vreemde valuta / contant geld voor ${destination || 'bestemming'}`, 'Geld');

  // ===== Elektronica =====
  add('Telefoon', 'Elektronica');
  add('Telefoonoplader', 'Elektronica');
  add('Powerbank', 'Elektronica');
  if (!home && !euro) add('Stekkeradapter (controleer type voor land)', 'Elektronica');
  if (days >= 4) add('Koptelefoon / oortjes', 'Elektronica');

  // ===== Per reiziger: kleding (hoeveelheden) =====
  travelers.forEach((t, i) => {
    const label = travelerLabel(t, i, travelers.length);
    if (q.underwear > 0) add(`Ondergoed × ${q.underwear}${label}`, 'Kleding');
    if (q.socks > 0) add(`Sokken × ${q.socks}${label}`, 'Kleding');
    if (q.tops > 0) add(`T-shirts / bovenstukken × ${q.tops}${label}`, 'Kleding');
    if (q.bottoms > 0) add(`Broeken / rokken × ${q.bottoms}${label}`, 'Kleding');
    add(`Pyjama${label}`, 'Kleding');
    add(`Comfortabele schoenen${label}`, 'Kleding');
  });

  // ===== Weer (multi-select op temperatuur en condities) =====
  if (has('hot')) {
    add('Korte broeken', 'Kleding');
    add('Zomerjurk / dunne zomertops', 'Kleding');
    if (!doesAct('beach', 'swimming', 'watersport', 'pool')) add('Slippers / sandalen', 'Kleding');
    add('Lichte jas of vest voor airco / koelere avond', 'Kleding');
  }
  if (has('warm')) {
    add('T-shirts (extra)', 'Kleding');
    add('Lichte lange broek', 'Kleding');
    add('Vest voor de avond', 'Kleding');
    add('Lichte jas (avond / airco)', 'Kleding');
  }
  if (has('mild')) {
    add('Trui of dikker vest', 'Kleding');
    add('Lange broek', 'Kleding');
    add('Lichte jas', 'Kleding');
  }
  if (has('cool')) {
    add('Warme trui', 'Kleding');
    add('Tussenjas', 'Kleding');
    add('Lange broek', 'Kleding');
    add('Dikkere sokken', 'Kleding');
  }
  if (has('cold')) {
    add('Warme winterjas', 'Kleding');
    add('Dikke trui', 'Kleding');
    add('Muts', 'Kleding');
    add('Sjaal', 'Kleding');
    add('Handschoenen', 'Kleding');
  }
  if (has('freezing')) {
    add('Thermo-ondergoed', 'Kleding');
    add('Dikke winterjas', 'Kleding');
    add('Gevoerde handschoenen', 'Kleding');
    add('Warme muts', 'Kleding');
    add('Dikke wollen sokken', 'Kleding');
    add('Lipbalsem', 'Verzorging');
  }
  if (has('sunny', 'hot')) {
    add('Zonnebrand (SPF 30+)', 'Verzorging');
    add('Zonnebrandlip (lippenstift met SPF)', 'Verzorging');
    add('Zonnebril', 'Kleding');
    add('Hoed / pet', 'Kleding');
  }
  if (has('hot')) {
    add('Aftersun', 'Verzorging');
  }
  if (!home && (has('hot', 'warm') || accommodation === 'camping')) {
    add('Insectenwerend middel / DEET', 'Verzorging');
  }
  if (has('rainy')) {
    add('Regenjas', 'Kleding');
    add('Paraplu', 'Kleding');
    add('Waterdichte schoenen', 'Kleding');
  }
  if (has('snow')) {
    add('Waterdichte / warme schoenen', 'Kleding');
    add('Sneeuwlaarzen', 'Kleding');
  }

  // ===== Accommodatie =====
  if (accommodation === 'camping') {
    add('Tent', 'Accommodatie');
    add('Slaapzak', 'Accommodatie');
    add('Slaapmat / luchtbed', 'Accommodatie');
    add('Hoofdlamp / zaklamp', 'Accommodatie');
    add('Kookspullen / brander', 'Accommodatie');
    add('Servies en bestek', 'Accommodatie');
    add('Handdoeken', 'Accommodatie');
    add('Muggenspray', 'Verzorging');
  }
  if (accommodation === 'house') {
    add('Handdoeken (check of inbegrepen)', 'Accommodatie');
    add('Vaatwastabletten / afwasmiddel', 'Accommodatie');
    add('WC-papier (eerste avond)', 'Accommodatie');
    add('Vuilniszakken', 'Accommodatie');
  }
  if (accommodation === 'hostel') {
    add('Eigen handdoek', 'Accommodatie');
    add('Slippers voor de douche', 'Accommodatie');
    add('Hangslot voor locker', 'Accommodatie');
    add('Oordoppen', 'Accommodatie');
  }
  if (accommodation === 'family') {
    add('Cadeautje voor de gastheer/-vrouw', 'Accommodatie');
  }

  // ===== Activiteiten =====
  if (doesAct('beach')) {
    add('Strandhanddoek', 'Activiteiten');
    add('Strandtas', 'Activiteiten');
    add('Waterschoenen', 'Activiteiten');
  }
  if (days >= 3) add('Boek / e-reader voor onderweg', 'Overig');
  if (doesAct('swimming', 'beach', 'watersport', 'pool')) {
    add('Zwemkleding', 'Activiteiten');
    add('Slippers / badslippers', 'Activiteiten');
  }
  if (doesAct('pool', 'swimming', 'watersport')) {
    add('Zwembril', 'Activiteiten');
  }
  if (doesAct('watersport')) {
    add('Snorkelset', 'Activiteiten');
    add('Rashguard / UV-shirt', 'Activiteiten');
  }
  if (doesAct('hiking')) {
    add('Wandelschoenen', 'Activiteiten');
    add('Dagrugzak', 'Activiteiten');
    add('Bidon / waterfles', 'Activiteiten');
    add('Wandelsokken', 'Activiteiten');
    add('Pleisters voor blaren', 'Verzorging');
  }
  if (doesAct('skiing')) {
    add('Ski-/snowboardjas en -broek', 'Activiteiten');
    add('Skihandschoenen', 'Activiteiten');
    add('Skibril', 'Activiteiten');
    add('Helm', 'Activiteiten');
    add('Skipas / huurbevestiging', 'Activiteiten');
  }
  if (doesAct('cycling')) {
    add('Fietshelm', 'Activiteiten');
    add('Comfortabele kleding voor fietsen', 'Activiteiten');
    add('Bidon / waterfles', 'Activiteiten');
  }
  if (doesAct('themepark')) {
    add('Comfortabele wandelschoenen', 'Activiteiten');
    add('Kleingeld voor kluisjes', 'Activiteiten');
    add('Dunne regenponcho (waterattracties)', 'Activiteiten');
    add('Snacks en tussendoortjes', 'Activiteiten');
    add('Reservekleding (voor waterattracties)', 'Activiteiten');
    add('Dagrugzak', 'Activiteiten');
  }
  if (doesAct('citytrip', 'cultural')) {
    add('Comfortabele wandelschoenen', 'Activiteiten');
    add('Reisgids / opgeslagen tickets', 'Activiteiten');
    add('Openbaarvervoer-app / kaart', 'Activiteiten');
    add('Kleine schoudertas / heuptas', 'Activiteiten');
  }
  if (doesAct('daytrip')) {
    add('Dagrugzak', 'Activiteiten');
    add('Bidon / waterfles', 'Activiteiten');
    add('Snacks en tussendoortjes', 'Activiteiten');
    add('Geplande tickets / reserveringen meenemen', 'Activiteiten');
  }
  if (doesAct('nightlife')) {
    add('Nette kleding voor uitgaan', 'Activiteiten');
    add('Nette schoenen', 'Activiteiten');
  }

  // ===== Verzorging =====
  const nPpl = Math.max(1, travelers.length);
  const x = nPpl > 1 ? ` × ${nPpl}` : '';
  add(`Tandenborstel + tandpasta${x}`, 'Verzorging');
  add('Shampoo / douchegel', 'Verzorging');
  add('Conditioner', 'Verzorging');
  add(`Deodorant${x}`, 'Verzorging');
  add('Scheerspullen / scheermesje', 'Verzorging');
  add('Haarborstel / kam', 'Verzorging');
  add('Vochtige doekjes', 'Verzorging');
  if (!home) add('Diarreemiddel / maagtablet (lopende maag)', 'Verzorging');
  const meds = (medications || []).map(m => String(m || '').trim()).filter(Boolean);
  if (meds.length) {
    for (const m of meds) add(`Medicijn: ${m}`, 'Verzorging');
  } else {
    add('Persoonlijke medicijnen', 'Verzorging');
  }
  add('EHBO / pleisters / paracetamol', 'Verzorging');
  if (days >= 7) add('Nagelknipper', 'Verzorging');
  if (hasSenior) add('Extra medicatie + recepten', 'Verzorging');

  // ===== Baby / kinderen =====
  if (hasBaby) {
    add('Luiers (ruim genoeg)', 'Baby & kids');
    add('Babydoekjes', 'Baby & kids');
    add('Flesvoeding / fles + speen', 'Baby & kids');
    add('Knuffel / inbakerdoek', 'Baby & kids');
    add('Reisbedje / wieg', 'Baby & kids');
    add('Babyfoon', 'Baby & kids');
    add('Buggy / draagzak', 'Baby & kids');
    add('Zonnehoedje baby', 'Baby & kids');
    if (doesAct('beach', 'pool', 'swimming', 'watersport')) add('Zwemluier', 'Baby & kids');
  }
  if (hasToddler) {
    add('Reservekleding (extra setjes)', 'Baby & kids');
    add('Speelgoed / boekjes', 'Baby & kids');
    add('Tussendoortjes', 'Baby & kids');
    add('Potje of reispotje', 'Baby & kids');
  }
  if (hasChild) {
    add('Knuffel / favoriet speelgoed', 'Baby & kids');
    add('Speelgoed voor op de bestemming', 'Baby & kids');
    add('Kleurboek + kleurpotloden', 'Baby & kids');
    add('Tablet + opladers (downloaded films)', 'Baby & kids');
    if (transport === 'car' || transport === 'train') add('Spelletjes / boekjes voor onderweg', 'Baby & kids');
    if (doesAct('themepark')) add('Polsbandje met telefoonnummer (attractiepark)', 'Baby & kids');
  }
  if (hasToddler && (transport === 'car' || transport === 'train')) {
    add('Auto- / treinspelletjes voor onderweg', 'Baby & kids');
  }

  // ===== Transport =====
  if (transport === 'plane') {
    add('Online check-in gedaan', 'Transport');
    add('Handbagage onder limiet checken', 'Transport');
    add('Vloeistoffen <100ml in transparant zakje', 'Transport');
    add('Powerbank in handbagage (niet in ruim!)', 'Transport');
    add('Nekkussen + oogmasker + oordoppen', 'Transport');
    add('Vest of trui voor in cabine', 'Transport');
    if (hasBaby || hasToddler) add('Snoepje of fles voor opstijgen/landen (oren)', 'Transport');
    // Vliegtuig = beperkt: dingen die je niet meeneemt maar ter plekke huurt
    if (accommodation === 'camping') {
      add('Tent/uitrusting ter plekke huren of opsturen', 'Transport');
    }
    if (doesAct('cycling')) add('Fietsen ter plekke huren', 'Transport');
    if (doesAct('skiing')) add('Ski-uitrusting ter plekke huren', 'Transport');
  }
  if (transport === 'car') {
    add('Snacks en water voor onderweg', 'Transport');
    add('Auto-oplader / USB-kabel', 'Transport');
    add('Navigatie / kaarten / offline route', 'Transport');
    add('Veiligheidshesje en gevarendriehoek', 'Transport');
    if (!home) add('Vignet / tol controleren voor dit land', 'Transport');
    if (hasBaby || hasToddler || hasChild) add('Kinderzitje/autostoel controleren', 'Transport');
    // Auto = je kunt veel meenemen
    if (accommodation === 'camping' || accommodation === 'house') {
      add('Koelbox + koelelementen', 'Transport');
    }
    if (accommodation === 'camping') {
      add('Campingstoelen', 'Accommodatie');
      add('Campingtafel of klaptafel', 'Accommodatie');
      add('BBQ / gasbrander + gas', 'Accommodatie');
      add('Buitenverlichting / lantaarn', 'Accommodatie');
    }
    if (doesAct('cycling')) add('Fietsen + fietsenrek (of huren ter plekke)', 'Transport');
    if (doesAct('skiing') && (has('cold','freezing','snow'))) add('Sneeuwkettingen voor de auto', 'Transport');
    if (has('snow', 'freezing')) add('IJskrabber + ruitenontdooier', 'Transport');
  }
  if (transport === 'train') {
    add('Treintickets / e-tickets', 'Transport');
    add('Snacks en water', 'Transport');
    add('Boek / podcast voor onderweg', 'Transport');
    if (days >= 4) add('Nekkussen voor de trein', 'Transport');
  }

  // ===== Elektronica extra =====
  if (days >= 3) add('Camera + oplader / extra geheugenkaart', 'Elektronica');
  add('Multistekker (hotels hebben vaak weinig contacten)', 'Elektronica');
  if (doesAct('beach', 'watersport', 'swimming', 'pool')) add('Waterdichte hoes / zakje voor telefoon', 'Elektronica');

  // ===== Overig =====
  add('Sleutels van huis (vergeet ze niet!)', 'Overig');
  add('Reisslot voor koffer / tas', 'Overig');
  add('Boodschappentas / opvouwbare tas', 'Overig');
  add('Plastic zakjes voor vuil wasgoed', 'Overig');
  if (days >= 7) add('Wasmiddel / wasstrips (voor langere reis)', 'Overig');

  // ===== Voor vertrek =====
  if (days >= 2) {
    add('Deuren, ramen en terrasdeuren op slot', 'Voor vertrek');
    add('Verwarming laag / airco uit', 'Voor vertrek');
    add('Post / pakketbezorging pauzeren of buren inlichten', 'Voor vertrek');
    add('Planten water geven', 'Voor vertrek');
    if (days >= 3) add('Kraan en gas controleren', 'Voor vertrek');
  }

  // Verwijder duplicaten op tekst
  const seen = new Set();
  const dedup = [];
  for (const it of items) {
    const k = it.text.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    dedup.push(it);
  }
  return dedup.map((it, i) => ({ ...it, position: i }));
}

module.exports = { generateItems, defaultQuantities };
