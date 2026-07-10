// Vakantiechecklist — frontend SPA met hash-routing.

const ACTIVITIES = [
  { value: 'beach', label: 'Strand' },
  { value: 'pool', label: 'Zwembad' },
  { value: 'watersport', label: 'Watersport / snorkelen' },
  { value: 'hiking', label: 'Wandelen / hiken' },
  { value: 'cycling', label: 'Fietsen' },
  { value: 'skiing', label: 'Skiën / snowboarden' },
  { value: 'themepark', label: 'Attractiepark / pretpark' },
  { value: 'citytrip', label: 'Stedentrip / cultuur / musea' },
  { value: 'daytrip', label: 'Dagtrips / excursies' },
  { value: 'nightlife', label: 'Uitgaan / restaurants' },
];

const TRANSPORT = [
  { value: '', label: '— Kies —' },
  { value: 'plane', label: 'Vliegtuig' },
  { value: 'car', label: 'Auto' },
  { value: 'train', label: 'Trein' },
  { value: 'other', label: 'Anders' },
];

const WEATHER_OPTIONS = [
  { value: 'hot', label: 'Heet (>25°C)' },
  { value: 'warm', label: 'Warm (18–25°C)' },
  { value: 'mild', label: 'Mild (10–18°C)' },
  { value: 'cool', label: 'Koel (5–10°C)' },
  { value: 'cold', label: 'Koud (0–5°C)' },
  { value: 'freezing', label: 'Vrieskou (<0°C)' },
  { value: 'sunny', label: 'Veel zon' },
  { value: 'rainy', label: 'Regen' },
  { value: 'snow', label: 'Sneeuw' },
];

const ACCOMMODATION = [
  { value: '', label: '— Kies —' },
  { value: 'hotel', label: 'Hotel' },
  { value: 'house', label: 'Vakantiehuis / appartement' },
  { value: 'camping', label: 'Camping' },
  { value: 'hostel', label: 'Hostel' },
  { value: 'family', label: 'Familie / vrienden' },
];

const STANDARD_CATEGORIES = [
  'Documenten', 'Geld', 'Elektronica', 'Kleding', 'Verzorging', 'Reisapotheek',
  'Accommodatie', 'Activiteiten', 'Baby & kids', 'Transport', 'Overig', 'Voor vertrek',
];

const CATEGORY_ORDER = STANDARD_CATEGORIES;

const TRAVELER_CATEGORIES = [
  { value: 'baby', label: 'Baby (0–1)' },
  { value: 'peuter', label: 'Peuter (2–4)' },
  { value: 'kind', label: 'Kind (5–12)' },
  { value: 'tiener', label: 'Tiener (13–17)' },
  { value: 'volwassene', label: 'Volwassene' },
  { value: 'senior', label: 'Senior (65+)' },
];

function ageFromBirthdate(birthdate, ref = new Date()) {
  const b = new Date(birthdate);
  if (isNaN(b)) return null;
  let a = ref.getFullYear() - b.getFullYear();
  const m = ref.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && ref.getDate() < b.getDate())) a--;
  return Math.max(0, a);
}

function categoryFromAge(a) {
  if (a < 2) return 'baby';
  if (a < 5) return 'peuter';
  if (a < 13) return 'kind';
  if (a < 18) return 'tiener';
  if (a < 65) return 'volwassene';
  return 'senior';
}

async function getFamily() {
  const res = await api('/api/family');
  return res.members;
}

// Landenlijst wordt één keer opgehaald en gedeeld tussen views.
let countriesCache = null;
async function getCountries() {
  if (countriesCache) return countriesCache;
  try {
    const res = await api('/api/meta/countries');
    countriesCache = res.countries;
  } catch {
    countriesCache = [];
  }
  return countriesCache;
}

const app = document.getElementById('app');
const navEl = document.getElementById('nav');
const toastEl = document.getElementById('toast');

let currentUser = null;

// ---------- helpers ----------

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

let toastTimer = null;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 2500);
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    credentials: 'same-origin',
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    // Sessie verlopen: terug naar het inlogscherm in plaats van losse
    // foutmeldingen bij elke actie.
    if (res.status === 401 && location.hash !== '#/login') {
      currentUser = null;
      navigate('#/login');
    }
    const err = new Error((data && data.error) || `Fout ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

function fmtDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt)) return '';
  return dt.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' });
}

function isoDateOnly(d) {
  if (!d) return '';
  // De server geeft DATE-kolommen als 'YYYY-MM-DD'-string — direct gebruiken,
  // dan kan er geen tijdzone-verschuiving optreden.
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10);
  const dt = new Date(d);
  if (isNaN(dt)) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

function daysBetweenISO(start, end) {
  if (!start || !end) return 7;
  const a = new Date(start); const b = new Date(end);
  if (isNaN(a) || isNaN(b)) return 7;
  return Math.max(1, Math.round((b - a) / 86400000) + 1);
}

function defaultQuantities(days) {
  return {
    underwear: Math.max(2, Math.min(days + 1, 15)),
    socks: Math.max(2, Math.min(days + 1, 15)),
    tshirts: Math.max(2, Math.min(days + 1, 15)),
    sweaters: Math.max(1, Math.min(Math.ceil(days / 4), 4)),
    bottoms: Math.max(1, Math.min(Math.ceil(days / 3) - 1, 7)),
  };
}

function navigate(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

function renderNav() {
  clear(navEl);
  if (currentUser) {
    navEl.append(
      el('a', { href: '#/gezin', class: 'btn btn-sm btn-ghost' }, '👨‍👩‍👧 Gezin'),
      el('span', { class: 'who' }, currentUser.email),
      el('button', { class: 'btn btn-sm btn-ghost', onclick: logout }, 'Uitloggen')
    );
  }
}

async function logout() {
  try { await api('/api/auth/logout', { method: 'POST' }); } catch {}
  currentUser = null;
  navigate('#/login');
}

// ---------- auth ----------

function renderAuth() {
  let mode = 'login';
  const wrap = el('div', { class: 'card auth-card' });

  function paint() {
    clear(wrap);
    const tabs = el('div', { class: 'tabs' },
      el('button', { class: mode === 'login' ? 'active' : '', onclick: () => { mode = 'login'; paint(); } }, 'Inloggen'),
      el('button', { class: mode === 'register' ? 'active' : '', onclick: () => { mode = 'register'; paint(); } }, 'Registreren')
    );

    const errBox = el('div', { class: 'error' });
    const emailIn = el('input', { type: 'email', required: true, autocomplete: 'email', placeholder: 'jij@voorbeeld.nl' });
    const pwIn = el('input', { type: 'password', required: true, autocomplete: mode === 'login' ? 'current-password' : 'new-password', placeholder: mode === 'login' ? 'Wachtwoord' : 'Minimaal 8 tekens' });

    const form = el('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        errBox.textContent = '';
        try {
          const res = await api(`/api/auth/${mode}`, {
            method: 'POST',
            body: { email: emailIn.value, password: pwIn.value },
          });
          currentUser = res.user;
          renderNav();
          navigate('#/');
        } catch (err) {
          errBox.textContent = err.message;
        }
      },
    },
      el('h1', {}, mode === 'login' ? 'Inloggen' : 'Account aanmaken'),
      el('p', { class: 'muted' }, mode === 'login' ? 'Log in om je inpaklijsten te bekijken.' : 'Maak een account aan om je lijsten op te slaan.'),
      el('div', { class: 'field' }, el('label', {}, 'E-mailadres'), emailIn),
      el('div', { class: 'field' }, el('label', {}, 'Wachtwoord'), pwIn),
      errBox,
      el('button', { type: 'submit', class: 'btn btn-primary btn-block' }, mode === 'login' ? 'Inloggen' : 'Account aanmaken'),
    );

    wrap.append(tabs, form);
  }
  paint();

  clear(app);
  app.append(wrap);
}

// ---------- dashboard ----------

async function renderDashboard(epoch) {
  clear(app);
  app.append(el('p', { class: 'loading' }, 'Lijsten laden…'));
  let data;
  try { data = await api('/api/checklists'); }
  catch (err) {
    if (isStale(epoch)) return;
    if (err.status === 401) return navigate('#/login');
    return showError(err);
  }
  if (isStale(epoch)) return;

  clear(app);
  app.append(
    el('div', { class: 'dashboard-header' },
      el('h1', {}, 'Mijn checklists'),
      el('a', { href: '#/new', class: 'btn btn-primary' }, '+ Nieuwe checklist')
    ),
  );

  if (!data.checklists.length) {
    app.append(
      el('div', { class: 'card empty' },
        el('p', {}, 'Nog geen checklists. Maak je eerste lijst voor je volgende vakantie!'),
        el('a', { href: '#/new', class: 'btn btn-primary' }, 'Nieuwe checklist')
      )
    );
    return;
  }

  for (const c of data.checklists) {
    const total = Number(c.total) || 0;
    const done = Number(c.done) || 0;
    const pct = total ? Math.round((done / total) * 100) : 0;
    const dates = (c.start_date || c.end_date)
      ? [fmtDate(c.start_date), fmtDate(c.end_date)].filter(Boolean).join(' – ')
      : '';
    app.append(
      el('a', { href: `#/list/${c.id}`, class: 'card checklist-card' },
        el('div', { class: 'title' }, c.name),
        el('div', { class: 'meta' }, [c.destination, dates].filter(Boolean).join(' • ') || 'Geen details'),
        el('div', { class: 'progress-wrap' },
          el('div', { class: 'progress' }, el('span', { style: `width: ${pct}%` })),
          el('span', {}, `${done}/${total}`)
        )
      )
    );
  }
}

