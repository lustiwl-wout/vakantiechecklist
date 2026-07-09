// Genereert een inpaklijst op basis van de checklist-inputs.
//
// Item-klassen:
//  - gedeeld:        één item (bv. tandpasta, EHBO-set)
//  - geteld (×N):    identieke, telbare dingen die bij elkaar zitten
//                    (documenten, handdoeken) — quantity = aantal
//  - per reiziger:   draagbare/persoonlijke spullen — apart item met
//                    traveler-veld, want maten verschillen en ieder pakt
//                    het zijne in via de reiziger-tabs
//
// Leeftijdsgroepen: baby <2, peuter 2–4, kind 5–12, tiener 13–17,
// volwassene 18+ (onbekende leeftijd telt als volwassene), senior 65+.

const { getCountry } = require('./countries');

function daysBetween(start, end) {
  if (!start || !end) return 7;
  const a = new Date(start);
  const b = new Date(end);
  if (isNaN(a) || isNaN(b)) return 7;
  return Math.max(1, Math.round((b - a) / 86400000) + 1);
}

// Suggesties voor hoeveelheid kleding per persoon, op basis van duur.
// Vuile-was-items (ondergoed, sokken, t-shirts) krijgen +1 reserve.
function defaultQuantities(days) {
  return {
    underwear: Math.max(2, Math.min(days + 1, 15)),
    socks: Math.max(2, Math.min(days + 1, 15)),
    tshirts: Math.max(2, Math.min(days + 1, 15)),
    sweaters: Math.max(1, Math.min(Math.ceil(days / 4), 4)),
    bottoms: Math.max(1, Math.min(Math.ceil(days / 3) - 1, 7)),
  };
}

function travelerName(t, idx, total) {
  const name = t && t.name ? String(t.name).trim() : '';
  if (name) return name;
  if (total > 1) return `Reiziger ${idx + 1}`;
  return null;
}

// Representatieve leeftijd per categorie — de generator werkt intern
// met leeftijden, maar naar buiten toe volstaan categorieën.
const CATEGORY_AGE = {
  baby: 1, peuter: 3, kind: 8, tiener: 15, volwassene: 35, senior: 70,
};

// Leeftijd van een reiziger op de vertrekdatum. Bronnen (in volgorde):
// geboortedatum (gezinslid), leeftijdscategorie (medereiziger), of een
// los leeftijd-getal (oudere checklists). Onbekend = volwassene.
function resolveAge(t, startDate) {
  if (t && t.birthdate) {
    const b = new Date(t.birthdate);
    const ref = startDate ? new Date(startDate) : new Date();
    if (!isNaN(b) && !isNaN(ref)) {
      let a = ref.getFullYear() - b.getFullYear();
      const m = ref.getMonth() - b.getMonth();
      if (m < 0 || (m === 0 && ref.getDate() < b.getDate())) a--;
      return Math.max(0, a);
    }
  }
  if (t && t.category && CATEGORY_AGE[t.category] != null) return CATEGORY_AGE[t.category];
  if (t && t.age != null) return Number(t.age);
  return 30;
}

const PLUG_HINT = {
  uk: 'type G (VK/Ierland/Malta)',
  us: 'type A/B (VS-stijl)',
  au: 'type I (Australië/China)',
  ch: 'type J (Zwitserland)',
  it: 'type L (Italië)',
  za: 'type M (Zuid-Afrika)',
  in: 'type D (India)',
  unknown: 'controleer het type voor je bestemming',
};

