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

// Vaste volgorde voor de categorieën die de generator gebruikt; eigen
// categorieën van de gebruiker komen daarachter. De lijst met kiesbare
// categorieën begint verder leeg: wat je intypt bestaat vanaf dat moment.
const CATEGORY_ORDER = [
  'Documenten', 'Geld', 'Elektronica', 'Kleding', 'Verzorging', 'Reisapotheek',
  'Accommodatie', 'Activiteiten', 'Baby & kids', 'Transport', 'Overig', 'Voor vertrek',
];

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

// Keuzeveld met een '+ Nieuw…'-optie die omschakelt naar vrij typen.
// Een datalist lijkt hetzelfde te kunnen, maar browsers filteren die
// lijst op de ingevulde waarde — met een gekozen naam in het veld viel
// er dus niets meer te kiezen. Een echte dropdown heeft dat niet.
function comboField({ options, value = '', emptyLabel, newLabel, ariaLabel, className }) {
  const NEW = '__nieuw__';
  const select = el('select', { 'aria-label': ariaLabel, class: className || '' });
  const input = el('input', {
    type: 'text', maxlength: '60', hidden: true,
    placeholder: newLabel.replace(/^\+ /, ''), 'aria-label': ariaLabel, class: className || '',
  });
  let typing = false;

  function paintOptions(current) {
    clear(select);
    select.append(el('option', { value: '' }, emptyLabel));
    const opts = options();
    for (const o of opts) select.append(el('option', { value: o }, o));
    if (current && !opts.includes(current)) select.append(el('option', { value: current }, current));
    select.append(el('option', { value: NEW }, newLabel));
    select.value = current || '';
  }
  paintOptions(value);

  const backToSelect = (v) => {
    typing = false;
    input.hidden = true;
    select.hidden = false;
    paintOptions(v || '');
  };
  select.addEventListener('change', () => {
    if (select.value !== NEW) return;
    typing = true;
    input.value = '';
    select.hidden = true;
    input.hidden = false;
    input.focus();
  });
  input.addEventListener('blur', () => { if (!input.value.trim()) backToSelect(''); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); backToSelect(''); }
  });

  return {
    root: el('span', { class: 'combo' }, select, input),
    getValue() { return typing ? input.value.trim() : select.value; },
    setValue(v) { backToSelect(v); },
    refresh() { if (!typing) paintOptions(select.value); },
  };
}

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

// ---------- 'Automatisch vullen'-formulier ----------
// Alle reisvragen bij elkaar op één pagina. De antwoorden sturen de
// generator; de uitkomst komt als voorstellen terug (toevoegen én
// verwijderen) — de lijst zelf blijft van de gebruiker. De kaartlocatie
// hoort hier bewust niet bij: die vraagt de Omgeving-pagina pas.

function buildFillForm({ initial = {}, onSubmit, countries: countryList = [], family = [] }) {
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
  } else {
    // Nog geen reizigers ingevuld: standaard met het hele gezin.
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
  const startIn = el('input', { type: 'date', value: isoDateOnly(initial.startDate) });
  const endIn = el('input', { type: 'date', value: isoDateOnly(initial.endDate) });
  const rentalIn = el('input', { type: 'checkbox', checked: initial.rentalCar === true });

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

  // Hoeveelheden kleding: standaardwaarden volgen de reisduur zolang de
  // gebruiker ze niet zelf aanraakt.
  const Q_KEYS = ['underwear', 'socks', 'tshirts', 'sweaters', 'bottoms'];
  const userTouched = Object.fromEntries(Q_KEYS.map(k => [k, false]));
  const qInputs = Object.fromEntries(Q_KEYS.map(k =>
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

  const quantitiesSection = el('div', { class: 'card' },
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

  const medsIn = el('textarea', { rows: '3', placeholder: 'Eén medicijn per regel, bv.\nIbuprofen 400 mg\nOogdruppels' });

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
        country: countrySel.value,
        startDate: startIn.value,
        endDate: endIn.value,
        travelers: cleanTravelers,
        transport: transportSel.value,
        weather: checkedWeather,
        accommodation: accomSel.value,
        activities: checked,
        rentalCar: rentalIn.checked,
        medications: medsIn.value.split('\n').map(s => s.trim()).filter(Boolean),
        quantities: {
          underwear: qInputs.underwear.value,
          socks: qInputs.socks.value,
          tshirts: qInputs.tshirts.value,
          sweaters: qInputs.sweaters.value,
          bottoms: qInputs.bottoms.value,
        },
      };
      // Dubbelklik-bescherming: op de gratis Render-tier kan een request
      // lang duren; knop uit tot het antwoord er is.
      const submitBtn = e.target.querySelector('button[type="submit"]');
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Bezig…'; }
      try { await onSubmit(data); }
      catch (err) { errBox.textContent = err.message; }
      finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Voorstellen bekijken';
        }
      }
    },
  },
    el('h1', {}, '✨ Automatisch vullen'),
    el('p', { class: 'muted' },
      'Vertel iets over je reis, dan stellen we voor wat er op je lijst bij kan — ',
      'en wat er af kan. Jij kiest per item; niets wordt zomaar gewijzigd.'),

    el('div', { class: 'card spaced' },
      el('div', { class: 'field' }, el('label', {}, 'Naam van de reis *'), nameIn),
      el('div', { class: 'field' }, el('label', {}, 'Land'), countrySel),
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
    el('div', { class: 'card' },
      el('h2', { style: 'margin-top: 0' }, 'Medicijnen'),
      el('p', { class: 'muted', style: 'margin-top: 0' }, 'Welke medicijnen moeten mee? Eén per regel. Komen als losse items in de checklist; wat er al op staat blijft staan.'),
      medsIn,
    ),

    errBox,
    el('div', { class: 'actions' },
      el('a', { href: initial.id ? `#/list/${initial.id}` : '#/', class: 'btn' }, 'Annuleren'),
      el('button', { type: 'submit', class: 'btn btn-primary' }, 'Voorstellen bekijken'),
    ),
  );

  return form;
}