// ---------- shared form (create + edit) ----------

function buildChecklistForm({ initial = {}, mode = 'create', onSubmit, countries: countryList = [], family = [] }) {
  const errBox = el('div', { class: 'error' });

  // Reizigers: gezinsleden (aanvinken) + losse medereizigers (categorie).
  const familySelected = new Map(); // memberId → boolean
  const guests = [];                // { name, category }

  if (initial.travelers && initial.travelers.length) {
    for (const t of initial.travelers) {
      const byId = t.memberId != null ? family.find(m => m.id === t.memberId) : null;
      const byData = !byId && t.birthdate
        ? family.find(m => isoDateOnly(m.birthdate) === isoDateOnly(t.birthdate) && m.name === t.name)
        : null;
      const member = byId || byData;
      if (member) {
        familySelected.set(member.id, true);
      } else if (t.birthdate) {
        // Gezinslid dat inmiddels verwijderd is: bewaar als medereiziger.
        guests.push({ name: t.name || '', category: categoryFromAge(ageFromBirthdate(t.birthdate) ?? 30) });
      } else if (t.category) {
        guests.push({ name: t.name || '', category: t.category });
      } else if (t.age != null) {
        guests.push({ name: t.name || '', category: categoryFromAge(Number(t.age)) });
      } else if (t.name) {
        guests.push({ name: t.name, category: 'volwassene' });
      }
    }
  } else if (mode === 'create') {
    // Nieuwe reis: standaard met het hele gezin.
    for (const m of family) familySelected.set(m.id, true);
    if (!family.length) guests.push({ name: '', category: 'volwassene' });
  }

  const countries = countryList;
  const nameIn = el('input', { type: 'text', required: true, placeholder: 'Bv. Zomervakantie Spanje', value: initial.name || '' });
  const countrySel = el('select', {},
    el('option', { value: '' }, '— Kies land —'),
    ...countries.map(cn =>
      el('option', { value: cn.code, selected: cn.code === (initial.country || '') }, cn.name)
    )
  );
  const destIn = el('input', { type: 'text', placeholder: 'Plaats / regio (optioneel)', value: initial.destination || '' });
  const startIn = el('input', { type: 'date', value: isoDateOnly(initial.startDate) });
  const endIn = el('input', { type: 'date', value: isoDateOnly(initial.endDate) });
  const rentalIn = el('input', { type: 'checkbox', checked: initial.rentalCar === true });

  // Kaart-picker (OpenStreetMap/Leaflet): zoeken of klikken zet de
  // bestemming, en vult land + plaats automatisch in.
  let pickedLat = initial.lat ?? null;
  let pickedLng = initial.lng ?? null;
  const mapDiv = el('div', { class: 'map-box' });
  const mapSearchIn = el('input', { type: 'text', placeholder: 'Zoek je bestemming… (bv. Emmen of Salou)' });
  const mapResults = el('div', { class: 'map-results' });
  const mapHint = el('p', { class: 'muted', style: 'margin: 6px 0 0' },
    'Zoek hierboven of klik op de kaart. Land en plaats worden automatisch ingevuld.');

  function applyPlace(p) {
    if (p.country) countrySel.value = p.country;
    if (p.place) destIn.value = p.place;
  }

  let leafletMap = null;
  let marker = null;
  function setMarker(lat, lng, pan) {
    pickedLat = lat; pickedLng = lng;
    if (!leafletMap) return;
    if (!marker) marker = L.marker([lat, lng]).addTo(leafletMap);
    else marker.setLatLng([lat, lng]);
    if (pan) leafletMap.setView([lat, lng], Math.max(leafletMap.getZoom(), 9));
  }

  function initMap() {
    if (typeof L === 'undefined') {
      mapDiv.textContent = 'Kaart kon niet geladen worden — je kunt land en plaats gewoon handmatig invullen.';
      return;
    }
    leafletMap = L.map(mapDiv).setView(
      pickedLat != null ? [pickedLat, pickedLng] : [52.2, 5.3],
      pickedLat != null ? 9 : 6
    );
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; OpenStreetMap-bijdragers',
    }).addTo(leafletMap);
    if (pickedLat != null) setMarker(pickedLat, pickedLng, false);
    leafletMap.on('click', async (e) => {
      setMarker(e.latlng.lat, e.latlng.lng, false);
      try {
        const r = await api(`/api/geo/reverse?lat=${e.latlng.lat}&lng=${e.latlng.lng}`);
        applyPlace(r);
      } catch { /* handmatig invullen kan altijd */ }
    });
    // Leaflet meet de container pas goed als hij zichtbaar is.
    setTimeout(() => leafletMap.invalidateSize(), 100);
  }
  setTimeout(initMap, 0);

  let searchTimer = null;
  mapSearchIn.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = mapSearchIn.value.trim();
    if (q.length < 2) { clear(mapResults); return; }
    searchTimer = setTimeout(async () => {
      try {
        const r = await api(`/api/geo/search?q=${encodeURIComponent(q)}`);
        clear(mapResults);
        for (const hit of r.results) {
          mapResults.append(el('button', {
            type: 'button', class: 'map-result',
            onclick: () => {
              clear(mapResults);
              mapSearchIn.value = hit.place || hit.label;
              setMarker(hit.lat, hit.lng, true);
              applyPlace(hit);
            },
          }, hit.label));
        }
      } catch { /* zoeken faalt stil; kaartklik werkt nog */ }
    }, 400);
  });

  const transportSel = el('select', {}, ...TRANSPORT.map(o =>
    el('option', { value: o.value, selected: o.value === (initial.transport || '') }, o.label)
  ));
  const accomSel = el('select', {}, ...ACCOMMODATION.map(o =>
    el('option', { value: o.value, selected: o.value === (initial.accommodation || '') }, o.label)
  ));

  // Weather multi-select
  const initWeather = new Set(Array.isArray(initial.weather) ? initial.weather : (initial.weather ? [initial.weather] : []));
  const weatherBox = el('div', { class: 'checkbox-group' },
    ...WEATHER_OPTIONS.map(o =>
      el('label', {},
        el('input', { type: 'checkbox', value: o.value, checked: initWeather.has(o.value) }),
        o.label
      )
    )
  );

  // Activities multi-select
  const initActivities = new Set(Array.isArray(initial.activities) ? initial.activities : []);
  const activitiesBox = el('div', { class: 'checkbox-group' },
    ...ACTIVITIES.map(a =>
      el('label', {},
        el('input', { type: 'checkbox', value: a.value, checked: initActivities.has(a.value) }),
        a.label
      )
    )
  );

  // Quantities (only in create mode — items zijn al gegenereerd in edit)
  let quantitiesSection = null;
  let qInputs = null;
  if (mode === 'create') {
    const Q_KEYS = ['underwear', 'socks', 'tshirts', 'sweaters', 'bottoms'];
    const userTouched = Object.fromEntries(Q_KEYS.map(k => [k, false]));
    qInputs = Object.fromEntries(Q_KEYS.map(k =>
      [k, el('input', { type: 'number', min: '0', max: '99' })]
    ));
    Object.entries(qInputs).forEach(([k, inp]) => {
      inp.addEventListener('input', () => { userTouched[k] = true; });
    });

    function applyDefaults() {
      const days = daysBetweenISO(startIn.value, endIn.value);
      const def = defaultQuantities(days);
      for (const k of Q_KEYS) {
        if (!userTouched[k]) qInputs[k].value = def[k];
      }
    }
    applyDefaults();
    startIn.addEventListener('change', applyDefaults);
    endIn.addEventListener('change', applyDefaults);

    quantitiesSection = el('div', { class: 'card' },
      el('h2', { style: 'margin-top: 0' }, 'Hoeveelheid kleding per persoon'),
      el('p', { class: 'muted', style: 'margin-top: 0' }, 'Suggesties op basis van de reisduur — pas aan naar wens. Op 0 zetten = niet meenemen. Ondergoed/sokken/t-shirts hebben 1 reservestuk meegerekend.'),
      el('div', { class: 'row cols-2' },
        el('div', { class: 'field' }, el('label', {}, 'Ondergoed'), qInputs.underwear),
        el('div', { class: 'field' }, el('label', {}, 'Sokken'), qInputs.socks),
      ),
      el('div', { class: 'row cols-2' },
        el('div', { class: 'field' }, el('label', {}, 'T-shirts'), qInputs.tshirts),
        el('div', { class: 'field' }, el('label', {}, 'Trui / vest'), qInputs.sweaters),
      ),
      el('div', { class: 'field' }, el('label', {}, 'Broeken / rokken'), qInputs.bottoms),
    );
  }

  // Medications (only in create)
  const medsIn = mode === 'create'
    ? el('textarea', { rows: '3', placeholder: 'Eén medicijn per regel, bv.\nIbuprofen 400 mg\nOogdruppels' })
    : null;

  // Travelers UI: gezin aanvinken + medereizigers met leeftijdscategorie.
  const travelersBox = el('div', { class: 'travelers' });
  function paintTravelers() {
    clear(travelersBox);

    if (family.length) {
      const famBox = el('div', { class: 'checkbox-group' });
      for (const m of family) {
        const a = ageFromBirthdate(m.birthdate);
        famBox.append(el('label', {},
          el('input', {
            type: 'checkbox',
            checked: familySelected.get(m.id) === true,
            onchange: (e) => familySelected.set(m.id, e.target.checked),
          }),
          `${m.name} (${a} jr)`,
        ));
      }
      travelersBox.append(
        el('div', { class: 'field' },
          el('label', {}, 'Mijn gezin'),
          famBox,
        ),
      );
    }
    travelersBox.append(
      el('p', { class: 'muted', style: 'margin: 4px 0 12px' },
        family.length ? 'Gezin aanpassen? ' : 'Tip: sla je gezin één keer op, dan staat het bij elke reis klaar. ',
        el('a', { href: '#/gezin' }, 'Beheer je gezin →'),
      ),
    );

    const guestBox = el('div', {});
    guests.forEach((g, i) => {
      const nameIn2 = el('input', {
        type: 'text', placeholder: 'Naam (optioneel)', value: g.name, maxlength: '60',
        oninput: (e) => { guests[i].name = e.target.value; },
      });
      const catSel = el('select', {
        onchange: (e) => { guests[i].category = e.target.value; },
      }, ...TRAVELER_CATEGORIES.map(cat =>
        el('option', { value: cat.value, selected: cat.value === g.category }, cat.label)
      ));
      const removeBtn = el('button', {
        type: 'button', class: 'btn btn-sm btn-ghost', title: 'Verwijderen',
        onclick: () => { guests.splice(i, 1); paintTravelers(); },
      }, '✕');
      guestBox.append(el('div', { class: 'traveler' }, nameIn2, catSel, removeBtn));
    });
    guestBox.append(
      el('button', {
        type: 'button', class: 'btn btn-sm',
        onclick: () => { guests.push({ name: '', category: 'volwassene' }); paintTravelers(); },
      }, '+ Medereiziger toevoegen')
    );
    travelersBox.append(
      el('div', { class: 'field' },
        el('label', {}, 'Medereizigers (worden niet bewaard voor volgende reizen)'),
        guestBox,
      ),
    );
  }
  paintTravelers();

  const form = el('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      errBox.textContent = '';
      const checked = Array.from(activitiesBox.querySelectorAll('input:checked')).map(i => i.value);
      const checkedWeather = Array.from(weatherBox.querySelectorAll('input:checked')).map(i => i.value);
      const cleanTravelers = [
        ...family
          .filter(m => familySelected.get(m.id) === true)
          .map(m => ({ memberId: m.id, name: m.name, birthdate: isoDateOnly(m.birthdate) })),
        ...guests.map(g => ({ name: (g.name || '').trim(), category: g.category })),
      ];
      if (!cleanTravelers.length) {
        errBox.textContent = 'Kies minstens één reiziger (gezinslid of medereiziger).';
        return;
      }
      if (startIn.value && endIn.value && endIn.value < startIn.value) {
        errBox.textContent = 'De terugkomstdatum ligt vóór de vertrekdatum.';
        return;
      }
      const data = {
        name: nameIn.value,
        destination: destIn.value,
        country: countrySel.value,
        startDate: startIn.value,
        endDate: endIn.value,
        travelers: cleanTravelers,
        transport: transportSel.value,
        weather: checkedWeather,
        accommodation: accomSel.value,
        activities: checked,
        rentalCar: rentalIn.checked,
        lat: pickedLat,
        lng: pickedLng,
      };
      if (mode === 'create') {
        data.medications = medsIn.value.split('\n').map(s => s.trim()).filter(Boolean);
        data.quantities = {
          underwear: qInputs.underwear.value,
          socks: qInputs.socks.value,
          tshirts: qInputs.tshirts.value,
          sweaters: qInputs.sweaters.value,
          bottoms: qInputs.bottoms.value,
        };
      }
      // Dubbelklik-bescherming: op de gratis Render-tier kan een request
      // lang duren; knop uit tot het antwoord er is.
      const submitBtn = e.target.querySelector('button[type="submit"]');
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Bezig…'; }
      try { await onSubmit(data); }
      catch (err) { errBox.textContent = err.message; }
      finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = mode === 'create' ? 'Checklist aanmaken' : 'Wijzigingen opslaan';
        }
      }
    },
  },
    el('h1', {}, mode === 'create' ? 'Nieuwe checklist' : 'Checklist bewerken'),
    mode === 'create'
      ? el('p', { class: 'muted' }, 'Vul zoveel mogelijk in — hoe meer details, hoe slimmer de inpaklijst.')
      : el('p', { class: 'muted' }, 'De items op je lijst veranderen niet. Hier pas je alleen de gegevens van de reis aan.'),

    el('div', { class: 'card spaced' },
      el('div', { class: 'field' }, el('label', {}, 'Naam van de reis *'), nameIn),
      el('div', { class: 'field' },
        el('label', {}, 'Bestemming op de kaart'),
        mapSearchIn, mapResults, mapDiv, mapHint,
      ),
      el('div', { class: 'row cols-2' },
        el('div', { class: 'field' }, el('label', {}, 'Land'), countrySel),
        el('div', { class: 'field' }, el('label', {}, 'Plaats / regio'), destIn),
      ),
      el('div', { class: 'row cols-2' },
        el('div', { class: 'field' }, el('label', {}, 'Vertrekdatum'), startIn),
        el('div', { class: 'field' }, el('label', {}, 'Terugkomstdatum'), endIn),
      ),
      el('div', { class: 'row cols-2' },
        el('div', { class: 'field' }, el('label', {}, 'Transport'), transportSel),
        el('div', { class: 'field' },
          el('label', {}, 'Accommodatie'),
          accomSel,
        ),
      ),
      el('label', { class: 'checkbox-inline' },
        rentalIn,
        ' Huurauto op de bestemming'
      ),
    ),

    el('div', { class: 'card' },
      el('h2', { style: 'margin-top: 0' }, 'Reizigers'),
      el('p', { class: 'muted', style: 'margin-top: 0' }, 'Namen komen terug in de items (bv. "Pyjama (Sanne)"). Leeftijden berekenen we automatisch op de vertrekdatum.'),
      travelersBox,
    ),

    el('div', { class: 'card' },
      el('h2', { style: 'margin-top: 0' }, 'Verwacht weer'),
      el('p', { class: 'muted', style: 'margin-top: 0' }, 'Vink alle temperaturen en condities aan die je verwacht. Voor wisselvallig weer kun je meerdere opties aanvinken.'),
      weatherBox,
    ),

    el('div', { class: 'card' },
      el('h2', { style: 'margin-top: 0' }, 'Geplande activiteiten'),
      activitiesBox,
    ),

    quantitiesSection,
    medsIn ? el('div', { class: 'card' },
      el('h2', { style: 'margin-top: 0' }, 'Medicijnen'),
      el('p', { class: 'muted', style: 'margin-top: 0' }, 'Welke medicijnen moeten mee? Eén per regel. Komen als losse items in de checklist.'),
      medsIn,
    ) : null,

    errBox,
    el('div', { class: 'actions' },
      el('a', { href: initial.id ? `#/list/${initial.id}` : '#/', class: 'btn' }, 'Annuleren'),
      el('button', { type: 'submit', class: 'btn btn-primary' }, mode === 'create' ? 'Checklist aanmaken' : 'Wijzigingen opslaan'),
    ),
  );

  return form;
}