function generateItems({
  destination,
  country,
  startDate,
  endDate,
  travelers = [],
  transport,
  weather = [],
  accommodation,
  activities = [],
  medications = [],
  quantities = {},
  rentalCar = false,
  borderCountries = [],
}) {
  const items = [];
  const add = (text, category, quantity = 1, traveler = null) => {
    items.push({ text, category, quantity: Math.min(quantity, 99), traveler });
  };

  const days = daysBetween(startDate, endDate);
  const land = getCountry(country);
  const home = !!(land && land.home);

  // Normaliseer: elke reiziger krijgt een leeftijd op de vertrekdatum,
  // afgeleid van geboortedatum, categorie of los leeftijd-getal.
  travelers = travelers.map(t => ({ ...t, age: resolveAge(t, startDate) }));
  const age = t => (t && t.age != null ? t.age : 30);
  const isBaby = t => age(t) < 2;
  const isToddler = t => age(t) >= 2 && age(t) < 5;
  const isChild = t => age(t) >= 5 && age(t) < 13;
  const isTeen = t => age(t) >= 13 && age(t) < 18;
  const isAdult = t => age(t) >= 18;
  const isSenior = t => age(t) >= 65;

  const nPpl = Math.max(1, travelers.length);
  const nAdults = Math.max(1, travelers.filter(isAdult).length);
  const nTeensPlus = Math.max(1, travelers.filter(t => age(t) >= 13).length);
  const nFivePlus = Math.max(1, travelers.filter(t => age(t) >= 5).length);
  const nBabies = travelers.filter(isBaby).length;
  const nDiaperKids = travelers.filter(t => age(t) < 3).length; // luierleeftijd
  const hasBaby = nBabies > 0;
  const hasDiaperKid = nDiaperKids > 0;
  const hasToddler = travelers.some(isToddler);
  const hasChild = travelers.some(isChild);
  const hasYoungKids = hasBaby || hasToddler || hasChild;
  const hasMinor = travelers.some(t => age(t) < 18);
  const hasBuggyKid = travelers.some(t => age(t) < 5);
  const hasSenior = travelers.some(isSenior);

  const w = new Set(Array.isArray(weather) ? weather : []);
  const has = (...ks) => ks.some(k => w.has(k));
  const acts = new Set(Array.isArray(activities) ? activities : []);
  const doesAct = (...ks) => ks.some(k => acts.has(k));
  const waterFun = doesAct('beach', 'pool', 'swimming', 'watersport');
  const isDriving = transport === 'car' || rentalCar === true;

  const defaults = defaultQuantities(days);
  const q = {};
  for (const k of ['underwear', 'socks', 'tshirts', 'sweaters', 'bottoms']) {
    q[k] = quantities[k] != null ? Number(quantities[k]) : defaults[k];
  }

  // Loop-helper: roept fn aan per reiziger met naam-label.
  const eachTraveler = (fn) => travelers.forEach((t, i) => {
    const trav = travelerName(t, i, travelers.length);
    const label = trav ? ` (${trav})` : '';
    fn(t, trav, label);
  });

  // ===== Documenten =====
  if (home) {
    add('ID-kaart', 'Documenten', nPpl);
  } else if (land && land.idCard) {
    add('ID-kaart of paspoort (geldig)', 'Documenten', nPpl);
  } else if (land) {
    add('Paspoort (check geldigheidsduur)', 'Documenten', nPpl);
  } else {
    add('Paspoort of ID-kaart (check wat vereist is)', 'Documenten', nPpl);
  }
  add('Digitale kopie paspoort / ID (in e-mail of cloud)', 'Documenten');
  add('Reisverzekering / polisnummer', 'Documenten');
  if (land && land.ehic && !home) add('Europese zorgpas (EHIC)', 'Documenten', nPpl);
  if (transport === 'plane') add('Vliegtickets / boarding passes', 'Documenten', nPpl);
  if (transport === 'train') add('Treintickets / e-tickets', 'Documenten', nPpl);
  if (transport === 'car' || rentalCar) add('Rijbewijs', 'Documenten', nAdults);
  if (transport === 'car') add('Auto-papieren (kentekenbewijs, groene kaart)', 'Documenten');
  if (accommodation) add('Reservering accommodatie (bevestigingsmail / adres)', 'Documenten');
  add('Noodcontactenlijst (op papier)', 'Documenten');
  if (hasMinor && !home) add('Toestemmingsverklaring reizen met kind (indien zonder beide ouders)', 'Documenten');

  // ===== Geld =====
  add('Pinpas', 'Geld', nAdults);
  add('Creditcard', 'Geld');
  add('Reservekaart of noodcontant (apart bewaren)', 'Geld');
  if (land && !land.euro && !home) add('Contant geld / valuta wisselen', 'Geld');

  // ===== Elektronica =====
  eachTraveler((t, trav, label) => {
    if (age(t) >= 8) add(`Telefoon + oplader${label}`, 'Elektronica', 1, trav);
  });
  add('Powerbank', 'Elektronica');
  if (land && land.plug !== 'eu' && !home) {
    add(`Reisstekker / wereldstekker — ${PLUG_HINT[land.plug] || PLUG_HINT.unknown}`, 'Elektronica');
  }
  if (!land && !home) add('Reisstekker / wereldstekker (controleer het type)', 'Elektronica');
  add('Multistekker (hotels hebben vaak weinig contacten)', 'Elektronica');
  if (days >= 4) add('Koptelefoon / oortjes', 'Elektronica', nFivePlus);
  add('Camera + oplader / extra geheugenkaart', 'Elektronica');
  add('Reserve-oplaadkabel', 'Elektronica');
  if (waterFun) add('Waterdichte hoes / zakje voor telefoon', 'Elektronica');

  // Bij puur warm weer pak je vooral korte broeken; halveer de lange
  // broeken (tenzij de gebruiker het aantal zelf heeft ingesteld).
  const hotOnly = has('hot') && !has('mild', 'cool', 'cold', 'freezing');
  const effBottoms = (quantities.bottoms == null && hotOnly)
    ? Math.max(1, Math.ceil(q.bottoms / 2)) : q.bottoms;
  const qShorts = has('hot') ? Math.max(2, Math.min(Math.ceil(days / 3), 7)) : 1;

  // ===== Kleding: hoeveelheden per reiziger =====
  eachTraveler((t, trav, label) => {
    if (isBaby(t)) {
      // Baby's dragen rompertjes — geen ondergoed, schoenen of pyjama.
      add(`Rompertjes${label}`, 'Kleding', Math.min(days + 2, 15), trav);
      add(`Setjes babykleding${label}`, 'Kleding', Math.min(Math.ceil(days / 1.5) + 1, 12), trav);
      add(`Sokjes / slofjes${label}`, 'Kleding', 4, trav);
      add(`Hydrofiele doeken${label}`, 'Kleding', 6, trav);
      return;
    }
    if (q.underwear > 0) add(`Ondergoed${label}`, 'Kleding', q.underwear, trav);
    if (q.socks > 0) add(`Sokken${label}`, 'Kleding', q.socks, trav);
    if (q.tshirts > 0) add(`T-shirts${label}`, 'Kleding', q.tshirts, trav);
    if (q.sweaters > 0) add(`Trui / vest${label}`, 'Kleding', q.sweaters, trav);
    if (effBottoms > 0) add(`Broeken / rokken${label}`, 'Kleding', effBottoms, trav);
    add(`Pyjama${label}`, 'Kleding', 1, trav);
    add(`Comfortabele schoenen${label}`, 'Kleding', 1, trav);
    if (age(t) >= 5) add(`Riem / ceintuur${label}`, 'Kleding', 1, trav);
  });

  // ===== Kleding: weer, per reiziger =====
  eachTraveler((t, trav, label) => {
    if (isBaby(t)) {
      // Voor baby's dekken de setjes het meeste; alleen extremen apart.
      if (has('cold', 'freezing')) add(`Warm babypak / skipakje${label}`, 'Kleding', 1, trav);
      return;
    }
    if (has('hot', 'warm')) {
      add(`Korte broeken${label}`, 'Kleding', qShorts, trav);
      if (has('hot') && !waterFun) add(`Slippers / sandalen${label}`, 'Kleding', 1, trav);
    }
    // Eén jas per reiziger, passend bij het koudste aangevinkte weer.
    if (has('cold', 'freezing')) {
      add(`${has('freezing') ? 'Dikke winterjas' : 'Warme winterjas'}${label}`, 'Kleding', 1, trav);
      add(`Muts${label}`, 'Kleding', 1, trav);
      add(`Sjaal${label}`, 'Kleding', 1, trav);
      add(`${has('freezing') ? 'Gevoerde handschoenen' : 'Handschoenen'}${label}`, 'Kleding', 1, trav);
    } else if (has('cool')) {
      add(`Tussenjas${label}`, 'Kleding', 1, trav);
    } else if (has('mild')) {
      add(`Lichte jas${label}`, 'Kleding', 1, trav);
    } else if (has('hot', 'warm')) {
      add(`Lichte jas of vest (airco / avond)${label}`, 'Kleding', 1, trav);
    }
    if (has('freezing')) {
      add(`Thermo-ondergoed${label}`, 'Kleding', 1, trav);
      add(`Dikke wollen sokken${label}`, 'Kleding', 2, trav);
    }
    if (has('sunny', 'hot')) {
      add(`Zonnebril${label}`, 'Kleding', 1, trav);
      add(`Hoed / pet${label}`, 'Kleding', 1, trav);
    }
    if (has('rainy')) {
      add(`Regenjas${label}`, 'Kleding', 1, trav);
      add(`Waterdichte schoenen${label}`, 'Kleding', 1, trav);
    }
    if (has('snow')) add(`Warme waterdichte schoenen / snowboots${label}`, 'Kleding', 1, trav);
  });
  if (has('rainy')) add('Paraplu', 'Kleding', Math.min(nPpl, 2));

  // Geen weer aangevinkt? Dan tóch een jas — geen enkele paklijst is
  // compleet zonder — plus een taak om het weerbericht na te kijken.
  if (w.size === 0) {
    eachTraveler((t, trav, label) => {
      if (!isBaby(t)) add(`Jas (check het weerbericht)${label}`, 'Kleding', 1, trav);
    });
    add('Weerbericht checken en kleding aanvullen', 'Voor vertrek');
  }

  // ===== Verzorging =====
  add('Tandenborstel', 'Verzorging', nPpl);
  add('Tandpasta', 'Verzorging');
  add('Shampoo / douchegel', 'Verzorging');
  add('Conditioner', 'Verzorging');
  add('Deodorant', 'Verzorging', nPpl);
  add('Scheerspullen', 'Verzorging');
  add('Haarborstel / kam', 'Verzorging');
  add('Vochtige doekjes', 'Verzorging');
  add('Menstruatieproducten (indien van toepassing)', 'Verzorging');
  add('Lenzen + vloeistof / reservebril (indien van toepassing)', 'Verzorging');
  add('Anticonceptie (indien van toepassing)', 'Verzorging');
  eachTraveler((t, trav, label) => {
    if (isTeen(t)) add(`Eigen toilettas${label}`, 'Verzorging', 1, trav);
  });
  // Zonnebrand ook bij wintersport: sneeuw reflecteert de zon sterk.
  if (has('sunny', 'hot') || doesAct('skiing')) {
    add('Zonnebrand (SPF 30+)', 'Verzorging', Math.min(4, Math.max(1, Math.ceil((nPpl * days) / 25))));
    if (hasYoungKids) add('Zonnebrand kinderen (SPF 50)', 'Verzorging');
  }
  if (has('sunny', 'hot')) add('Aftersun', 'Verzorging');
  if (has('hot')) add('Bidon / waterfles', 'Verzorging', nPpl);
  add('Toilettas', 'Verzorging');
  if (has('sunny', 'hot', 'cold', 'freezing') || doesAct('skiing')) {
    add('Lippenbalsem (met SPF bij zon)', 'Verzorging');
  }
  if (accommodation === 'camping' || has('hot') || doesAct('hiking')) {
    add('Muggenspray / DEET', 'Verzorging');
    add('After-Bite / anti-jeuk stift', 'Verzorging');
  }
  if (days >= 7) add('Nagelknipper', 'Verzorging');

  // ===== Reisapotheek =====
  const meds = (medications || []).map(m => String(m || '').trim()).filter(Boolean);
  if (meds.length) {
    for (const m of meds) add(`Medicijn: ${m}`, 'Reisapotheek');
  } else {
    add('Persoonlijke medicijnen', 'Reisapotheek');
  }
  add('EHBO-set (pleisters, blarenpleisters, paracetamol, wondontsmetting, pincet)', 'Reisapotheek');
  add('Diarreemiddel / ORS', 'Reisapotheek');
  add('Antihistamine / hooikoortsmedicatie (indien nodig)', 'Reisapotheek');
  if (hasYoungKids) {
    add('Thermometer', 'Reisapotheek');
    add('Kinderparacetamol (zetpillen of drank)', 'Reisapotheek');
  }
  if (transport === 'car' && hasYoungKids) add('Reisziektetabletten voor kinderen', 'Reisapotheek');
  if (doesAct('hiking') || accommodation === 'camping') add('Teken-pincet', 'Reisapotheek');
  if (hasSenior) {
    add('Extra medicatie + recepten (senior)', 'Reisapotheek');
    add('Medicijn-doseerdoos (weekorganizer)', 'Reisapotheek');
  }

  // ===== Accommodatie =====
  if (accommodation === 'camping') {
    add('Tent (+ haringen en hamer)', 'Accommodatie');
    add('Slaapzak', 'Accommodatie', nPpl);
    add('Slaapmat / luchtbed', 'Accommodatie', nPpl);
    add('Hoofdlamp / zaklamp', 'Accommodatie');
    add('Kookspullen / brander + gas', 'Accommodatie');
    add('Aansteker / lucifers', 'Accommodatie');
    add('Servies en bestek', 'Accommodatie');
    add('Keukenmes + snijplank', 'Accommodatie');
    add('Afwasborstel + teiltje', 'Accommodatie');
    add('Theedoeken + afwasmiddel', 'Accommodatie');
    add('Keukenrol', 'Accommodatie');
    add('Blik- en flesopener', 'Accommodatie');
    add('Olie, zout, peper en kruiden', 'Accommodatie');
    add('Koffie / thee voor de eerste ochtend', 'Accommodatie');
    add('WC-papier', 'Accommodatie');
    add('Vuilniszakken', 'Accommodatie');
    add('Kussen', 'Accommodatie', nPpl);
    add('CEE-stekker / verlengsnoer voor camping-stroom', 'Accommodatie');
    add('Waslijn + knijpers', 'Accommodatie');
    add('Handdoeken', 'Accommodatie', nPpl);
    add('Föhn', 'Accommodatie');
  }
  if (accommodation === 'house') {
    add('Handdoeken (check of inbegrepen)', 'Accommodatie', nPpl);
    add('Beddengoed (check of inbegrepen)', 'Accommodatie');
    add('Föhn (check of aanwezig)', 'Accommodatie');
    add('Vaatwastabletten / afwasmiddel', 'Accommodatie');
    add('WC-papier (eerste avond)', 'Accommodatie');
    add('Vuilniszakken', 'Accommodatie');
  }
  if (accommodation === 'hostel') {
    add('Eigen handdoek', 'Accommodatie', nPpl);
    add('Lakenzak (vaak verplicht)', 'Accommodatie', nPpl);
    add('Hangslot voor locker', 'Accommodatie', nPpl);
    add('Oordoppen', 'Accommodatie', nPpl);
    eachTraveler((t, trav, label) => add(`Badslippers${label}`, 'Accommodatie', 1, trav));
  }
  if ((accommodation === 'camping' || accommodation === 'house') && days >= 4) {
    add('Reisspelletjes / kaarten voor de avond', 'Accommodatie');
  }
  if (accommodation === 'family') {
    add('Cadeautje voor de gastheer/-vrouw', 'Accommodatie');
  }

  // ===== Activiteiten =====
  if (waterFun) {
    eachTraveler((t, trav, label) => {
      add(`Zwemkleding${label}`, 'Activiteiten', 1, trav);
      add(`Badslippers${label}`, 'Activiteiten', 1, trav);
    });
    // Zwemvaardigheid hangt niet aan leeftijd: laat het oordeel bij de
    // ouder, tot en met de basisschoolleeftijd.
    if (hasToddler || hasChild) {
      add('Zwembandjes / zwemvest (voor kinderen zonder zwemdiploma)', 'Activiteiten');
    }
    if (nDiaperKids) add('Zwemluiers (pakje)', 'Activiteiten', nDiaperKids);
    add('Zwem-/strandhanddoek', 'Activiteiten', nPpl);
  }
  if (doesAct('skiing')) {
    add('Wintersportdekking op reisverzekering checken', 'Voor vertrek');
  }
  if (doesAct('beach')) {
    add('Strandtas', 'Activiteiten');
    add('Koeltasje met drinken', 'Activiteiten');
    eachTraveler((t, trav, label) => add(`Waterschoenen${label}`, 'Activiteiten', 1, trav));
    if (hasToddler || hasChild) add('Strandspeelgoed (emmer, schepjes)', 'Activiteiten');
    if (hasBaby) add('Strandtent / UV-tent voor baby', 'Activiteiten');
    if (transport === 'car') add('Parasol of windscherm', 'Activiteiten');
  }
  if (doesAct('watersport')) {
    eachTraveler((t, trav, label) => {
      add(`Zwembril${label}`, 'Activiteiten', 1, trav);
      add(`Rashguard / UV-shirt${label}`, 'Activiteiten', 1, trav);
    });
    add('Snorkelset', 'Activiteiten', nPpl);
  }
  if (doesAct('hiking')) {
    eachTraveler((t, trav, label) => {
      if (age(t) < 5) return; // baby's/peuters lopen niet mee — die gaan in de draagzak
      add(`Wandelschoenen${label}`, 'Activiteiten', 1, trav);
      add(`Wandelsokken${label}`, 'Activiteiten', 2, trav);
    });
    if (hasBuggyKid) add('Draagzak / rugdrager voor het wandelen', 'Activiteiten');
    add('Dagrugzak', 'Activiteiten', Math.max(1, travelers.filter(t => age(t) >= 8).length));
    add('Bidon / waterfles', 'Activiteiten', nPpl);
  }
  if (doesAct('skiing')) {
    eachTraveler((t, trav, label) => {
      if (age(t) < 3) return; // skiën begint doorgaans vanaf ± 3-4 jaar
      add(`Ski-/snowboardjas en -broek${label}`, 'Activiteiten', 1, trav);
      add(`Skihandschoenen${label}`, 'Activiteiten', 1, trav);
      add(`Skibril${label}`, 'Activiteiten', 1, trav);
      add(`Skihelm${label}`, 'Activiteiten', 1, trav);
      add(`Skisokken${label}`, 'Activiteiten', 2, trav);
      add(`Col / nekwarmer${label}`, 'Activiteiten', 1, trav);
      add(`Warme waterdichte schoenen / snowboots${label}`, 'Kleding', 1, trav);
    });
    add('Skipas / huurbevestiging', 'Activiteiten', travelers.filter(t => age(t) >= 4).length || 1);
    if (transport === 'car') {
      add("Ski's / snowboard + skischoenen (of huren ter plekke)", 'Activiteiten');
      add('Skibox / dakdragers', 'Transport');
    }
  }
  if (doesAct('cycling')) {
    eachTraveler((t, trav, label) => {
      if (age(t) < 1) return;
      add(`Fietshelm${label}`, 'Activiteiten', 1, trav);
    });
    if (hasBuggyKid) add('Fietszitje of fietskar (of huren)', 'Activiteiten');
    add('Comfortabele kleding voor fietsen', 'Activiteiten');
    add('Bidon / waterfles', 'Activiteiten', nPpl);
  }
  if (doesAct('themepark')) {
    add('Kleingeld voor kluisjes', 'Activiteiten');
    add('Dunne regenponcho (waterattracties)', 'Activiteiten', nPpl);
    add('Snacks en tussendoortjes', 'Activiteiten');
    add('Reservekleding (voor waterattracties)', 'Activiteiten');
  }
  if (doesAct('citytrip', 'cultural')) {
    add('Reisgids / opgeslagen tickets', 'Activiteiten');
    add('Kleine schoudertas / heuptas', 'Activiteiten');
    add('Anti-diefstal tasje / moneybelt (drukke steden)', 'Activiteiten');
  }
  if (doesAct('daytrip')) {
    add('Dagrugzak', 'Activiteiten');
    add('Bidon / waterfles', 'Activiteiten', nPpl);
    add('Snacks voor onderweg', 'Activiteiten');
  }
  if (doesAct('nightlife')) {
    eachTraveler((t, trav, label) => {
      if (age(t) >= 5) {
        add(`Nette kleding voor uitgaan / restaurant${label}`, 'Activiteiten', 1, trav);
        add(`Nette schoenen${label}`, 'Activiteiten', 1, trav);
      }
    });
  }

  // ===== Baby & kids =====
  if (hasDiaperKid) {
    // Luiers voor de eerste dagen; langere voorraad koop je ter plekke.
    add(
      days > 5 ? 'Luiers voor de eerste dagen (ter plekke bijkopen)' : 'Luiers',
      'Baby & kids',
      Math.min(Math.min(days, 5) * 6 * nDiaperKids, 60)
    );
    add('Babydoekjes', 'Baby & kids', Math.max(2, Math.ceil(days / 3)));
    add('Billenzalf (zinkzalf)', 'Baby & kids');
    add('Verschoningsmatje voor onderweg', 'Baby & kids');
    add('Luierzakjes', 'Baby & kids');
  }
  if (hasBaby) {
    add('Flesvoeding + flessen + reservespeen', 'Baby & kids', nBabies);
    add('Fopspeen + reserve', 'Baby & kids', nBabies);
    add('Thermosfles voor flesvoeding onderweg', 'Baby & kids');
    add('Potjes / hapjes voor de eerste dagen', 'Baby & kids');
    add('Slabbetjes', 'Baby & kids', Math.min(nBabies * 4, 12));
    add('Babyslaapzak', 'Baby & kids', nBabies);
    add('Knuffel / inbakerdoek', 'Baby & kids', nBabies);
    add('Reisbedje / wieg', 'Baby & kids', nBabies);
    add('Babyfoon', 'Baby & kids');
    add('Zonnehoedje baby', 'Baby & kids', nBabies);
  }
  if (hasBuggyKid) {
    add('Buggy / draagzak', 'Baby & kids');
    if (has('rainy')) add('Regenhoes voor de buggy', 'Baby & kids');
    if (has('cold', 'freezing')) add('Voetenzak / warm pak voor de buggy', 'Baby & kids');
  }
  if (hasToddler) {
    add('Luierbroekjes / nachtluiers (indien nog niet zindelijk)', 'Baby & kids');
    add('Plaspotje voor onderweg (indien net zindelijk)', 'Baby & kids');
    add('Reservekleding peuter (per dagdeel)', 'Baby & kids', Math.min(days * 2, 20));
    add('Speelgoed / boekjes', 'Baby & kids');
  }
  if (hasChild) {
    add('Reservekleding kind', 'Baby & kids', 3);
  }
  if (hasToddler || hasChild) {
    add('Tussendoortjes voor de kinderen', 'Baby & kids');
  }
  if (hasChild) {
    add('Knuffel / favoriet speelgoed', 'Baby & kids');
    add('Speelgoed voor op de bestemming', 'Baby & kids');
    add('Kleurboek + kleurpotloden', 'Baby & kids');
    add('Tablet + oplader (films vooraf downloaden)', 'Baby & kids');
  }
  if ((hasChild || hasToddler) && ['car', 'train', 'plane'].includes(transport)) {
    add('Spelletjes / boekjes voor onderweg', 'Baby & kids');
  }
  if (hasYoungKids && doesAct('themepark')) {
    add('Polsbandje met telefoonnummer (attractiepark)', 'Baby & kids');
  }

  // ===== Transport =====
  if (transport === 'plane') {
    add('Vloeistoffen <100ml in transparant zakje', 'Transport');
    add('Powerbank in handbagage (niet in ruim!)', 'Transport');
    add('Medicijnen in handbagage (niet in ruim)', 'Transport');
    add('Setje reservekleding in handbagage (bij vertraagde koffer)', 'Transport');
    add('Waardevolle spullen + documenten in handbagage', 'Transport');
    add('Bagagelabels met naam en adres', 'Transport', nPpl);
    add('Nekkussen + oogmasker + oordoppen', 'Transport', Math.max(1, nPpl - nBabies));
    add('Vest / trui voor in de cabine', 'Transport', nPpl);
    if (hasBaby || hasToddler) add('Fles of speen voor opstijgen en landen (oren)', 'Transport');
    if (hasBaby) {
      add('Babyvoeding / melk mag >100ml door security (apart tonen)', 'Transport');
      add('Extra rompertje + luiers in handbagage', 'Transport');
      add('Fysiologische neusdruppels (drukverschil)', 'Reisapotheek');
      add('Bassinet / wieg aan boord reserveren', 'Voor vertrek');
      add('Kinderwagen: tot gate meenemen of inchecken? checken', 'Voor vertrek');
    }
    if (hasChild) add('Kauwgom / snoepje voor opstijgen en landen', 'Transport');
    if (accommodation === 'camping') add('Tent/uitrusting ter plekke huren of opsturen', 'Voor vertrek');
    if (doesAct('cycling')) add('Fietsen ter plekke reserveren', 'Voor vertrek');
    if (doesAct('skiing')) add('Ski-uitrusting ter plekke reserveren', 'Voor vertrek');
  }
  if (transport === 'car') {
    add('Snacks en drinken voor onderweg', 'Transport');
    add('Veiligheidshesje en gevarendriehoek', 'Transport');
    add('Verbanddoos (verplicht in Duitsland en Oostenrijk)', 'Transport');
    add('Reservelampenset', 'Transport');
    if (hasYoungKids) add('Kinderzitje / autostoel', 'Transport');
    if (accommodation === 'camping' || accommodation === 'house') add('Koelbox + koelelementen', 'Transport');
    if (accommodation === 'camping') {
      add('Campingstoelen', 'Accommodatie', nPpl);
      add('Campingtafel of klaptafel', 'Accommodatie');
      add('BBQ (+ gas of briketten)', 'Accommodatie');
      add('Buitenverlichting / lantaarn', 'Accommodatie');
    }
    if (doesAct('cycling')) add('Fietsen + fietsenrek (of huren ter plekke)', 'Transport');
  }
  if (isDriving) {
    // Geldt voor eigen auto én huurauto.
    add('Auto-oplader / USB-kabel', 'Transport');
    add('Telefoonhouder voor in de auto', 'Transport');
    add('Navigatie / offline kaarten', 'Transport');
    if (doesAct('skiing') || has('snow')) add('Sneeuwkettingen (check verplichting route)', 'Transport');
    if (has('snow', 'freezing')) add('IJskrabber + ruitenontdooier', 'Transport');
    if (hasYoungKids && has('sunny', 'hot')) add('Zonnescherm voor autoraam', 'Transport');
  }
  if (rentalCar && hasYoungKids) {
    add('Kinderzitje bij huurauto reserveren (of zelf meenemen)', 'Voor vertrek');
  }
  if (transport === 'train') {
    add('Snacks en drinken voor onderweg', 'Transport');
  }

  // ===== Overig =====
  add('Sleutels van huis (vergeet ze niet!)', 'Overig');
  add('Reisslot voor koffer / tas', 'Overig');
  add('Boodschappentas / opvouwbare tas', 'Overig');
  add('Plastic zakjes voor vuil wasgoed', 'Overig');
  if (days >= 3) add('Boek / e-reader voor onderweg', 'Overig');
  if (days >= 7) add('Wasmiddel / wasstrips (voor langere reis)', 'Overig');

  // ===== Voor vertrek (taken, geen inpak-items) =====
  if (transport === 'plane') {
    add('Online inchecken', 'Voor vertrek');
    add('Handbagage-afmetingen en -gewicht checken', 'Voor vertrek');
    add('Parkeren bij vliegveld of vervoer ernaartoe regelen', 'Voor vertrek');
  }
  if (land && land.visa) add('Visum / reistoestemming regelen (bv. ESTA of eTA)', 'Voor vertrek');
  if (!land && !home) add('Reisdocument- en visumeisen voor je bestemming checken', 'Voor vertrek');
  if (transport === 'car' && !home) {
    add('Vignet / tolregels voor de route checken', 'Voor vertrek');
    add("Milieuvignet checken (Crit'Air Frankrijk / Umweltplakette Duitse steden)", 'Voor vertrek');
    add('Pechhulp / ANWB-dekking in het buitenland checken', 'Voor vertrek');
    add('Auto-check: bandenspanning, olie, koelvloeistof', 'Voor vertrek');
  }
  if (transport === 'plane') add('Ruimbagage wegen (max. gewicht checken)', 'Voor vertrek');
  if (!home && land && !land.ehic) {
    add('Werelddekking pinpas aanzetten (geo-blokkering)', 'Voor vertrek');
  }

  // ===== Dagje over de grens (vanaf de Omgeving-pagina) =====
  // Land-specifieke verplichtingen voor buurlanden op het programma.
  const hasCar = transport === 'car' || rentalCar;
  const VIGNETTE_COUNTRIES = new Set(['at', 'ch', 'si', 'cz', 'sk', 'hu']);
  for (const code of (Array.isArray(borderCountries) ? borderCountries : [])) {
    const buur = getCountry(code);
    if (!buur || buur.code === (land && land.code)) continue;
    if (hasCar) {
      if (buur.code === 'de') {
        add('Umweltplakette (milieuvignet) voor Duitse steden regelen', 'Voor vertrek');
        add('Verbanddoos (verplicht in Duitsland en Oostenrijk)', 'Transport');
      }
      if (buur.code === 'fr') add("Crit'Air-vignet aanvragen (verplicht in veel Franse steden)", 'Voor vertrek');
      if (buur.code === 'be') add('LEZ-zones België checken (Antwerpen, Gent, Brussel)', 'Voor vertrek');
      if (VIGNETTE_COUNTRIES.has(buur.code)) add(`Vignet voor ${buur.name} regelen`, 'Voor vertrek');
    }
    if (!buur.euro) add(`Contant geld voor ${buur.name} (geen euro)`, 'Geld');
    if (!buur.idCard) add(`Paspoort-eisen ${buur.name} checken voor het grens-dagje`, 'Voor vertrek');
  }
  if (meds.length && !home) {
    add('Medicijnverklaring checken (voor sommige medicijnen verplicht)', 'Voor vertrek');
  }
  if (rentalCar) {
    add('Huurauto: reservering + creditcard voor borg', 'Voor vertrek');
    // NL-rijbewijs volstaat in de EU/EER én het VK.
    if (land && !land.ehic && land.code !== 'gb') {
      add('Internationaal rijbewijs checken (vereist buiten Europa?)', 'Voor vertrek');
    }
  }
  if (land && !land.ehic && !home) add('Vaccinaties / gezondheidsadvies voor bestemming checken', 'Voor vertrek');
  // EU-roaming geldt in EU/EER — níet in Zwitserland (klassieke valkuil).
  const freeRoaming = land && land.ehic && land.code !== 'ch';
  if (!home && !freeRoaming) add('Roaming / eSIM regelen (buiten EU-roaming)', 'Voor vertrek');
  add('Deuren, ramen en terrasdeuren op slot', 'Voor vertrek');
  add('Verwarming laag / airco uit', 'Voor vertrek');
  add('Koelkast leegmaken (bederfelijk eten)', 'Voor vertrek');
  add('Kranen dicht (ook wasmachinekraan) en gas controleren', 'Voor vertrek');
  add('Post / pakketten pauzeren of buren inlichten', 'Voor vertrek');
  add('Sleutel bij buren of familie achterlaten', 'Voor vertrek');
  add('Oppas voor planten en huisdieren regelen', 'Voor vertrek');

  // Ontdubbelen op tekst (per-reiziger labels maken teksten al uniek).
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

module.exports = { generateItems, defaultQuantities, resolveAge };
