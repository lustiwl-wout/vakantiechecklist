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
  'Documenten', 'Geld', 'Elektronica', 'Kleding', 'Verzorging',
  'Accommodatie', 'Activiteiten', 'Baby & kids', 'Transport', 'Overig',
];

const CATEGORY_ORDER = STANDARD_CATEGORIES;

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
  const dt = new Date(d);
  if (isNaN(dt)) return '';
  return dt.toISOString().slice(0, 10);
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
      el('span', { class: 'who' }, currentUser.email),
      el('button', { class: 'btn btn-sm btn-ghost', onclick: logout }, 'Uitloggen')
    );
  }
}

async function logout() {
  await api('/api/auth/logout', { method: 'POST' });
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

async function renderDashboard() {
  clear(app);
  app.append(el('p', { class: 'loading' }, 'Lijsten laden…'));
  let data;
  try { data = await api('/api/checklists'); }
  catch (err) {
    if (err.status === 401) return navigate('#/login');
    return showError(err);
  }

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

function buildChecklistForm({ initial = {}, mode = 'create', onSubmit }) {
  const errBox = el('div', { class: 'error' });

  const initTravelers = (initial.travelers && initial.travelers.length)
    ? initial.travelers.map(t => ({ name: t.name || '', age: t.age == null ? '' : String(t.age) }))
    : [{ name: '', age: '' }];
  let travelers = initTravelers;

  const nameIn = el('input', { type: 'text', required: true, placeholder: 'Bv. Zomervakantie Spanje', value: initial.name || '' });
  const destIn = el('input', { type: 'text', placeholder: 'Bv. Spanje', value: initial.destination || '' });
  const startIn = el('input', { type: 'date', value: isoDateOnly(initial.startDate) });
  const endIn = el('input', { type: 'date', value: isoDateOnly(initial.endDate) });

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

  // Travelers UI
  const travelersBox = el('div', { class: 'travelers' });
  function paintTravelers() {
    clear(travelersBox);
    travelers.forEach((t, i) => {
      const nameIn2 = el('input', {
        type: 'text', placeholder: 'Naam', value: t.name, maxlength: '60',
        oninput: (e) => { travelers[i].name = e.target.value; },
      });
      const ageIn = el('input', {
        type: 'number', min: '0', max: '120', placeholder: 'Leeftijd', value: t.age,
        oninput: (e) => { travelers[i].age = e.target.value; },
      });
      const removeBtn = el('button', {
        type: 'button', class: 'btn btn-sm btn-ghost', title: 'Verwijderen',
        onclick: () => { travelers.splice(i, 1); if (!travelers.length) travelers.push({ name: '', age: '' }); paintTravelers(); },
      }, '✕');
      travelersBox.append(
        el('div', { class: 'traveler' },
          nameIn2, ageIn,
          travelers.length > 1 ? removeBtn : null,
        )
      );
    });
    travelersBox.append(
      el('button', {
        type: 'button', class: 'btn btn-sm',
        onclick: () => { travelers.push({ name: '', age: '' }); paintTravelers(); },
      }, '+ Reiziger toevoegen')
    );
  }
  paintTravelers();

  const form = el('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      errBox.textContent = '';
      const checked = Array.from(activitiesBox.querySelectorAll('input:checked')).map(i => i.value);
      const checkedWeather = Array.from(weatherBox.querySelectorAll('input:checked')).map(i => i.value);
      const cleanTravelers = travelers
        .map(t => ({ name: (t.name || '').trim(), age: t.age === '' ? null : Number(t.age) }))
        .filter(t => t.name || t.age != null);
      const data = {
        name: nameIn.value,
        destination: destIn.value,
        startDate: startIn.value,
        endDate: endIn.value,
        travelers: cleanTravelers,
        transport: transportSel.value,
        weather: checkedWeather,
        accommodation: accomSel.value,
        activities: checked,
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
      try { await onSubmit(data); }
      catch (err) { errBox.textContent = err.message; }
    },
  },
    el('h1', {}, mode === 'create' ? 'Nieuwe checklist' : 'Checklist bewerken'),
    mode === 'create'
      ? el('p', { class: 'muted' }, 'Vul zoveel mogelijk in — hoe meer details, hoe slimmer de inpaklijst.')
      : el('p', { class: 'muted' }, 'De items op je lijst veranderen niet. Hier pas je alleen de gegevens van de reis aan.'),

    el('div', { class: 'card spaced' },
      el('div', { class: 'field' }, el('label', {}, 'Naam van de reis *'), nameIn),
      el('div', { class: 'row cols-2' },
        el('div', { class: 'field' }, el('label', {}, 'Bestemming (land)'), destIn),
        el('div', { class: 'field' }, el('label', {}, 'Transport'), transportSel),
      ),
      el('div', { class: 'row cols-2' },
        el('div', { class: 'field' }, el('label', {}, 'Vertrekdatum'), startIn),
        el('div', { class: 'field' }, el('label', {}, 'Terugkomstdatum'), endIn),
      ),
      el('div', { class: 'field' },
        el('label', {}, 'Accommodatie'),
        accomSel,
      ),
    ),

    el('div', { class: 'card' },
      el('h2', { style: 'margin-top: 0' }, 'Reizigers'),
      el('p', { class: 'muted', style: 'margin-top: 0' }, 'Naam komt terug in de items (bv. "Pyjama (Sanne)"). Leeftijd is optioneel maar helpt bij baby- en kindspecifieke spullen.'),
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

function renderNew() {
  clear(app);
  app.append(buildChecklistForm({
    mode: 'create',
    initial: {},
    onSubmit: async (data) => {
      const res = await api('/api/checklists', { method: 'POST', body: data });
      toast('Checklist aangemaakt');
      navigate(`#/list/${res.checklist.id}`);
    },
  }));
}

async function renderEdit(id) {
  clear(app);
  app.append(el('p', { class: 'loading' }, 'Laden…'));
  let data;
  try { data = await api(`/api/checklists/${id}`); }
  catch (err) {
    if (err.status === 401) return navigate('#/login');
    return showError(err);
  }
  const c = data.checklist;
  clear(app);
  app.append(buildChecklistForm({
    mode: 'edit',
    initial: {
      id: c.id,
      name: c.name,
      destination: c.destination,
      startDate: c.start_date,
      endDate: c.end_date,
      travelers: c.travelers,
      transport: c.transport,
      weather: c.weather,
      accommodation: c.accommodation,
      activities: c.activities,
    },
    onSubmit: async (formData) => {
      await api(`/api/checklists/${id}`, { method: 'PATCH', body: formData });
      toast('Wijzigingen opgeslagen');
      navigate(`#/list/${id}`);
    },
  }));
}

// ---------- checklist view ----------

async function renderChecklist(id) {
  clear(app);
  app.append(el('p', { class: 'loading' }, 'Checklist laden…'));
  let data;
  try { data = await api(`/api/checklists/${id}`); }
  catch (err) {
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

  const c = data.checklist;
  let items = data.items;

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

  function paintItems() {
    clear(itemsContainer);
    if (!items.length) {
      itemsContainer.append(el('div', { class: 'empty' }, 'Nog geen items op deze lijst.'));
      return;
    }
    const groups = {};
    for (const it of items) {
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
      itemsContainer.append(
        el('div', { class: 'category-group' },
          el('h2', {}, cat),
          list,
        )
      );
    }
    initSortable();
  }

  function renderItem(item) {
    const cb = el('input', {
      type: 'checkbox',
      checked: item.is_checked,
      onchange: async (e) => {
        const checked = e.target.checked;
        try {
          await api(`/api/items/${item.id}`, { method: 'PATCH', body: { is_checked: checked } });
          item.is_checked = checked;
          li.classList.toggle('done', checked);
          paintProgress();
        } catch (err) {
          e.target.checked = !checked;
          toast(err.message);
        }
      },
    });

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
    }, handle, cb, textSpan, editBtn, del);
    return li;
  }

  function startInlineEdit(textSpan, item) {
    if (textSpan.querySelector('input')) return;
    const input = el('input', { type: 'text', value: item.text });
    const original = item.text;
    clear(textSpan);
    textSpan.append(input);
    input.focus();
    input.select();
    let done = false;
    const finish = async (save) => {
      if (done) return;
      done = true;
      const newText = input.value.trim();
      if (!save || !newText || newText === original) {
        textSpan.textContent = original;
        return;
      }
      try {
        await api(`/api/items/${item.id}`, { method: 'PATCH', body: { text: newText } });
        item.text = newText;
        textSpan.textContent = newText;
      } catch (err) {
        toast(err.message);
        textSpan.textContent = original;
      }
    };
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
  }

  function initSortable() {
    if (typeof Sortable === 'undefined') return;
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
  const newItemCat = el('select', { 'aria-label': 'Categorie' });
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
      try {
        const res = await api(`/api/checklists/${c.id}/items`, {
          method: 'POST', body: { text, category },
        });
        items.push(res.item);
        newItemIn.value = '';
        lastChosenCategory = category;
        paintCategoryOptions();
        paintItems();
        paintProgress();
      } catch (err) { toast(err.message); }
    },
  },
    newItemIn, newItemCat,
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

// ---------- routing ----------

async function render() {
  const hash = location.hash || '#/';

  if (!currentUser && hash !== '#/login') {
    try {
      const me = await api('/api/auth/me');
      currentUser = me.user;
      renderNav();
    } catch {
      return navigate('#/login');
    }
  }

  if (hash === '#/login') return renderAuth();
  if (hash === '#/' || hash === '#') return renderDashboard();
  if (hash === '#/new') return renderNew();
  const editM = hash.match(/^#\/list\/(\d+)\/edit$/);
  if (editM) return renderEdit(editM[1]);
  const m = hash.match(/^#\/list\/(\d+)$/);
  if (m) return renderChecklist(m[1]);
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