async function renderNew(epoch) {
  clear(app);
  app.append(el('p', { class: 'loading' }, 'Laden…'));
  let countries = [], family = [];
  try {
    [countries, family] = await Promise.all([getCountries(), getFamily()]);
  } catch (err) {
    if (err.status === 401) return navigate('#/login');
  }
  if (isStale(epoch)) return;
  clear(app);
  app.append(buildChecklistForm({
    mode: 'create',
    countries,
    family,
    initial: {},
    onSubmit: async (data) => {
      const res = await api('/api/checklists', { method: 'POST', body: data });
      toast('Checklist aangemaakt');
      navigate(`#/list/${res.checklist.id}`);
    },
  }));
}

async function renderEdit(id, epoch) {
  clear(app);
  app.append(el('p', { class: 'loading' }, 'Laden…'));
  let data, countries, family;
  try {
    [data, countries, family] = await Promise.all([
      api(`/api/checklists/${id}`), getCountries(), getFamily(),
    ]);
  } catch (err) {
    if (isStale(epoch)) return;
    if (err.status === 401) return navigate('#/login');
    return showError(err);
  }
  if (isStale(epoch)) return;
  const c = data.checklist;
  clear(app);
  app.append(buildChecklistForm({
    mode: 'edit',
    countries,
    family,
    initial: {
      id: c.id,
      name: c.name,
      destination: c.destination,
      country: c.country,
      startDate: c.start_date,
      endDate: c.end_date,
      travelers: c.travelers,
      transport: c.transport,
      weather: c.weather,
      accommodation: c.accommodation,
      activities: c.activities,
      rentalCar: c.rental_car,
      lat: c.lat,
      lng: c.lng,
    },
    onSubmit: async (formData) => {
      const res = await api(`/api/checklists/${id}`, { method: 'PATCH', body: formData });
      const sug = res.suggestions || [];
      const rem = res.removals || [];
      if (sug.length || rem.length) {
        renderSuggestions(id, sug, rem);
      } else {
        toast('Wijzigingen opgeslagen');
        navigate(`#/list/${id}`);
      }
    },
  }));
}