// Nieuwe vakantie: bewust minimaal — een naam en eventueel een sjabloon
// als startpunt. De lijst begint leeg; vullen kan handmatig of via
// 'Automatisch vullen' op de lijst zelf.
async function renderNew(epoch) {
  clear(app);
  app.append(el('p', { class: 'loading' }, 'Laden…'));
  let templates = [];
  try {
    const r = await api('/api/templates');
    templates = r.templates || [];
  } catch (err) {
    if (isStale(epoch)) return;
    if (err.status === 401) return navigate('#/login');
  }
  if (isStale(epoch)) return;

  const errBox = el('div', { class: 'error' });
  const nameIn = el('input', { type: 'text', required: true, placeholder: 'Bv. Zomervakantie Spanje' });
  const tmplSel = el('select', {},
    el('option', { value: '' }, 'Lege lijst — zelf vullen'),
    ...templates.map(t => el('option', { value: String(t.id) }, `${t.name} (${t.count} items)`)),
  );
  const catsCb = el('input', { type: 'checkbox', checked: true });
  const travCb = el('input', { type: 'checkbox', checked: true });

  const form = el('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      errBox.textContent = '';
      const submitBtn = e.target.querySelector('button[type="submit"]');
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Bezig…'; }
      try {
        const res = await api('/api/checklists', {
          method: 'POST',
          body: {
            name: nameIn.value,
            templateId: tmplSel.value || undefined,
            useCategories: catsCb.checked,
            useTravelers: travCb.checked,
          },
        });
        toast('Checklist aangemaakt');
        navigate(`#/list/${res.checklist.id}`);
      } catch (err) {
        errBox.textContent = err.message;
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Checklist aanmaken'; }
      }
    },
  },
    el('h1', {}, 'Nieuwe checklist'),
    el('p', { class: 'muted' },
      'Meer heb je nu niet nodig. Op de lijst zelf kun je items toevoegen, ',
      'de lijst automatisch laten vullen op basis van je reis, en de omgeving verkennen.'),
    el('div', { class: 'card spaced' },
      el('div', { class: 'field' }, el('label', {}, 'Naam van de reis *'), nameIn),
      el('div', { class: 'field' }, el('label', {}, 'Beginnen met'), tmplSel),
      el('div', { class: 'field' },
        el('label', {}, 'Welke functies wil je gebruiken?'),
        el('label', { class: 'checkbox-inline' }, catsCb, ' Categorieën — items gegroepeerd (Kleding, Documenten…)'),
        el('label', { class: 'checkbox-inline' }, travCb, ' Voor wie — items per reiziger'),
        el('p', { class: 'muted', style: 'margin: 4px 0 0' }, 'Later aan of uit te zetten via het ⋯-menu op de lijst.'),
      ),
    ),
    errBox,
    el('div', { class: 'actions' },
      el('a', { href: '#/', class: 'btn' }, 'Annuleren'),
      el('button', { type: 'submit', class: 'btn btn-primary' }, 'Checklist aanmaken'),
    ),
  );

  // Sjabloonbeheer op dezelfde pagina: hier kies je ze, hier ruim je ze op.
  let manageCard = null;
  if (templates.length) {
    const listEl = el('div', {});
    for (const t of templates) {
      const row = el('div', { class: 'traveler' },
        el('span', { style: 'flex: 1' },
          el('a', { href: `#/sjabloon/${t.id}`, title: 'Sjabloon bekijken en bewerken' }, t.name),
          ' ', el('span', { class: 'muted' }, `(${t.count} items)`)),
        el('a', { href: `#/sjabloon/${t.id}`, class: 'btn btn-sm' }, 'Bewerken'),
        el('button', {
          type: 'button', class: 'btn btn-sm btn-ghost', title: 'Sjabloon verwijderen',
          onclick: async (e) => {
            if (!confirm(`Sjabloon "${t.name}" verwijderen? Bestaande lijsten blijven staan.`)) return;
            e.target.disabled = true;
            try {
              await api(`/api/templates/${t.id}`, { method: 'DELETE' });
              row.remove();
              [...tmplSel.options].find(o => o.value === String(t.id))?.remove();
              toast('Sjabloon verwijderd');
            } catch (err) { e.target.disabled = false; toast(err.message); }
          },
        }, '✕'),
      );
      listEl.append(row);
    }
    manageCard = el('div', { class: 'card', style: 'margin-top: 32px' },
      el('h2', { style: 'margin-top: 0' }, 'Mijn sjablonen'),
      el('p', { class: 'muted', style: 'margin-top: 0' },
        'Een sjabloon maak je op een lijst zelf, met de knop "Sjabloon opslaan".'),
      listEl,
    );
  }

  clear(app);
  app.append(...[form, manageCard].filter(Boolean));
}

