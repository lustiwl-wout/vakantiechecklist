// Landenlijst met de eigenschappen die de inpaklijst beïnvloeden.
//
//   ehic    — Europese zorgpas (EHIC) geldig (EU/EER/Zwitserland)
//   euro    — euro is het betaalmiddel
//   idCard  — bereikbaar met alleen een Nederlandse ID-kaart (EU/EER/CH)
//   plug    — stopcontact: 'eu' (type C/E/F, geen adapter nodig), 'uk',
//             'us', 'au', 'ch', 'it', 'za', 'in' (wel adapter nodig)
//   visa    — Nederlanders hebben visum/e-visum/reistoestemming nodig
//   home    — thuisland (geen reisdocument-advies)
//
// Bewust beperkt tot voor de hand liggende vakantielanden + 'other'.

const COUNTRIES = [
  { code: 'nl', name: 'Nederland', ehic: true, euro: true, idCard: true, plug: 'eu', visa: false, home: true },
  { code: 'be', name: 'België', ehic: true, euro: true, idCard: true, plug: 'eu', visa: false },
  { code: 'de', name: 'Duitsland', ehic: true, euro: true, idCard: true, plug: 'eu', visa: false },
  { code: 'fr', name: 'Frankrijk', ehic: true, euro: true, idCard: true, plug: 'eu', visa: false },
  { code: 'es', name: 'Spanje', ehic: true, euro: true, idCard: true, plug: 'eu', visa: false },
  { code: 'pt', name: 'Portugal', ehic: true, euro: true, idCard: true, plug: 'eu', visa: false },
  { code: 'it', name: 'Italië', ehic: true, euro: true, idCard: true, plug: 'it', visa: false },
  { code: 'at', name: 'Oostenrijk', ehic: true, euro: true, idCard: true, plug: 'eu', visa: false },
  { code: 'ch', name: 'Zwitserland', ehic: true, euro: false, idCard: true, plug: 'ch', visa: false },
  { code: 'gr', name: 'Griekenland', ehic: true, euro: true, idCard: true, plug: 'eu', visa: false },
  { code: 'hr', name: 'Kroatië', ehic: true, euro: true, idCard: true, plug: 'eu', visa: false },
  { code: 'si', name: 'Slovenië', ehic: true, euro: true, idCard: true, plug: 'eu', visa: false },
  { code: 'cz', name: 'Tsjechië', ehic: true, euro: false, idCard: true, plug: 'eu', visa: false },
  { code: 'pl', name: 'Polen', ehic: true, euro: false, idCard: true, plug: 'eu', visa: false },
  { code: 'hu', name: 'Hongarije', ehic: true, euro: false, idCard: true, plug: 'eu', visa: false },
  { code: 'sk', name: 'Slowakije', ehic: true, euro: true, idCard: true, plug: 'eu', visa: false },
  { code: 'dk', name: 'Denemarken', ehic: true, euro: false, idCard: true, plug: 'eu', visa: false },
  { code: 'se', name: 'Zweden', ehic: true, euro: false, idCard: true, plug: 'eu', visa: false },
  { code: 'no', name: 'Noorwegen', ehic: true, euro: false, idCard: true, plug: 'eu', visa: false },
  { code: 'fi', name: 'Finland', ehic: true, euro: true, idCard: true, plug: 'eu', visa: false },
  { code: 'is', name: 'IJsland', ehic: true, euro: false, idCard: true, plug: 'eu', visa: false },
  { code: 'ie', name: 'Ierland', ehic: true, euro: true, idCard: true, plug: 'uk', visa: false },
  { code: 'gb', name: 'Verenigd Koninkrijk', ehic: false, euro: false, idCard: false, plug: 'uk', visa: false },
  { code: 'ro', name: 'Roemenië', ehic: true, euro: false, idCard: true, plug: 'eu', visa: false },
  { code: 'bg', name: 'Bulgarije', ehic: true, euro: false, idCard: true, plug: 'eu', visa: false },
  { code: 'mt', name: 'Malta', ehic: true, euro: true, idCard: true, plug: 'uk', visa: false },
  { code: 'cy', name: 'Cyprus', ehic: true, euro: true, idCard: true, plug: 'uk', visa: false },
  { code: 'lu', name: 'Luxemburg', ehic: true, euro: true, idCard: true, plug: 'eu', visa: false },
  { code: 'ee', name: 'Estland', ehic: true, euro: true, idCard: true, plug: 'eu', visa: false },
  { code: 'lv', name: 'Letland', ehic: true, euro: true, idCard: true, plug: 'eu', visa: false },
  { code: 'lt', name: 'Litouwen', ehic: true, euro: true, idCard: true, plug: 'eu', visa: false },
  { code: 'tr', name: 'Turkije', ehic: false, euro: false, idCard: false, plug: 'eu', visa: false },
  { code: 'ma', name: 'Marokko', ehic: false, euro: false, idCard: false, plug: 'eu', visa: false },
  { code: 'eg', name: 'Egypte', ehic: false, euro: false, idCard: false, plug: 'eu', visa: true },
  { code: 'tn', name: 'Tunesië', ehic: false, euro: false, idCard: false, plug: 'eu', visa: false },
  { code: 'us', name: 'Verenigde Staten', ehic: false, euro: false, idCard: false, plug: 'us', visa: true },
  { code: 'ca', name: 'Canada', ehic: false, euro: false, idCard: false, plug: 'us', visa: true },
  { code: 'mx', name: 'Mexico', ehic: false, euro: false, idCard: false, plug: 'us', visa: false },
  { code: 'br', name: 'Brazilië', ehic: false, euro: false, idCard: false, plug: 'eu', visa: false },
  { code: 'cw', name: 'Curaçao', ehic: false, euro: false, idCard: false, plug: 'us', visa: false },
  { code: 'aw', name: 'Aruba', ehic: false, euro: false, idCard: false, plug: 'us', visa: false },
  { code: 'sr', name: 'Suriname', ehic: false, euro: false, idCard: false, plug: 'eu', visa: true },
  { code: 'id', name: 'Indonesië', ehic: false, euro: false, idCard: false, plug: 'eu', visa: true },
  { code: 'th', name: 'Thailand', ehic: false, euro: false, idCard: false, plug: 'us', visa: false },
  { code: 'vn', name: 'Vietnam', ehic: false, euro: false, idCard: false, plug: 'eu', visa: true },
  { code: 'jp', name: 'Japan', ehic: false, euro: false, idCard: false, plug: 'us', visa: false },
  { code: 'cn', name: 'China', ehic: false, euro: false, idCard: false, plug: 'au', visa: true },
  { code: 'in', name: 'India', ehic: false, euro: false, idCard: false, plug: 'in', visa: true },
  { code: 'ae', name: 'Verenigde Arabische Emiraten', ehic: false, euro: false, idCard: false, plug: 'uk', visa: false },
  { code: 'za', name: 'Zuid-Afrika', ehic: false, euro: false, idCard: false, plug: 'za', visa: false },
  { code: 'au', name: 'Australië', ehic: false, euro: false, idCard: false, plug: 'au', visa: true },
  { code: 'nz', name: 'Nieuw-Zeeland', ehic: false, euro: false, idCard: false, plug: 'au', visa: true },
  { code: 'other', name: 'Ander land', ehic: false, euro: false, idCard: false, plug: 'unknown', visa: false },
];

const byCode = new Map(COUNTRIES.map(c => [c.code, c]));

function getCountry(code) {
  return byCode.get(String(code || '').toLowerCase()) || null;
}

module.exports = { COUNTRIES, getCountry };