// Na het bewerken van reisgegevens: laat de gebruiker kiezen welke nieuwe
// suggesties worden toegevoegd en welke overbodig geworden items van de
// lijst mogen.
function renderSuggestions(id, suggestions, removals = []) {
  clear(app);

  function buildSection(entries, defaultChecked) {
    const boxes = [];
    const wrap = el('div', {});
    const groups = {};
    for (const s of entries) {
      (groups[s.category || 'Overig'] = groups[s.category || 'Overig'] || []).push(s);
    }
    for (const [cat, list] of Object.entries(groups)) {
      const ul = el('ul', { class: 'item-list' });
      for (const s of list) {
        const cb = el('input', { type: 'checkbox', checked: defaultChecked });
        boxes.push({ cb, item: s });
        const label = s.quantity > 1 ? `${s.text} (× ${s.quantity})` : s.text;
        ul.append(el('li', { class: 'item' },
          cb,
          el('span', { class: 'text', onclick: () => { cb.checked = !cb.checked; } },
            label,
            s.is_checked ? el('span', { class: 'muted' }, ' — al ingepakt!') : null,
          ),
        ));
      }
      wrap.append(el('div', { class: 'category-group' }, el('h2', {}, cat), ul));
    }
    return { boxes, wrap };
  }

  const addSection = suggestions.length ? buildSection(suggestions, true) : null;
  const removeSection = removals.length ? buildSection(removals, true) : null;

  const applyBtn = el('button', { class: 'btn btn-primary' }, 'Wijzigingen doorvoeren');
  applyBtn.addEventListener('click', async () => {
    applyBtn.disabled = true;
    try {
      const toAdd = addSection ? addSection.boxes.filter(b => b.cb.checked).map(b => b.item) : [];
      const toRemove = removeSection ? removeSection.boxes.filter(b => b.cb.checked).map(b => b.item.id) : [];
      if (toAdd.length) {
        await api(`/api/checklists/${id}/items/bulk`, { method: 'POST', body: { items: toAdd } });
      }
      if (toRemove.length) {
        // remember=false: komen de plannen weer terug, dan mag de generator
        // deze items opnieuw voorstellen.
        await api(`/api/checklists/${id}/items/bulk-delete`, {
          method: 'POST', body: { ids: toRemove, remember: false },
        });
      }
      const parts = [];
      if (toAdd.length) parts.push(`${toAdd.length} toegevoegd`);
      if (toRemove.length) parts.push(`${toRemove.length} verwijderd`);
      if (parts.length) toast(parts.join(', '));
      navigate(`#/list/${id}`);
    } catch (err) {
      applyBtn.disabled = false;
      toast(err.message);
    }
  });

  // Let op: app.append(null) rendert letterlijk de tekst 'null' —
  // voorwaardelijke elementen dus altijd eerst wegfilteren.
  app.append(...[
    el('h1', {}, 'Inpaklijst bijwerken?'),
    el('p', { class: 'muted' },
      'Op basis van je gewijzigde reisgegevens stellen we het volgende voor. ',
      'Vink uit wat je niet wilt — de rest van je lijst blijft ongewijzigd.'),
    addSection ? el('h2', {}, `Spullen erbij (${suggestions.length})`) : null,
    addSection ? addSection.wrap : null,
    removeSection ? el('h2', { class: 'removal-heading' }, `Niet meer nodig (${removals.length})`) : null,
    removeSection ? el('p', { class: 'muted' }, 'Deze items horen bij je oude reisgegevens. Aangevinkt = van de lijst halen.') : null,
    removeSection ? removeSection.wrap : null,
    el('div', { class: 'actions' },
      el('a', { href: `#/list/${id}`, class: 'btn' }, 'Overslaan'),
      applyBtn,
    ),
  ].filter(Boolean));
}