// Sjabloon bekijken en bewerken: naam, items (tekst, categorie, aantal,
// voor wie), items toevoegen/verwijderen, of het hele sjabloon weggooien.
async function renderTemplate(id, epoch) {
  clear(app);
  app.append(el('p', { class: 'loading' }, 'Laden…'));
  let t;
  try {
    const r = await api(`/api/templates/${id}`);
    t = r.template;
  } catch (err) {
    if (isStale(epoch)) return;
    if (err.status === 401) return navigate('#/login');
    return showError(err);
  }
  if (isStale(epoch)) return;

  const local = (Array.isArray(t.items) ? t.items : []).map(x => ({ ...x }));
  const errBox = el('div', { class: 'error' });
  const nameIn = el('input', { type: 'text', value: t.name, maxlength: '80' });

  // Suggestielijsten uit het sjabloon zelf (vrij typen blijft mogelijk).
  const catListId = `tmplcats-${id}`;
  const travListId = `tmpltrav-${id}`;
  const catDatalist = el('datalist', { id: catListId },
    ...[...new Set(local.map(i => i.category).filter(Boolean))].map(v => el('option', { value: v })));
  const travDatalist = el('datalist', { id: travListId },
    ...[...new Set(local.map(i => i.traveler).filter(Boolean))].map(v => el('option', { value: v })));

  const listEl = el('div', {});
  function paintRows() {
    clear(listEl);
    local.forEach((it, i) => {
      listEl.append(el('div', { class: 'tmpl-row' },
        el('input', {
          type: 'text', value: it.text || '', maxlength: '200', placeholder: 'Item',
          class: 'tmpl-text', oninput: (e) => { local[i].text = e.target.value; },
        }),
        el('input', {
          type: 'text', value: it.category || '', list: catListId, placeholder: 'Categorie',
          class: 'tmpl-cat', oninput: (e) => { local[i].category = e.target.value; },
        }),
        el('input', {
          type: 'number', min: '1', max: '99', value: String(it.quantity || 1),
          class: 'qty-input', title: 'Aantal', 'aria-label': 'Aantal',
          oninput: (e) => { local[i].quantity = Number(e.target.value) || 1; },
        }),
        el('input', {
          type: 'text', value: it.traveler || '', list: travListId, placeholder: 'Voor wie?',
          class: 'tmpl-cat', title: 'Leeg = algemeen',
          oninput: (e) => { local[i].traveler = e.target.value; },
        }),
        el('button', {
          type: 'button', class: 'btn btn-sm btn-ghost', title: 'Item verwijderen',
          onclick: () => { local.splice(i, 1); paintRows(); },
        }, '✕'),
      ));
    });
  }
  paintRows();

  const saveBtn = el('button', { class: 'btn btn-primary' }, 'Sjabloon opslaan');
  saveBtn.addEventListener('click', async () => {
    errBox.textContent = '';
    saveBtn.disabled = true;
    try {
      await api(`/api/templates/${id}`, {
        method: 'PUT',
        body: { name: nameIn.value, items: local },
      });
      toast('Sjabloon opgeslagen');
      navigate('#/new');
    } catch (err) {
      saveBtn.disabled = false;
      errBox.textContent = err.message;
    }
  });

  clear(app);
  app.append(
    el('a', { href: '#/new', class: 'btn btn-sm btn-ghost' }, '← Terug'),
    el('h1', { style: 'margin-top: 8px' }, 'Sjabloon bewerken'),
    el('p', { class: 'muted' },
      'Wijzigingen gelden alleen voor dit sjabloon — lijsten die je er eerder mee maakte veranderen niet mee.'),
    el('div', { class: 'card spaced' },
      el('div', { class: 'field' }, el('label', {}, 'Naam van het sjabloon *'), nameIn),
      el('div', { class: 'field' },
        el('label', {}, `Items (${local.length})`),
        listEl, catDatalist, travDatalist,
      ),
      el('button', {
        class: 'btn btn-sm',
        onclick: () => { local.push({ text: '', category: '', quantity: 1, traveler: null, origin: 'user' }); paintRows(); },
      }, '+ Item'),
    ),
    errBox,
    el('div', { class: 'actions' },
      el('button', {
        class: 'btn btn-danger',
        onclick: async (e) => {
          if (!confirm(`Sjabloon "${t.name}" verwijderen? Bestaande lijsten blijven staan.`)) return;
          e.target.disabled = true;
          try {
            await api(`/api/templates/${id}`, { method: 'DELETE' });
            toast('Sjabloon verwijderd');
            navigate('#/new');
          } catch (err) { e.target.disabled = false; toast(err.message); }
        },
      }, 'Verwijderen'),
      saveBtn,
    ),
  );
}

