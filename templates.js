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

function generateItems({
  destination,
  startDate,
  endDate,
  travelers = [],
  transport,
  weather,
  accommodation,
  activities = [],
  medications = [],
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

  // Documenten
  add(home ? 'ID-kaart' : 'Paspoort (geldig)', 'Documenten');
  add('Reisverzekering / polisnummer', 'Documenten');
  if (!home) add('Europees ziekteverzekeringsbewijs (EHIC)', 'Documenten');
  if (transport === 'plane') add('Vliegtickets / boarding pass', 'Documenten');
  if (transport === 'car') {
    add('Rijbewijs', 'Documenten');
    add('Auto-papieren (kentekenbewijs, groene kaart)', 'Documenten');
  }
  if (accommodation) add('Reservering accommodatie (bevestigingsmail / adres)', 'Documenten');

  // Geld
  add('Pinpas', 'Geld');
  add('Creditcard', 'Geld');
  if (!euro && !home) add(`Vreemde valuta / contant geld voor ${destination || 'bestemming'}`, 'Geld');

  // Elektronica
  add('Telefoon', 'Elektronica');
  add('Telefoonoplader', 'Elektronica');
  add('Powerbank', 'Elektronica');
  if (!home && !euro) add('Stekkeradapter (controleer type voor land)', 'Elektronica');
  if (days >= 4) add('Koptelefoon / oortjes', 'Elektronica');

  // Kleding per reiziger (hoeveelheid afhankelijk van duur).
  // Je draagt op de vertrekdag al iets, dus eentje minder mee.
  const undies = Math.max(1, Math.min(days, 14));
  const tops = Math.max(1, Math.min(Math.ceil(days / 1.5) - 1, 14));
  const bottoms = Math.max(1, Math.min(Math.ceil(days / 3) - 1, 7));
  travelers.forEach((t, i) => {
    const parts = [];
    if (t.name && String(t.name).trim()) parts.push(String(t.name).trim());
    else if (travelers.length > 1) parts.push(`reiziger ${i + 1}`);
    if (t.age != null) parts.push(`${t.age} jr`);
    const label = parts.length ? ` (${parts.join(', ')})` : '';
    add(`Ondergoed × ${undies}${label}`, 'Kleding');
    add(`Sokken × ${undies}${label}`, 'Kleding');
    add(`T-shirts / bovenstukken × ${tops}${label}`, 'Kleding');
    add(`Broeken / rokken × ${bottoms}${label}`, 'Kleding');
    add(`Pyjama${label}`, 'Kleding');
    add(`Schoenen (comfortabel)${label}`, 'Kleding');
  });

  // Weer
  if (weather === 'hot') {
    add('Zonnebrand (SPF 30+)', 'Verzorging');
    add('Aftersun', 'Verzorging');
    add('Zonnebril', 'Kleding');
    add('Hoed / pet', 'Kleding');
    add('Korte broeken', 'Kleding');
    add('Lichte zomerkleding', 'Kleding');
  }
  if (weather === 'cold') {
    add('Warme winterjas', 'Kleding');
    add('Muts', 'Kleding');
    add('Sjaal', 'Kleding');
    add('Handschoenen', 'Kleding');
    add('Thermo-ondergoed', 'Kleding');
    add('Warme trui(en)', 'Kleding');
    add('Lipbalsem', 'Verzorging');
  }
  if (weather === 'rainy') {
    add('Regenjas', 'Kleding');
    add('Paraplu', 'Kleding');
    add('Waterdichte schoenen', 'Kleding');
  }
  if (weather === 'mild') {
    add('Vest / dunne trui', 'Kleding');
    add('Lichte jas', 'Kleding');
  }
  if (weather === 'mixed') {
    add('Regenjas', 'Kleding');
    add('Paraplu', 'Kleding');
    add('Vest / dunne trui', 'Kleding');
    add('Lichte jas', 'Kleding');
    add('Lange broek', 'Kleding');
    add('Korte broek', 'Kleding');
    add('Laagjes (lange en korte mouw)', 'Kleding');
    add('Waterdichte schoenen / stevige schoenen', 'Kleding');
  }

  // Accommodatie
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

  // Activiteiten
  if (activities.includes('swimming')) {
    add('Zwemkleding', 'Activiteiten');
    add('Strandhanddoek', 'Activiteiten');
    add('Slippers / waterschoenen', 'Activiteiten');
    add('Zwembril', 'Activiteiten');
  }
  if (activities.includes('hiking')) {
    add('Wandelschoenen', 'Activiteiten');
    add('Dagrugzak', 'Activiteiten');
    add('Bidon / waterfles', 'Activiteiten');
    add('Wandelsokken', 'Activiteiten');
  }
  if (activities.includes('skiing')) {
    add('Ski-/snowboardjas en -broek', 'Activiteiten');
    add('Skihandschoenen', 'Activiteiten');
    add('Skibril', 'Activiteiten');
    add('Helm', 'Activiteiten');
    add('Skipas / huurbevestiging', 'Activiteiten');
  }
  if (activities.includes('cycling')) {
    add('Fietshelm', 'Activiteiten');
    add('Fietshandschoenen', 'Activiteiten');
    add('Fietsbroek', 'Activiteiten');
  }
  if (activities.includes('nightlife')) {
    add('Nette kleding voor uitgaan', 'Activiteiten');
    add('Nette schoenen', 'Activiteiten');
  }
  if (activities.includes('cultural')) {
    add('Reisgids / opgeslagen tickets', 'Activiteiten');
    add('Comfortabele wandelschoenen voor de stad', 'Activiteiten');
  }
  if (activities.includes('beach')) {
    add('Strandlaken', 'Activiteiten');
    add('Strandtas', 'Activiteiten');
    add('Boek / e-reader', 'Activiteiten');
  }

  // Verzorging
  add('Tandenborstel + tandpasta', 'Verzorging');
  add('Shampoo / douchegel', 'Verzorging');
  add('Deodorant', 'Verzorging');
  add('Haarborstel / kam', 'Verzorging');
  const meds = (medications || [])
    .map(m => String(m || '').trim())
    .filter(Boolean);
  if (meds.length) {
    for (const m of meds) add(`Medicijn: ${m}`, 'Verzorging');
  } else {
    add('Persoonlijke medicijnen', 'Verzorging');
  }
  add('EHBO / pleisters / paracetamol', 'Verzorging');
  if (days >= 7) add('Nagelknipper', 'Verzorging');
  if (hasSenior) add('Extra medicatie + recepten', 'Verzorging');

  // Baby / kinderen
  if (hasBaby) {
    add('Luiers (ruim genoeg)', 'Baby & kids');
    add('Babydoekjes', 'Baby & kids');
    add('Flesvoeding / fles + speen', 'Baby & kids');
    add('Knuffel / inbakerdoek', 'Baby & kids');
    add('Reisbedje / wieg', 'Baby & kids');
    add('Babyfoon', 'Baby & kids');
    add('Buggy / draagzak', 'Baby & kids');
  }
  if (hasToddler) {
    add('Reservekleding (extra setjes)', 'Baby & kids');
    add('Speelgoed / boekjes', 'Baby & kids');
    add('Tussendoortjes', 'Baby & kids');
  }
  if (hasChild) {
    add('Speelgoed / spelletjes voor onderweg', 'Baby & kids');
    add('Tablet + opladers (downloaded films)', 'Baby & kids');
  }

  // Transport-specifiek
  if (transport === 'plane') {
    add('Handbagage onder limiet checken', 'Transport');
    add('Vloeistoffen <100ml in transparant zakje', 'Transport');
    add('Powerbank in handbagage (niet in ruim!)', 'Transport');
  }
  if (transport === 'car') {
    add('Snacks en water voor onderweg', 'Transport');
    add('Auto-oplader / USB-kabel', 'Transport');
    add('Navigatie / kaarten / offline route', 'Transport');
    add('Veiligheidshesje en gevarendriehoek', 'Transport');
    add('Reservebrandstof-app / tankpas', 'Transport');
  }
  if (transport === 'train') {
    add('Treintickets / e-tickets', 'Transport');
    add('Snacks en water', 'Transport');
    add('Boek / podcast voor onderweg', 'Transport');
  }

  // Algemeen / gemak
  add('Boodschappentas / opvouwbare tas', 'Overig');
  add('Plastic zakjes voor vuil wasgoed', 'Overig');
  if (days >= 7) add('Wasmiddel / wasstrips (voor langere reis)', 'Overig');

  // Verwijder duplicaten op tekst (kan voorkomen door overlap regels)
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

const ACTIVITY_OPTIONS = [
  { value: 'swimming', label: 'Zwemmen' },
  { value: 'beach', label: 'Strand' },
  { value: 'hiking', label: 'Wandelen / hiken' },
  { value: 'cycling', label: 'Fietsen' },
  { value: 'skiing', label: 'Skiën / snowboarden' },
  { value: 'cultural', label: 'Cultuur / steden' },
  { value: 'nightlife', label: 'Uitgaan' },
];

module.exports = { generateItems, ACTIVITY_OPTIONS };