// ---------- checklist view ----------

async function renderChecklist(id, epoch) {
  clear(app);
  app.append(el('p', { class: 'loading' }, 'Checklist laden…'));
  let data;
  try { data = await api(`/api/checklists/${id}`); }
  catch (err) {
    if (isStale(epoch)) return;
    if (err.status === 401) return navigate('#/login');
    if (err.status === 404) {
      clear(app);
      return app.append(el('div', { class: 'empty' },
        'Checklist niet gevonden.', el('br'),
        el('a', { href: '#/' }, 'Terug naar overzicht')
      ));
    }
    return showError(err);
  }
  if (isStale(epoch)) return;

  const c = data.checklist;
  let items = data.items;

  // Alle bekende reizigersnamen: uit het reizigers-formulier + uit items.
  function allTravelerNames() {
    const names = (Array.isArray(c.travelers) ? c.travelers : [])
      .map((t, i) => (t.name && t.name.trim()) || (c.travelers.length > 1 ? `Reiziger ${i + 1}` : null))
      .filter(Boolean);
    for (const n of new Set(items.map(i => i.traveler).filter(Boolean))) {
      if (!names.includes(n)) names.push(n);
    }
    return names;
  }

  // Filter op reiziger: null = alles, '__shared__' = gedeelde items, anders de naam.
  let activeTraveler = null;

  function travelerTabs() {
    const inItems = [...new Set(items.map(i => i.traveler).filter(Boolean))];
    if (!inItems.length) return null;
    // Volgorde van het reizigers-formulier aanhouden.
    const order = (Array.isArray(c.travelers) ? c.travelers : [])
      .map((t, i) => (t.name && t.name.trim()) || `Reiziger ${i + 1}`);
    inItems.sort((a, b) => {
      const ia = order.indexOf(a); const ib = order.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
    const chips = el('div', { class: 'chips no-print' });
    const mk = (label, value) => {
      const btn = el('button', {
        class: 'chip' + (activeTraveler === value ? ' active' : ''),
        onclick: () => {
          activeTraveler = value;
          chips.querySelectorAll('.chip').forEach(x => x.classList.remove('active'));
          btn.classList.add('active');
          // 'Voor wie?' in het toevoeg-formulier volgt de actieve tab.
          newItemTrav.value = (value && value !== '__shared__') ? value : '';
          paintItems();
        },
      }, label);
      return btn;
    };
    chips.append(mk('Alles', null));
    for (const name of inItems) chips.append(mk(name, name));
    chips.append(mk('Gedeeld', '__shared__'));
    return chips;
  }

  function visibleItems() {
    if (activeTraveler === null) return items;
    if (activeTraveler === '__shared__') return items.filter(i => !i.traveler);
    return items.filter(i => i.traveler === activeTraveler);
  }

  const progressBar = el('span', {});
  const progressLabel = el('span', {});

  function paintProgress() {
    const total = items.length;
    const done = items.filter(i => i.is_checked).length;
    const pct = total ? Math.round((done / total) * 100) : 0;
    progressBar.style.width = `${pct}%`;
    progressLabel.textContent = `${done}/${total} ingepakt`;
  }

  const itemsContainer = el('div', { class: 'items-container' });

  // Ingeklapte categorieën onthouden per checklist (alleen op dit apparaat).
  const collapseKey = `vc_collapsed_${c.id}`;
  let collapsedCats;
  try { collapsedCats = new Set(JSON.parse(localStorage.getItem(collapseKey) || '[]')); }
  catch { collapsedCats = new Set(); }
  function saveCollapsed() {
    try { localStorage.setItem(collapseKey, JSON.stringify([...collapsedCats])); } catch {}
  }

  const catCountSpans = new Map();

  function updateCatCount(cat) {
    const span = catCountSpans.get(cat);
    if (!span) return;
    const inCat = visibleItems().filter(i => (i.category || 'Overig') === cat);
    const done = inCat.filter(i => i.is_checked).length;
    span.textContent = `${done}/${inCat.length}`;
    span.classList.toggle('complete', inCat.length > 0 && done === inCat.length);
  }

  function paintItems() {
    clear(itemsContainer);
    catCountSpans.clear();
    const visible = visibleItems();
    if (!visible.length) {
      itemsContainer.append(el('div', { class: 'empty' },
        items.length ? 'Geen items binnen dit filter.' : 'Nog geen items op deze lijst.'));
      return;
    }
    const groups = {};
    for (const it of visible) {
      const cat = it.category || 'Overig';
      (groups[cat] = groups[cat] || []).push(it);
    }
    const cats = Object.keys(groups).sort((a, b) => {
      const ia = CATEGORY_ORDER.indexOf(a); const ib = CATEGORY_ORDER.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });

    for (const cat of cats) {
      const list = el('ul', { class: 'item-list', 'data-category': cat });
      for (const item of groups[cat]) {
        list.append(renderItem(item));
      }
      const countSpan = el('span', { class: 'cat-count' });
      catCountSpans.set(cat, countSpan);

      const group = el('div', { class: 'category-group' + (collapsedCats.has(cat) ? ' collapsed' : '') });
      const header = el('h2', { class: 'cat-header', role: 'button', tabindex: '0' },
        el('span', { class: 'chevron no-print' }, '▸'),
        el('span', { class: 'cat-name' }, cat),
        countSpan,
      );
      const toggle = () => {
        const nowCollapsed = group.classList.toggle('collapsed');
        if (nowCollapsed) collapsedCats.add(cat); else collapsedCats.delete(cat);
        saveCollapsed();
      };
      header.addEventListener('click', toggle);
      header.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
      });

      group.append(header, list);
      itemsContainer.append(group);
      updateCatCount(cat);
    }
    initSortable();
  }

  function renderItem(item) {
    // Werk alle UI-stukjes van deze rij bij op basis van de server-respons.
    const applyState = (updated) => {
      item.is_checked = updated.is_checked;
      item.packed = updated.packed;
      item.quantity = updated.quantity;
      cb.checked = item.is_checked;
      li.classList.toggle('done', item.is_checked);
      if (qtyCount) qtyCount.textContent = `${item.packed}/${item.quantity}`;
      paintProgress();
      updateCatCount(item.category || 'Overig');
    };

    const cb = el('input', {
      type: 'checkbox',
      checked: item.is_checked,
      onchange: async (e) => {
        const checked = e.target.checked;
        try {
          const res = await api(`/api/items/${item.id}`, { method: 'PATCH', body: { is_checked: checked } });
          applyState(res.item);
        } catch (err) {
          e.target.checked = !checked;
          toast(err.message);
        }
      },
    });

    // Teller voor items met aantal > 1: met +/− pak je stuk voor stuk in.
    let qtyCount = null;
    let qtyControls = null;
    if (item.quantity > 1) {
      qtyCount = el('span', { class: 'qty-count' }, `${item.packed}/${item.quantity}`);
      const step = async (delta) => {
        const target = Math.max(0, Math.min(item.quantity, item.packed + delta));
        if (target === item.packed) return;
        try {
          const res = await api(`/api/items/${item.id}`, { method: 'PATCH', body: { packed: target } });
          applyState(res.item);
        } catch (err) { toast(err.message); }
      };
      qtyControls = el('span', { class: 'qty no-print' },
        el('button', { class: 'qty-btn', title: 'Eén minder ingepakt', onclick: (e) => { e.stopPropagation(); step(-1); } }, '−'),
        qtyCount,
        el('button', { class: 'qty-btn', title: 'Eén meer ingepakt', onclick: (e) => { e.stopPropagation(); step(1); } }, '+'),
      );
    }
    const qtyPrint = item.quantity > 1
      ? el('span', { class: 'qty-print' }, `× ${item.quantity}`)
      : null;

    const textSpan = el('span', { class: 'text' }, item.text);
    textSpan.addEventListener('click', () => startInlineEdit(textSpan, item));

    const editBtn = el('button', {
      class: 'icon-btn no-print',
      title: 'Bewerken',
      onclick: (ev) => { ev.stopPropagation(); startInlineEdit(textSpan, item); },
    }, '✎');

    const del = el('button', {
      class: 'icon-btn delete no-print',
      title: 'Verwijderen',
      onclick: async (ev) => {
        ev.stopPropagation();
        if (!confirm(`"${item.text}" verwijderen?`)) return;
        try {
          await api(`/api/items/${item.id}`, { method: 'DELETE' });
          items = items.filter(x => x.id !== item.id);
          paintItems();
          paintProgress();
        } catch (err) { toast(err.message); }
      },
    }, '✕');

    const handle = el('span', { class: 'drag-handle no-print', title: 'Sleep om te herordenen' }, '⋮⋮');

    const li = el('li', {
      class: 'item' + (item.is_checked ? ' done' : ''),
      'data-id': item.id,
    }, handle, cb, textSpan, qtyPrint, qtyControls, editBtn, del);
    return li;
  }

  // Editor onder het item: tekst, voor wie, categorie.
  function startInlineEdit(textSpan, item) {
    const li = textSpan.closest('li');
    if (!li || li.querySelector('.item-editor')) return;

    const textIn = el('input', { type: 'text', value: item.text, maxlength: '200' });
    const travSel = el('select', {},
      el('option', { value: '', selected: !item.traveler }, 'Gedeeld'),
      ...allTravelerNames().map(n =>
        el('option', { value: n, selected: item.traveler === n }, n)),
    );
    const catSel = el('select', {},
      ...[...new Set([...items.map(i => i.category).filter(Boolean), ...STANDARD_CATEGORIES])]
        .map(cat => el('option', { value: cat, selected: cat === item.category }, cat)),
    );

    const editor = el('li', { class: 'item-editor no-print' },
      el('div', { class: 'field' }, el('label', {}, 'Item'), textIn),
      el('div', { class: 'row cols-2' },
        el('div', { class: 'field' }, el('label', {}, 'Voor wie'), travSel),
        el('div', { class: 'field' }, el('label', {}, 'Categorie'), catSel),
      ),
      el('div', { class: 'actions' },
        el('button', { type: 'button', class: 'btn btn-sm', onclick: () => editor.remove() }, 'Annuleren'),
        el('button', {
          type: 'button', class: 'btn btn-sm btn-primary',
          onclick: async (e) => {
            e.target.disabled = true;
            try {
              const res = await api(`/api/items/${item.id}`, {
                method: 'PATCH',
                body: {
                  text: textIn.value.trim() || item.text,
                  traveler: travSel.value || null,
                  category: catSel.value,
                },
              });
              Object.assign(item, res.item);
              paintItems();
              paintProgress();
            } catch (err) {
              e.target.disabled = false;
              toast(err.message);
            }
          },
        }, 'Opslaan'),
      ),
    );
    li.after(editor);
    textIn.focus();
    textIn.select();
    textIn.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); editor.remove(); }
    });
  }

  function initSortable() {
    if (typeof Sortable === 'undefined') return;
    // Herordenen alleen in het 'Alles'-overzicht: in een gefilterde
    // weergave zou de volgorde van verborgen items door elkaar raken.
    if (activeTraveler !== null) return;
    itemsContainer.querySelectorAll('.item-list').forEach(list => {
      Sortable.create(list, {
        handle: '.drag-handle',
        animation: 150,
        ghostClass: 'sortable-ghost',
        onEnd: persistOrder,
      });
    });
  }

  async function persistOrder() {
    if (activeTraveler !== null) return;
    const ids = Array.from(itemsContainer.querySelectorAll('.item')).map(li => Number(li.dataset.id));
    // Update local items array order to match DOM
    const byId = new Map(items.map(i => [i.id, i]));
    items = ids.map(id => byId.get(id)).filter(Boolean);
    items.forEach((it, idx) => { it.position = idx; });
    try { await api(`/api/checklists/${c.id}/reorder`, { method: 'POST', body: { itemIds: ids } }); }
    catch (err) { toast(err.message); }
  }

  // Add item form
  const newItemIn = el('input', { type: 'text', placeholder: 'Item toevoegen…' });
  const newItemQty = el('input', { type: 'number', min: '1', max: '99', value: '1', 'aria-label': 'Aantal', class: 'qty-input', title: 'Aantal' });
  const newItemCat = el('select', { 'aria-label': 'Categorie' });
  const newItemTrav = el('select', { 'aria-label': 'Voor wie', title: 'Voor wie?' },
    el('option', { value: '' }, 'Gedeeld'),
    ...allTravelerNames().map(n => el('option', { value: n }, n)),
  );
  let lastChosenCategory = null;

  function paintCategoryOptions() {
    const used = [...new Set(items.map(i => i.category).filter(Boolean))];
    const all = [...new Set([...used, ...STANDARD_CATEGORIES])];
    const prev = newItemCat.value || lastChosenCategory || 'Overig';
    clear(newItemCat);
    for (const cat of all) {
      newItemCat.append(el('option', { value: cat, selected: cat === prev }, cat));
    }
  }
  paintCategoryOptions();
  newItemCat.addEventListener('change', () => { lastChosenCategory = newItemCat.value; });

  const addForm = el('form', {
    class: 'add-item no-print',
    onsubmit: async (e) => {
      e.preventDefault();
      const text = newItemIn.value.trim();
      if (!text) return;
      const category = newItemCat.value || 'Overig';
      const quantity = Math.max(1, Math.min(99, Number(newItemQty.value) || 1));
      const traveler = newItemTrav.value || undefined;
      try {
        const res = await api(`/api/checklists/${c.id}/items`, {
          method: 'POST', body: { text, category, quantity, traveler },
        });
        items.push(res.item);
        newItemIn.value = '';
        newItemQty.value = '1';
        lastChosenCategory = category;
        paintCategoryOptions();
        paintItems();
        paintProgress();
      } catch (err) { toast(err.message); }
    },
  },
    newItemIn, newItemQty, newItemTrav, newItemCat,
    el('button', { type: 'submit', class: 'btn btn-primary' }, 'Toevoegen')
  );

  // Header
  const dates = (c.start_date || c.end_date)
    ? [fmtDate(c.start_date), fmtDate(c.end_date)].filter(Boolean).join(' – ')
    : '';
  const metaParts = [c.destination, dates].filter(Boolean);

  clear(app);
  app.append(
    el('a', { href: '#/', class: 'btn btn-sm btn-ghost no-print' }, '← Terug'),
    el('div', { class: 'checklist-head' },
      el('div', {},
        el('h1', { class: 'print-title', style: 'margin-top: 8px' }, c.name),
        metaParts.length ? el('div', { class: 'checklist-meta' }, metaParts.join(' • ')) : null,
      ),
      el('div', { class: 'head-actions no-print' },
        (() => {
          if (c.lat == null || c.lng == null) return null;
          // De knop volgt de content-beschikbaarheid: pas klikbaar als er
          // écht iets te tonen is. Dankzij de cache (die ook verouderde
          // versies direct serveert) is dat vrijwel altijd meteen; alleen
          // een gloednieuwe locatie moet eerst voorbereid worden — dan
          // legt de knop uit waarom hij nog even wacht.
          const btn = el('a', {
            href: `#/list/${c.id}/omgeving`,
            class: 'btn btn-sm',
            'aria-disabled': 'true',
            style: 'opacity: 0.5; pointer-events: none;',
            title: 'Omgeving wordt voorbereid…',
          }, '🗺 Omgeving');
          const activate = () => {
            btn.removeAttribute('aria-disabled');
            btn.removeAttribute('title');
            btn.style.opacity = '';
            btn.style.pointerEvents = '';
          };
          let attempts = 0;
          const check = () => {
            if (isStale(epoch)) return;
            api(`/api/geo/nearby/ready?lat=${c.lat}&lng=${c.lng}`)
              .then(r => {
                if (isStale(epoch)) return;
                if (r.ready) return activate();
                // Nog geen content: nu klaarzetten en dán pas activeren.
                return api(`/api/geo/nearby?lat=${c.lat}&lng=${c.lng}`)
                  .then(() => { if (!isStale(epoch)) activate(); });
              })
              .catch(() => {
                if (isStale(epoch)) return;
                if (++attempts < 5) setTimeout(check, 15000);
                else btn.title = 'Omgeving is nu niet beschikbaar — probeer het later';
              });
          };
          check();
          return btn;
        })(),
        el('a', { href: `#/list/${c.id}/edit`, class: 'btn btn-sm' }, 'Aanpassen'),
        el('button', {
          class: 'btn btn-sm',
          onclick: async () => {
            try {
              const res = await api(`/api/checklists/${c.id}/duplicate`, { method: 'POST' });
              toast('Lijst gedupliceerd');
              navigate(`#/list/${res.checklist.id}`);
            } catch (err) { toast(err.message); }
          },
        }, 'Dupliceren'),
        el('button', { class: 'btn btn-sm', onclick: () => window.print() }, 'Afdrukken'),
        el('button', {
          class: 'btn btn-danger btn-sm',
          onclick: async () => {
            if (!confirm(`Checklist "${c.name}" verwijderen? Dit kan niet ongedaan gemaakt worden.`)) return;
            try {
              await api(`/api/checklists/${c.id}`, { method: 'DELETE' });
              try { localStorage.removeItem(collapseKey); } catch {}
              toast('Checklist verwijderd');
              navigate('#/');
            } catch (err) { toast(err.message); }
          },
        }, 'Verwijderen'),
      ),
    ),
    el('div', { class: 'global-progress no-print' },
      el('div', { class: 'progress' }, progressBar),
      progressLabel,
    ),
    // travelerTabs() kan null zijn; append(null) rendert 'null' als tekst.
    ...[travelerTabs()].filter(Boolean),
    addForm,
    itemsContainer,
  );

  paintProgress();
  paintItems();
}