// 'Automatisch vullen': de reisvragen, los van het aanmaken. Antwoorden
// worden opgeslagen op de checklist; de generator-uitkomst komt terug als
// keuzelijst met toevoegen- en verwijder-voorstellen.
async function renderAutoFill(id, epoch) {
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
  app.append(buildFillForm({
    countries,
    family,
    initial: {
      id: c.id,
      name: c.name,
      country: c.country,
      startDate: c.start_date,
      endDate: c.end_date,
      travelers: c.travelers,
      transport: c.transport,
      weather: c.weather,
      accommodation: c.accommodation,
      activities: c.activities,
      rentalCar: c.rental_car,
    },
    onSubmit: async (formData) => {
      const res = await api(`/api/checklists/${id}`, { method: 'PATCH', body: formData });
      const sug = res.suggestions || [];
      const rem = res.removals || [];
      if (sug.length || rem.length) {
        renderSuggestions(id, sug, rem);
      } else {
        toast('Je lijst dekt deze reis al — geen nieuwe voorstellen');
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

  // Welke functies deze checklist gebruikt (gekozen bij het aanmaken,
  // omschakelbaar via het ⋯-menu). Bepaalt de invoervelden én de
  // groepering — ook op de afdruk, want die drukt dezelfde weergave af:
  //  - categorieën aan → groeperen op categorie; staat 'voor wie' óók
  //    aan, dan komt de naam tussen haakjes achter het item;
  //  - alleen 'voor wie' aan → groeperen per reiziger ('Algemeen' voor
  //    items zonder persoon);
  //  - beide uit → één platte lijst.
  const useCats = c.use_categories !== false;
  const useTrav = c.use_travelers !== false;
  const groupKey = useCats
    ? (it => it.category || 'Overig')
    : (useTrav ? (it => it.traveler || 'Algemeen') : (() => ''));

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
          newItemTrav.setValue((value && value !== '__shared__') ? value : '');
          paintItems();
        },
      }, label);
      return btn;
    };
    chips.append(mk('Alles', null));
    for (const name of inItems) chips.append(mk(name, name));
    chips.append(mk('Algemeen', '__shared__'));
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
    const inCat = visibleItems().filter(i => groupKey(i) === cat);
    const done = inCat.filter(i => i.is_checked).length;
    span.textContent = `${done}/${inCat.length}`;
    span.classList.toggle('complete', inCat.length > 0 && done === inCat.length);
  }

  function paintItems() {
    clear(itemsContainer);
    catCountSpans.clear();
    const visible = visibleItems();
    if (!visible.length) {
      itemsContainer.append(items.length
        ? el('div', { class: 'empty no-print' }, 'Geen items binnen dit filter.')
        : el('div', { class: 'card empty no-print' },
            el('p', {}, 'Je lijst is nog leeg. Voeg hierboven zelf items toe, of laat hem vullen op basis van je reis:'),
            el('a', { href: `#/list/${c.id}/vullen`, class: 'btn btn-primary' }, '✨ Automatisch vullen')));
      return;
    }
    const groups = {};
    for (const it of visible) {
      const g = groupKey(it);
      (groups[g] = groups[g] || []).push(it);
    }
    let cats;
    if (useCats) {
      cats = Object.keys(groups).sort((a, b) => {
        const ia = CATEGORY_ORDER.indexOf(a); const ib = CATEGORY_ORDER.indexOf(b);
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      });
    } else if (useTrav) {
      // Per reiziger, in de volgorde van het reizigersoverzicht;
      // 'Algemeen' (zonder persoon) achteraan.
      const order = allTravelerNames();
      cats = Object.keys(groups).sort((a, b) => {
        if (a === 'Algemeen') return 1;
        if (b === 'Algemeen') return -1;
        const ia = order.indexOf(a); const ib = order.indexOf(b);
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b, 'nl');
      });
    } else {
      cats = Object.keys(groups);
    }

    for (const cat of cats) {
      const list = el('ul', { class: 'item-list', 'data-category': cat });
      for (const item of groups[cat]) {
        list.append(renderItem(item));
      }
      const countSpan = el('span', { class: 'cat-count' });
      catCountSpans.set(cat, countSpan);

      const group = el('div', { class: 'category-group' + (cat && collapsedCats.has(cat) ? ' collapsed' : '') });
      if (cat) {
        const header = el('h2', { class: 'cat-header', role: 'button', tabindex: '0' },
          el('span', { class: 'chevron no-print' }, '▸'),
          el('span', { class: 'cat-name' }, cat),
          countSpan,
          // Hernoemen geldt alleen voor categorieën — een reizigers-kop
          // hernoem je via het 👥-overzicht.
          useCats ? el('button', {
            class: 'icon-btn no-print', title: 'Categorie hernoemen',
            onclick: async (ev) => {
              ev.stopPropagation();
              const to = prompt('Nieuwe naam voor deze categorie:', cat);
              if (to == null) return;
              const cleanName = to.trim().slice(0, 60);
              if (!cleanName || cleanName === cat) return;
              try {
                await api(`/api/checklists/${c.id}/categories/rename`, {
                  method: 'POST', body: { from: cat, to: cleanName },
                });
                for (const it of items) {
                  if ((it.category || 'Overig') === cat) it.category = cleanName;
                }
                paintItems();
                paintCategoryOptions();
                toast('Categorie hernoemd');
              } catch (err) { toast(err.message); }
            },
          }, '✎') : null,
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
        group.append(header);
      }
      group.append(list);
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
      updateCatCount(groupKey(item));
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

    // Beide functies aan → naam tussen haakjes achter het item (de
    // groepering is dan per categorie, dus anders zie je op de afdruk
    // niet van wie iets is).
    const travTag = (useCats && useTrav && item.traveler)
      ? el('span', { class: 'trav-tag' }, `(${item.traveler})`)
      : null;

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
    }, handle, cb, textSpan, travTag, qtyPrint, qtyControls, editBtn, del);
    return li;
  }

  // Editor onder het item: tekst, voor wie, categorie.
  function startInlineEdit(textSpan, item) {
    const li = textSpan.closest('li');
    if (!li || li.querySelector('.item-editor')) return;

    const textIn = el('input', { type: 'text', value: item.text, maxlength: '200' });
    // Dezelfde dropdown-met-'+ Nieuw…' als het toevoeg-formulier.
    const travSel = comboField({
      options: allTravelerNames, value: item.traveler || '',
      emptyLabel: 'Algemeen', newLabel: '+ Nieuwe reiziger…', ariaLabel: 'Voor wie',
    });
    const catSel = comboField({
      options: usedCategories, value: item.category || '',
      emptyLabel: 'Overig', newLabel: '+ Nieuwe categorie…', ariaLabel: 'Categorie',
    });

    const editor = el('li', { class: 'item-editor no-print' },
      el('div', { class: 'field' }, el('label', {}, 'Item'), textIn),
      (useTrav || useCats) ? el('div', { class: 'row cols-2' },
        useTrav ? el('div', { class: 'field' }, el('label', {}, 'Voor wie'), travSel.root) : null,
        useCats ? el('div', { class: 'field' }, el('label', {}, 'Categorie'), catSel.root) : null,
      ) : null,
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
                  traveler: normTraveler(travSel.getValue()) || null,
                  category: catSel.getValue().trim() || 'Overig',
                },
              });
              if (normTraveler(travSel.getValue())) await ensureTraveler(normTraveler(travSel.getValue()));
              Object.assign(item, res.item);
              paintItems();
              paintProgress();
              refreshTabs();
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
  // Categorie en 'voor wie' zijn dropdowns met een '+ Nieuw…'-optie:
  // kies uit wat er is, of typ iets nieuws — dat bestaat vanaf dat
  // moment. Leeg laten = Overig respectievelijk Algemeen.
  function usedCategories() {
    const used = [...new Set(items.map(i => i.category).filter(Boolean))];
    used.sort((a, b) => {
      const ia = CATEGORY_ORDER.indexOf(a); const ib = CATEGORY_ORDER.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b, 'nl');
    });
    return used;
  }
  const newItemCat = comboField({
    options: usedCategories, emptyLabel: 'Overig',
    newLabel: '+ Nieuwe categorie…', ariaLabel: 'Categorie', className: 'cat-input',
  });
  const newItemTrav = comboField({
    options: allTravelerNames, emptyLabel: 'Algemeen',
    newLabel: '+ Nieuwe reiziger…', ariaLabel: 'Voor wie', className: 'cat-input',
  });

  function paintTravelerOptions() { newItemTrav.refresh(); }

  // 'Algemeen' (en het oudere 'Gedeeld') is het gereserveerde woord voor
  // items zonder eigenaar — wie het intypt bedoelt géén reiziger met die naam.
  function normTraveler(v) {
    const s = String(v || '').trim();
    return ['gedeeld', 'algemeen'].includes(s.toLowerCase()) ? '' : s;
  }

  // Onbekende reizigersnaam? Dan bestaat die reiziger vanaf nu — hij komt
  // ook in het 👥-overzicht en (zonder leeftijd) in Automatisch vullen.
  async function ensureTraveler(name) {
    if (!name || ['gedeeld', 'algemeen'].includes(name.toLowerCase())) return;
    if (allTravelerNames().some(n => n.toLowerCase() === name.toLowerCase())) return;
    const list = (Array.isArray(c.travelers) ? c.travelers : [])
      .filter(t => t && (t.name || t.birthdate || t.category || t.age != null));
    list.push({ name });
    try {
      await api(`/api/checklists/${c.id}`, { method: 'PATCH', body: { travelers: list } });
      c.travelers = list;
      paintTravelerOptions();
    } catch { /* de naam staat op het item; de reiziger volgt anders later */ }
  }

  function paintCategoryOptions() { newItemCat.refresh(); }

  const addForm = el('form', {
    class: 'add-item no-print',
    onsubmit: async (e) => {
      e.preventDefault();
      const text = newItemIn.value.trim();
      if (!text) return;
      const category = newItemCat.getValue().trim() || 'Overig';
      const quantity = Math.max(1, Math.min(99, Number(newItemQty.value) || 1));
      const traveler = normTraveler(newItemTrav.getValue()) || undefined;
      try {
        const res = await api(`/api/checklists/${c.id}/items`, {
          method: 'POST', body: { text, category, quantity, traveler },
        });
        if (traveler) await ensureTraveler(traveler);
        // Nieuw getypte waarden worden nu een gewone dropdown-keuze,
        // klaar voor het volgende item.
        newItemCat.setValue(category === 'Overig' ? '' : category);
        newItemTrav.setValue(traveler || '');
        items.push(res.item);
        newItemIn.value = '';
        newItemQty.value = '1';
        paintCategoryOptions();
        paintItems();
        paintProgress();
        refreshTabs();
      } catch (err) { toast(err.message); }
    },
  },
    newItemIn, newItemQty,
    useTrav ? newItemTrav.root : null,
    useCats ? newItemCat.root : null,
    el('button', { type: 'submit', class: 'btn btn-primary' }, 'Toevoegen')
  );

  // Header
  const dates = (c.start_date || c.end_date)
    ? [fmtDate(c.start_date), fmtDate(c.end_date)].filter(Boolean).join(' – ')
    : '';
  const metaParts = [c.destination, dates].filter(Boolean);

  // Alleen op de afdruk: een QR-code die deze lijst op de telefoon opent.
  // Zo is het papier de brug naar digitaal afvinken — reeds afgevinkte
  // items staan op de print ook al aangevinkt.
  const printQr = (() => {
    if (typeof qrcode !== 'function') return null;
    try {
      const qr = qrcode(0, 'M');
      qr.addData(`${location.origin}/#/list/${c.id}`);
      qr.make();
      const box = el('div', { class: 'print-qr' });
      box.innerHTML = qr.createSvgTag({ cellSize: 2, margin: 0, scalable: true });
      box.append(el('span', {}, 'Scan om digitaal af te vinken'));
      return box;
    } catch { return null; }
  })();

  // Reizigers-tabs in een vaste houder, zodat ze ook ná het renderen
  // bijgewerkt kunnen worden (bv. als een item een nieuwe naam meebrengt).
  const tabsSlot = el('div', {});
  function refreshTabs() {
    clear(tabsSlot);
    if (!useTrav) return;
    const t = travelerTabs();
    if (t) tabsSlot.append(t);
  }
  refreshTabs();

  // Reizigers beheren zonder Automatisch vullen: alleen een naam is
  // genoeg om items aan een persoon te kunnen koppelen. Leeftijden zijn
  // pas relevant voor de generator — geboortedatum of leeftijdscategorie
  // van bestaande reizigers blijft hier onaangeroerd. Gezinsleden voeg je
  // met één klik toe (die brengen hun geboortedatum wél stilletjes mee).
  const travelersCard = (() => {
    let local = [];
    const listEl = el('div', {});
    const famBox = el('div', { style: 'margin-top: 8px' });
    let famMembers = null; // null = nog niet geladen

    function fromChecklist() {
      local = (Array.isArray(c.travelers) ? c.travelers : [])
        .filter(t => t && (t.name || t.birthdate || t.category || t.age != null))
        .map(t => ({ ...t }));
    }
    fromChecklist();

    function paintFam() {
      clear(famBox);
      if (!Array.isArray(famMembers)) return;
      if (!famMembers.length) {
        famBox.append(el('span', { class: 'muted' },
          'Tip: sla je gezin één keer op, dan staat het hier klaar. ',
          el('a', { href: '#/gezin' }, 'Beheer je gezin →')));
        return;
      }
      const haveIds = new Set(local.map(t => t.memberId).filter(v => v != null));
      const haveNames = new Set(local.map(t => (t.name || '').trim().toLowerCase()).filter(Boolean));
      const missing = famMembers.filter(m =>
        !haveIds.has(m.id) && !haveNames.has(m.name.trim().toLowerCase()));
      if (!missing.length) {
        famBox.append(el('span', { class: 'muted' }, 'Heel je gezin reist al mee.'));
        return;
      }
      famBox.append(el('span', { class: 'muted' }, 'Uit je gezin: '));
      for (const m of missing) {
        famBox.append(el('button', {
          type: 'button', class: 'btn btn-sm',
          style: 'margin: 2px 4px 2px 0',
          onclick: () => {
            local.push({ memberId: m.id, name: m.name, birthdate: isoDateOnly(m.birthdate) });
            paintLocal();
          },
        }, `+ ${m.name}`));
      }
    }

    async function loadFamily() {
      if (famMembers !== null) return;
      try {
        famMembers = await getFamily();
      } catch { famMembers = []; }
      paintFam();
    }

    function paintLocal() {
      clear(listEl);
      local.forEach((t, i) => {
        listEl.append(el('div', { class: 'traveler' },
          el('input', {
            type: 'text', value: t.name || '', maxlength: '60',
            placeholder: 'Naam',
            oninput: (e) => { local[i].name = e.target.value; },
          }),
          el('button', {
            type: 'button', class: 'btn btn-sm btn-ghost', title: 'Verwijderen',
            onclick: () => { local.splice(i, 1); paintLocal(); },
          }, '✕'),
        ));
      });
      paintFam();
    }
    paintLocal();

    const box = el('div', { class: 'card no-print', hidden: true },
      el('h2', { style: 'margin-top: 0' }, 'Reizigers'),
      el('p', { class: 'muted', style: 'margin-top: 0' },
        'Alleen een naam is genoeg — dan kun je items aan een persoon koppelen. ',
        'Leeftijden doen er pas toe bij Automatisch vullen.'),
      listEl,
      famBox,
      el('div', { class: 'actions' },
        el('button', {
          class: 'btn btn-sm',
          onclick: () => { local.push({ name: '' }); paintLocal(); },
        }, '+ Reiziger'),
        el('button', {
          class: 'btn btn-sm btn-primary',
          onclick: async (e) => {
            e.target.disabled = true;
            try {
              // Voorstellen die hieruit voortkomen tonen we hier niet —
              // daarvoor is Automatisch vullen.
              await api(`/api/checklists/${id}`, {
                method: 'PATCH',
                body: {
                  travelers: local
                    .map(t => ({ ...t, name: (t.name || '').trim() }))
                    // 'Algemeen'/'Gedeeld' is geen persoon — losse regels
                    // met alleen die naam vervallen stilletjes.
                    .filter(t => t.birthdate || t.category || t.age != null
                      || !['gedeeld', 'algemeen'].includes(t.name.toLowerCase())),
                },
              });
              toast('Reizigers opgeslagen');
              render();
            } catch (err) { e.target.disabled = false; toast(err.message); }
          },
        }, 'Opslaan'),
      ),
    );
    // Bij openen: verse stand van de checklist (er kan intussen een
    // reiziger bijgekomen zijn via het item-formulier) + gezin laden.
    box.refreshAndShow = () => {
      fromChecklist();
      paintLocal();
      loadFamily();
      box.hidden = false;
    };
    return box;
  })();

  clear(app);
  app.append(
    el('a', { href: '#/', class: 'btn btn-sm btn-ghost no-print' }, '← Terug'),
    el('div', { class: 'checklist-head' },
      el('div', {},
        el('h1', { class: 'print-title', style: 'margin-top: 8px' }, c.name),
        metaParts.length ? el('div', { class: 'checklist-meta' }, metaParts.join(' • ')) : null,
      ),
      ...[printQr].filter(Boolean),
      el('div', { class: 'head-actions no-print' },
        (() => {
          // Zonder kaartlocatie leidt de knop naar de kaart-stap van de
          // Omgeving-pagina: de locatie kies je pas wanneer je hem nodig
          // hebt. Mét locatie volgt de knop de content-beschikbaarheid:
          // pas klikbaar als er écht iets te tonen is. Dankzij de cache
          // (die ook verouderde versies direct serveert) is dat vrijwel
          // altijd meteen; alleen een gloednieuwe locatie moet eerst
          // voorbereid worden — dan legt de knop uit waarom hij wacht.
          if (c.lat == null || c.lng == null) {
            return el('a', {
              href: `#/list/${c.id}/omgeving`,
              class: 'btn btn-sm',
              title: 'Kies je bestemming op de kaart en verken de omgeving',
            }, '🗺 Omgeving');
          }
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
        useTrav ? el('button', {
          class: 'btn btn-sm',
          title: 'Reizigers toevoegen of verwijderen — alleen een naam is nodig',
          onclick: () => {
            if (travelersCard.hidden) {
              travelersCard.refreshAndShow();
              travelersCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            } else {
              travelersCard.hidden = true;
            }
          },
        }, '👥 Reizigers') : null,
        el('a', { href: `#/list/${c.id}/vullen`, class: 'btn btn-sm' }, '✨ Automatisch vullen'),
        // Secundaire acties achter één ⋯-knop: houdt de kop compact,
        // vooral op mobiel waar elke extra knop een regel kost.
        (() => {
          const menuItem = (label, handler, danger) => el('button', {
            class: danger ? 'danger' : '',
            onclick: (e) => { pop.hidden = true; handler(e); },
          }, label);
          const pop = el('div', { class: 'menu-pop', hidden: true });
          pop.append(
            menuItem('Sjabloon opslaan', async () => {
              const name = prompt('Naam voor het sjabloon:', c.name);
              if (name == null || !name.trim()) return;
              try {
                await api('/api/templates', { method: 'POST', body: { checklistId: c.id, name } });
                toast('Sjabloon opgeslagen — je vindt het bij "Nieuwe checklist"');
              } catch (err) { toast(err.message); }
            }),
            menuItem('Dupliceren', async () => {
              try {
                const res = await api(`/api/checklists/${c.id}/duplicate`, { method: 'POST' });
                toast('Lijst gedupliceerd');
                navigate(`#/list/${res.checklist.id}`);
              } catch (err) { toast(err.message); }
            }),
            menuItem('Afdrukken', () => window.print()),
            // Functies omschakelen: de items blijven staan; alleen de
            // invoervelden en de groepering veranderen mee.
            menuItem(useCats ? 'Categorieën uitzetten' : 'Categorieën aanzetten', async () => {
              try {
                await api(`/api/checklists/${c.id}`, { method: 'PATCH', body: { useCategories: !useCats } });
                render();
              } catch (err) { toast(err.message); }
            }),
            menuItem(useTrav ? "'Voor wie' uitzetten" : "'Voor wie' aanzetten", async () => {
              try {
                await api(`/api/checklists/${c.id}`, { method: 'PATCH', body: { useTravelers: !useTrav } });
                render();
              } catch (err) { toast(err.message); }
            }),
            menuItem('Verwijderen', async () => {
              if (!confirm(`Checklist "${c.name}" verwijderen? Dit kan niet ongedaan gemaakt worden.`)) return;
              try {
                await api(`/api/checklists/${c.id}`, { method: 'DELETE' });
                try { localStorage.removeItem(collapseKey); } catch {}
                toast('Checklist verwijderd');
                navigate('#/');
              } catch (err) { toast(err.message); }
            }, true),
          );
          const btn = el('button', {
            class: 'btn btn-sm', title: 'Meer acties',
            'aria-haspopup': 'true', 'aria-label': 'Meer acties',
          }, '⋯');
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            pop.hidden = !pop.hidden;
            if (!pop.hidden) {
              const close = (ev) => {
                if (!pop.contains(ev.target)) {
                  pop.hidden = true;
                  document.removeEventListener('click', close);
                }
              };
              setTimeout(() => document.addEventListener('click', close), 0);
            }
          });
          return el('div', { class: 'menu-wrap' }, btn, pop);
        })(),
      ),
    ),
    el('div', { class: 'global-progress no-print' },
      el('div', { class: 'progress' }, progressBar),
      progressLabel,
    ),
    travelersCard,
    tabsSlot,
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

// Kaart-stap van de Omgeving-pagina: de bestemming kies je pas op het
// moment dat je hem nodig hebt — niet al bij het aanmaken van de lijst.
// Opslaan zet lat/lng (en plaats + land) op de checklist en laadt daarna
// de omgeving; land en plaats voeden later ook 'Automatisch vullen'.
function renderPickLocation(id, c, epoch) {
  let pickedLat = null;
  let pickedLng = null;
  let pickedPlace = '';
  let pickedCountry = '';

  const mapDiv = el('div', { class: 'map-box' });
  const searchIn = el('input', { type: 'text', placeholder: 'Zoek je bestemming… (bv. Emmen of Salou)' });
  const results = el('div', { class: 'map-results' });
  const chosenLine = el('p', { class: 'muted', style: 'margin: 6px 0 0' },
    'Zoek hierboven of klik op de kaart.');
  const saveBtn = el('button', { class: 'btn btn-primary', disabled: true }, 'Opslaan en omgeving verkennen');

  function setChosen() {
    chosenLine.textContent = pickedPlace
      ? `Gekozen bestemming: ${pickedPlace}`
      : 'Locatie gekozen — sla op om de omgeving te verkennen.';
    saveBtn.disabled = false;
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
      mapDiv.textContent = 'Kaart kon niet geladen worden — zoeken hierboven werkt wel.';
      return;
    }
    leafletMap = L.map(mapDiv).setView([52.2, 5.3], 6);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; OpenStreetMap-bijdragers',
    }).addTo(leafletMap);
    leafletMap.on('click', async (e) => {
      setMarker(e.latlng.lat, e.latlng.lng, false);
      pickedPlace = '';
      setChosen();
      try {
        const r = await api(`/api/geo/reverse?lat=${e.latlng.lat}&lng=${e.latlng.lng}`);
        if (r.place) pickedPlace = r.place;
        if (r.country) pickedCountry = r.country;
        setChosen();
      } catch { /* zonder plaatsnaam kan opslaan ook */ }
    });
    // Leaflet meet de container pas goed als hij zichtbaar is.
    setTimeout(() => leafletMap.invalidateSize(), 100);
  }
  setTimeout(initMap, 0);

  let searchTimer = null;
  searchIn.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = searchIn.value.trim();
    if (q.length < 2) { clear(results); return; }
    searchTimer = setTimeout(async () => {
      try {
        const r = await api(`/api/geo/search?q=${encodeURIComponent(q)}`);
        clear(results);
        for (const hit of r.results) {
          results.append(el('button', {
            type: 'button', class: 'map-result',
            onclick: () => {
              clear(results);
              searchIn.value = hit.place || hit.label;
              pickedPlace = hit.place || hit.label;
              if (hit.country) pickedCountry = hit.country;
              setMarker(hit.lat, hit.lng, true);
              setChosen();
            },
          }, hit.label));
        }
      } catch { /* zoeken faalt stil; kaartklik werkt nog */ }
    }, 400);
  });

  saveBtn.addEventListener('click', async () => {
    if (pickedLat == null) return;
    saveBtn.disabled = true;
    saveBtn.textContent = 'Opslaan…';
    try {
      // Eventuele paklijst-voorstellen door het gewijzigde land tonen we
      // hier bewust niet — daarvoor is 'Automatisch vullen'.
      await api(`/api/checklists/${id}`, {
        method: 'PATCH',
        body: {
          lat: pickedLat,
          lng: pickedLng,
          destination: pickedPlace || c.destination || '',
          country: pickedCountry || c.country || '',
        },
      });
      render(); // opnieuw renderen: nu is er een locatie → omgeving laden
    } catch (err) {
      toast(err.message);
      saveBtn.disabled = false;
      saveBtn.textContent = 'Opslaan en omgeving verkennen';
    }
  });

  clear(app);
  app.append(
    el('a', { href: `#/list/${id}`, class: 'btn btn-sm btn-ghost' }, '← Terug'),
    el('h1', { style: 'margin-top: 8px' }, 'Waar ga je heen?'),
    el('p', { class: 'muted' },
      'Kies je bestemming op de kaart, dan laten we zien wat er in de buurt te doen is. ',
      'De plaats en het land komen ook op je checklist te staan.'),
    el('div', { class: 'card spaced' },
      el('div', { class: 'field' }, searchIn, results, mapDiv, chosenLine),
      el('div', { class: 'actions' }, saveBtn),
    ),
  );
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
      return renderPickLocation(id, c0, epoch);
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
        // Toon de geverifieerde Google-naam als die er is (vaak de
        // officiële: "WILDLANDS Adventure Zoo Emmen"); p.name blijft de
        // OSM-naam en is de sleutel waarop wegklikken onthouden wordt.
        const shownName = p.gname || p.name;
        // Zoek op naam, gericht op de eigen coördinaten van het uitje —
        // niet op de vakantie-plaatsnaam: het uitje ligt vaak in een
        // heel ander dorp ("Aqua Mundo, Zwiggelte" vindt niets).
        const mapsUrl = (p.lat != null && p.lng != null)
          ? `https://www.google.com/maps/search/${encodeURIComponent(shownName)}/@${p.lat},${p.lng},16z`
          : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(shownName)}`;
        poiListEl.append(el('li', {},
          el('span', { class: 'poi-name' },
            // De naam linkt naar Google Maps: daar staan reviews, foto's,
            // openingstijden én de navigatie — nuttiger dan de eigen site.
            el('a', {
              href: mapsUrl,
              target: '_blank',
              rel: 'noopener',
              title: `${shownName} openen in Google Maps`,
            }, shownName),
            p.rating
              ? el('span', { class: 'poi-rating', title: `${p.ratingCount || 0} Google-beoordelingen` },
                  ` ⭐ ${p.rating.toFixed(1).replace('.', ',')}`,
                  p.ratingCount ? el('span', { class: 'muted' }, ` (${p.ratingCount.toLocaleString('nl-NL')})`) : null)
              : null),
          el('span', { class: 'poi-dist' }, `${p.distanceKm} km`),
          el('button', {
            class: 'btn btn-sm btn-ghost poi-dismiss',
            title: 'Overslaan — zoek een vervangende locatie',
            'aria-label': `${shownName} overslaan`,
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
  // /edit is de oude naam van deze pagina — oude bladwijzers blijven werken.
  const fillM = hash.match(/^#\/list\/(\d+)\/(vullen|edit)$/);
  if (fillM) return renderAutoFill(fillM[1], epoch);
  const tmplM = hash.match(/^#\/sjabloon\/(\d+)$/);
  if (tmplM) return renderTemplate(tmplM[1], epoch);
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