function showError(err) {
  clear(app);
  app.append(el('div', { class: 'card empty' }, `Er ging iets mis: ${err.message}`));
}

// ---------- gezin ----------

async function renderFamily(epoch) {
  clear(app);
  app.append(el('p', { class: 'loading' }, 'Gezin laden…'));
  let members;
  try { members = await getFamily(); }
  catch (err) {
    if (isStale(epoch)) return;
    if (err.status === 401) return navigate('#/login');
    return showError(err);
  }
  if (isStale(epoch)) return;

  clear(app);
  const listBox = el('div', {});

  function paintMembers() {
    clear(listBox);
    if (!members.length) {
      listBox.append(el('div', { class: 'card empty' },
        'Nog geen gezinsleden. Voeg hieronder je gezin toe — dan staan ze bij elke nieuwe reis klaar.'));
      return;
    }
    const ul = el('ul', { class: 'item-list' });
    for (const m of members) {
      const a = ageFromBirthdate(m.birthdate);
      ul.append(el('li', { class: 'item' },
        el('span', { class: 'text', style: 'cursor: default' },
          `${m.name} `, el('span', { class: 'muted' }, `— ${isoDateOnly(m.birthdate)} (${a} jaar)`)),
        el('button', {
          class: 'icon-btn delete',
          title: 'Verwijderen',
          onclick: async () => {
            if (!confirm(`${m.name} uit je gezin verwijderen? Bestaande checklists veranderen niet.`)) return;
            try {
              await api(`/api/family/${m.id}`, { method: 'DELETE' });
              members = members.filter(x => x.id !== m.id);
              paintMembers();
            } catch (err) { toast(err.message); }
          },
        }, '✕'),
      ));
    }
    listBox.append(ul);
  }
  paintMembers();

  const nameIn = el('input', { type: 'text', placeholder: 'Naam', maxlength: '60', required: true });
  const birthIn = el('input', { type: 'date', required: true, max: isoDateOnly(new Date()) });
  const errBox = el('div', { class: 'error' });
  const addForm = el('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      errBox.textContent = '';
      try {
        const res = await api('/api/family', {
          method: 'POST',
          body: { name: nameIn.value, birthdate: birthIn.value },
        });
        members.push(res.member);
        members.sort((a, b) => String(a.birthdate).localeCompare(String(b.birthdate)));
        nameIn.value = ''; birthIn.value = '';
        paintMembers();
      } catch (err) { errBox.textContent = err.message; }
    },
  },
    el('div', { class: 'row cols-2' },
      el('div', { class: 'field' }, el('label', {}, 'Naam'), nameIn),
      el('div', { class: 'field' }, el('label', {}, 'Geboortedatum'), birthIn),
    ),
    errBox,
    el('button', { type: 'submit', class: 'btn btn-primary' }, '+ Gezinslid toevoegen'),
  );

  app.append(
    el('h1', {}, 'Mijn gezin'),
    el('p', { class: 'muted' },
      'Je gezin staat bij elke nieuwe reis klaar om aan te vinken. ',
      'De leeftijd berekenen we automatisch op de vertrekdatum van de reis — zo klopt de paklijst ook als iemand nét jarig is geweest.'),
    listBox,
    el('div', { class: 'card' },
      el('h2', { style: 'margin-top: 0' }, 'Gezinslid toevoegen'),
      addForm,
    ),
  );
}

// ---------- omgevingsadvies ----------

// Welke leeftijdsgroepen zijn er in dit gezelschap? Bepaalt de aanraders.
function fitsTravelers(catKey, travelers) {
  const ages = (travelers || []).map(t => (t.age != null ? t.age : 30));
  const anyKid = ages.some(a => a >= 2 && a < 13);
  const anyTeen = ages.some(a => a >= 13 && a < 18);
  const anySchoolPlus = ages.some(a => a >= 6);
  const anyYoungKid = ages.some(a => a < 13);
  switch (catKey) {
    case 'themepark': return anyKid || anyTeen;
    case 'waterpark': return anyKid || anyTeen;
    case 'pettingzoo': return anyYoungKid;
    case 'museum': return anySchoolPlus;
    default: return true; // dierentuin, aquarium, strand: iedereen
  }
}

async function renderOmgeving(id, epoch) {
  clear(app);
  app.append(el('p', { class: 'loading' },
    'Omgeving verkennen… De eerste keer kan dit even duren; daarna staat het klaar.'));
  let data, geo;
  try {
    data = await api(`/api/checklists/${id}`);
    if (isStale(epoch)) return;
    const c0 = data.checklist;
    if (c0.lat == null || c0.lng == null) {
      clear(app);
      return app.append(el('div', { class: 'card empty' },
        'Deze checklist heeft nog geen kaartlocatie. ',
        el('a', { href: `#/list/${id}/edit` }, 'Kies eerst je bestemming op de kaart.')));
    }
    geo = await api(`/api/geo/nearby?lat=${c0.lat}&lng=${c0.lng}`);
  } catch (err) {
    if (isStale(epoch)) return;
    if (err.status === 401) return navigate('#/login');
    clear(app);
    return app.append(el('div', { class: 'card empty' },
      `De omgevingsinformatie kon niet geladen worden: ${err.message}`, el('br'),
      el('a', { href: `#/list/${id}` }, '← Terug naar de checklist')));
  }
  if (isStale(epoch)) return;

  const c = data.checklist;
  const destination = c.destination;
  const currentActivities = new Set(Array.isArray(c.activities) ? c.activities : []);

  clear(app);
  app.append(
    el('div', { style: 'display: flex; justify-content: space-between; align-items: center; gap: 8px;' },
      el('a', { href: `#/list/${id}`, class: 'btn btn-sm btn-ghost' }, '← Terug'),
      el('button', {
        class: 'btn btn-sm',
        title: 'Haal de omgevingsgegevens opnieuw op',
        onclick: async (e) => {
          const btn = e.target;
          btn.disabled = true;
          btn.textContent = 'Vernieuwen…';
          try {
            await api(`/api/geo/nearby?lat=${c.lat}&lng=${c.lng}&refresh=1`);
            render();
          } catch (err) {
            toast(err.message);
            btn.disabled = false;
            btn.textContent = '🔄 Vernieuwen';
          }
        },
      }, '🔄 Vernieuwen'),
    ),
    el('h1', { style: 'margin-top: 8px' }, `In de buurt van ${c.destination || 'je bestemming'}`),
    el('p', { class: 'muted' },
      'Uitjes binnen ± 35 km van je bestemming, afgestemd op je reisgezelschap. ',
      'Zet iets op je programma, dan zetten we de spullen die je ervoor nodig hebt meteen klaar op je inpaklijst.',
      // Verplichte vermelding wanneer Places-beoordelingen getoond worden.
      geo.categories.some(cat => cat.pois.some(p => p.rating))
        ? el('span', {}, ' Beoordelingen: powered by Google.')
        : null),
  );

  // Grens-hint: buurland dichtbij → dagje over de grens.
  const others = (geo.neighbours || []).filter(n => n.code !== c.country);
  if (others.length) {
    const names = others.map(n => n.name).join(' en ');
    const extra = others.some(n => !n.euro) ? ' Denk aan wat contant geld in de lokale valuta.' : '';
    app.append(el('div', { class: 'card neighbour-hint' },
      el('strong', {}, `🚗 ${names} ligt op een half uur rijden`),
      el('p', { style: 'margin: 6px 0 10px' },
        `Een dagje over de grens is zo gepland. Neem voor iedereen een ID of paspoort mee (staat al op je lijst).${extra}`),
      el('button', {
        class: 'btn btn-sm btn-primary',
        onclick: async (e) => {
          e.target.disabled = true;
          try {
            const acts = [...new Set([...currentActivities, 'daytrip'])];
            const res = await api(`/api/checklists/${id}`, {
              method: 'PATCH',
              body: {
                activities: acts,
                // Land-specifieke grens-items (milieuvignet, contant geld…)
                borderCountries: others.map(n => n.code),
              },
            });
            if ((res.suggestions || []).length || (res.removals || []).length) {
              renderSuggestions(id, res.suggestions || [], res.removals || []);
            } else {
              toast('Dagtrip staat op je programma');
              navigate(`#/list/${id}`);
            }
          } catch (err) { e.target.disabled = false; toast(err.message); }
        },
      }, currentActivities.has('daytrip') ? 'Staat al op je programma' : '+ Plan grens-dagje — vul mijn inpaklijst aan'),
    ));
  }

  if (!geo.categories.length) {
    app.append(el('div', { class: 'card empty' },
      'Geen uitjes gevonden binnen 35 km. Probeer het later opnieuw, of verken de omgeving ter plekke!'));
    return;
  }

  // Aanraders voor dit gezelschap eerst.
  const sorted = [...geo.categories].sort((a, b) =>
    Number(fitsTravelers(b.key, c.travelers)) - Number(fitsTravelers(a.key, c.travelers)));

  // Bijgehouden overgeslagen locaties per checklist (blijft bewaard bij herladen).
  const dismissKey = `poi_dismissed_${id}`;
  const dismissed = new Set(JSON.parse(localStorage.getItem(dismissKey) || '[]'));

  function saveDismissed() {
    localStorage.setItem(dismissKey, JSON.stringify([...dismissed]));
  }

  for (const cat of sorted) {
    const fit = fitsTravelers(cat.key, c.travelers);
    const already = currentActivities.has(cat.activity);

    const poiListEl = el('ul', { class: 'poi-list' });

    const renderPoiList = () => {
      clear(poiListEl);
      const visible = cat.pois.filter(p => !dismissed.has(p.name));
      if (visible.length === 0) {
        poiListEl.append(el('li', { class: 'poi-all-seen' },
          '✓ Je hebt alle locaties in deze buurt bekeken.'));
        return;
      }
      for (const p of visible) {
        const mapsQuery = encodeURIComponent([p.name, destination].filter(Boolean).join(', '));
        const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${mapsQuery}`;
        poiListEl.append(el('li', {},
          el('span', { class: 'poi-name' },
            // De naam linkt naar Google Maps: daar staan reviews, foto's,
            // openingstijden én de navigatie — nuttiger dan de eigen site.
            el('a', {
              href: mapsUrl,
              target: '_blank',
              rel: 'noopener',
              title: `${p.name} openen in Google Maps`,
            }, p.name),
            p.rating
              ? el('span', { class: 'poi-rating', title: `${p.ratingCount || 0} Google-beoordelingen` },
                  ` ⭐ ${p.rating.toFixed(1).replace('.', ',')}`,
                  p.ratingCount ? el('span', { class: 'muted' }, ` (${p.ratingCount.toLocaleString('nl-NL')})`) : null)
              : null),
          el('span', { class: 'poi-dist' }, `${p.distanceKm} km`),
          el('button', {
            class: 'btn btn-sm btn-ghost poi-dismiss',
            title: 'Overslaan — zoek een vervangende locatie',
            'aria-label': `${p.name} overslaan`,
            onclick: () => {
              dismissed.add(p.name);
              saveDismissed();
              renderPoiList();
            },
          }, '×'),
        ));
      }
    };

    renderPoiList();

    const card = el('div', { class: 'card poi-card' },
      el('div', { class: 'poi-head' },
        el('h2', { style: 'margin: 0' }, cat.label),
        fit ? el('span', { class: 'badge-fit' }, 'aanrader voor jullie') : null,
      ),
      el('p', { class: 'muted', style: 'margin: 2px 0 10px' }, `Leuk voor: ${cat.ages}`),
      poiListEl,
      el('button', {
        class: 'btn btn-sm' + (already ? '' : ' btn-primary'),
        disabled: already,
        onclick: async (e) => {
          e.target.disabled = true;
          try {
            const acts = [...new Set([...currentActivities, cat.activity])];
            const res = await api(`/api/checklists/${id}`, { method: 'PATCH', body: { activities: acts } });
            if ((res.suggestions || []).length || (res.removals || []).length) {
              renderSuggestions(id, res.suggestions || [], res.removals || []);
            } else {
              toast('Toegevoegd aan je programma');
              navigate(`#/list/${id}`);
            }
          } catch (err) { e.target.disabled = false; toast(err.message); }
        },
      }, already ? 'Staat al op je programma' : '+ Zet op programma — vul mijn inpaklijst aan'),
    );
    app.append(card);
  }
}

// ---------- routing ----------

// Elke navigatie hoogt de teller op. Een async view die pas ná een
// nieuwe navigatie zijn data binnenkrijgt, is verouderd en mag het
// scherm niet meer aanraken — anders tekent een traag (of mislukt)
// Omgeving-verzoek zijn foutpagina over de checklist heen.
let renderEpoch = 0;
function isStale(epoch) { return epoch !== renderEpoch; }

async function render() {
  const epoch = ++renderEpoch;
  const hash = location.hash || '#/';

  if (!currentUser && hash !== '#/login') {
    try {
      const me = await api('/api/auth/me');
      currentUser = me.user;
      renderNav();
    } catch {
      return navigate('#/login');
    }
    if (isStale(epoch)) return;
  }

  if (hash === '#/login') return renderAuth();
  if (hash === '#/' || hash === '#') return renderDashboard(epoch);
  if (hash === '#/new') return renderNew(epoch);
  const editM = hash.match(/^#\/list\/(\d+)\/edit$/);
  if (editM) return renderEdit(editM[1], epoch);
  const geoM = hash.match(/^#\/list\/(\d+)\/omgeving$/);
  if (geoM) return renderOmgeving(geoM[1], epoch);
  if (hash === '#/gezin') return renderFamily(epoch);
  const m = hash.match(/^#\/list\/(\d+)$/);
  if (m) return renderChecklist(m[1], epoch);
  navigate('#/');
}

window.addEventListener('hashchange', render);
window.addEventListener('DOMContentLoaded', async () => {
  try {
    const me = await api('/api/auth/me');
    currentUser = me.user;
    renderNav();
  } catch {}
  render();
});
