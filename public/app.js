// Vakantiechecklist — frontend SPA met hash-routing.

const ACTIVITIES = [
  { value: 'swimming', label: 'Zwemmen' },
  { value: 'beach', label: 'Strand' },
  { value: 'hiking', label: 'Wandelen / hiken' },
  { value: 'cycling', label: 'Fietsen' },
  { value: 'skiing', label: 'Skiën / snowboarden' },
  { value: 'cultural', label: 'Cultuur / steden' },
  { value: 'nightlife', label: 'Uitgaan' },
];

const TRANSPORT = [
  { value: '', label: '— Kies —' },
  { value: 'plane', label: 'Vliegtuig' },
  { value: 'car', label: 'Auto' },
  { value: 'train', label: 'Trein' },
  { value: 'other', label: 'Anders' },
];

const WEATHER = [
  { value: '', label: '— Kies —' },
  { value: 'hot', label: 'Warm / zonnig' },
  { value: 'mild', label: 'Mild' },
  { value: 'cold', label: 'Koud' },
  { value: 'rainy', label: 'Regenachtig' },
];

const ACCOMMODATION = [
  { value: '', label: '— Kies —' },
  { value: 'hotel', label: 'Hotel' },
  { value: 'house', label: 'Vakantiehuis / appartement' },
  { value: 'camping', label: 'Camping' },
  { value: 'hostel', label: 'Hostel' },
  { value: 'family', label: 'Familie / vrienden' },
];

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

// ---------- views ----------

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
      el('div', { class: 'field' },
        el('label', {}, 'E-mailadres'),
        emailIn,
      ),
      el('div', { class: 'field' },
        el('label', {}, 'Wachtwoord'),
        pwIn,
      ),
      errBox,
      el('button', { type: 'submit', class: 'btn btn-primary btn-block' }, mode === 'login' ? 'Inloggen' : 'Account aanmaken'),
    );

    wrap.append(tabs, form);
  }
  paint();

  clear(app);
  app.append(wrap);
}

async function renderDashboard() {
  clear(app);
  app.append(el('p', { class: 'loading' }, 'Lijsten laden…'));
  let data;
  try {
    data = await api('/api/checklists');
  } catch (err) {
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

function renderNew() {
  clear(app);

  let travelers = [{ age: '' }];
  const errBox = el('div', { class: 'error' });

  function paintTravelers(container) {
    clear(container);
    travelers.forEach((t, i) => {
      const ageIn = el('input', {
        type: 'number', min: '0', max: '120',
        placeholder: 'Leeftijd',
        value: t.age,
        oninput: (e) => { travelers[i].age = e.target.value; },
      });
      const removeBtn = el('button', {
        type: 'button',
        class: 'btn btn-sm btn-ghost',
        onclick: () => { travelers.splice(i, 1); if (!travelers.length) travelers.push({ age: '' }); paintTravelers(container); },
      }, '✕');
      container.append(
        el('div', { class: 'traveler' },
          el('span', { class: 'muted', style: 'min-width: 90px' }, `Reiziger ${i + 1}`),
          ageIn,
          travelers.length > 1 ? removeBtn : null,
        )
      );
    });
    container.append(
      el('button', {
        type: 'button',
        class: 'btn btn-sm',
        onclick: () => { travelers.push({ age: '' }); paintTravelers(container); },
      }, '+ Reiziger toevoegen')
    );
  }

  const travelersBox = el('div', { class: 'travelers' });
  paintTravelers(travelersBox);

  const nameIn = el('input', { type: 'text', required: true, placeholder: 'Bv. Zomervakantie Spanje' });
  const destIn = el('input', { type: 'text', placeholder: 'Bv. Spanje' });
  const startIn = el('input', { type: 'date' });
  const endIn = el('input', { type: 'date' });
  const transportSel = el('select', {}, ...TRANSPORT.map(o => el('option', { value: o.value }, o.label)));
  const weatherSel = el('select', {}, ...WEATHER.map(o => el('option', { value: o.value }, o.label)));
  const accomSel = el('select', {}, ...ACCOMMODATION.map(o => el('option', { value: o.value }, o.label)));

  const activitiesBox = el('div', { class: 'checkbox-group' },
    ...ACTIVITIES.map(a =>
      el('label', {},
        el('input', { type: 'checkbox', value: a.value }),
        a.label
      )
    )
  );

  const form = el('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      errBox.textContent = '';
      const checked = Array.from(activitiesBox.querySelectorAll('input:checked')).map(i => i.value);
      const cleanTravelers = travelers
        .map(t => ({ age: t.age === '' ? null : Number(t.age) }))
        .filter(t => t.age == null || (Number.isFinite(t.age) && t.age >= 0));
      try {
        const res = await api('/api/checklists', {
          method: 'POST',
          body: {
            name: nameIn.value,
            destination: destIn.value,
            startDate: startIn.value,
            endDate: endIn.value,
            travelers: cleanTravelers,
            transport: transportSel.value,
            weather: weatherSel.value,
            accommodation: accomSel.value,
            activities: checked,
          },
        });
        toast('Checklist aangemaakt');
        navigate(`#/list/${res.checklist.id}`);
      } catch (err) {
        errBox.textContent = err.message;
      }
    },
  },
    el('h1', {}, 'Nieuwe checklist'),
    el('p', { class: 'muted' }, 'Vul zoveel mogelijk in — hoe meer details, hoe slimmer de inpaklijst.'),

    el('div', { class: 'card spaced' },
      el('div', { class: 'field' },
        el('label', {}, 'Naam van de reis *'),
        nameIn,
      ),
      el('div', { class: 'row cols-2' },
        el('div', { class: 'field' },
          el('label', {}, 'Bestemming (land)'),
          destIn,
        ),
        el('div', { class: 'field' },
          el('label', {}, 'Transport'),
          transportSel,
        ),
      ),
      el('div', { class: 'row cols-2' },
        el('div', { class: 'field' },
          el('label', {}, 'Vertrekdatum'),
          startIn,
        ),
        el('div', { class: 'field' },
          el('label', {}, 'Terugkomstdatum'),
          endIn,
        ),
      ),
      el('div', { class: 'row cols-2' },
        el('div', { class: 'field' },
          el('label', {}, 'Verwacht weer'),
          weatherSel,
        ),
        el('div', { class: 'field' },
          el('label', {}, 'Accommodatie'),
          accomSel,
        ),
      ),
    ),

    el('div', { class: 'card' },
      el('h2', { style: 'margin-top: 0' }, 'Reizigers'),
      el('p', { class: 'muted', style: 'margin-top: 0' }, 'Leeftijd is optioneel maar helpt bij baby- en kindspecifieke spullen.'),
      travelersBox,
    ),

    el('div', { class: 'card' },
      el('h2', { style: 'margin-top: 0' }, 'Geplande activiteiten'),
      activitiesBox,
    ),

    errBox,
    el('div', { class: 'actions' },
      el('a', { href: '#/', class: 'btn' }, 'Annuleren'),
      el('button', { type: 'submit', class: 'btn btn-primary' }, 'Checklist aanmaken'),
    ),
  );

  app.append(form);
}

async function renderChecklist(id) {
  clear(app);
  app.append(el('p', { class: 'loading' }, 'Checklist laden…'));
  let data;
  try {
    data = await api(`/api/checklists/${id}`);
  } catch (err) {
    if (err.status === 401) return navigate('#/login');
    if (err.status === 404) {
      clear(app);
      return app.append(el('div', { class: 'empty' }, 'Checklist niet gevonden.', el('br'), el('a', { href: '#/' }, 'Terug naar overzicht')));
    }
    return showError(err);
  }

  const c = data.checklist;
  let items = data.items;

  function progressInfo() {
    const total = items.length;
    const done = items.filter(i => i.is_checked).length;
    return { total, done, pct: total ? Math.round((done / total) * 100) : 0 };
  }

  const progressBar = el('span', {});
  const progressLabel = el('span', {});

  function paintProgress() {
    const { total, done, pct } = progressInfo();
    progressBar.style.width = `${pct}%`;
    progressLabel.textContent = `${done}/${total} ingepakt`;
  }

  const itemsContainer = el('div', {});

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
    const order = ['Documenten', 'Geld', 'Elektronica', 'Kleding', 'Verzorging', 'Accommodatie', 'Activiteiten', 'Baby & kids', 'Transport', 'Overig'];
    const cats = Object.keys(groups).sort((a, b) => {
      const ia = order.indexOf(a); const ib = order.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });

    for (const cat of cats) {
      const list = el('ul', { class: 'item-list' });
      for (const item of groups[cat]) {
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
        const text = el('span', { class: 'text', onclick: () => cb.click() }, item.text);
        const del = el('button', {
          class: 'delete',
          title: 'Verwijderen',
          onclick: async () => {
            if (!confirm(`"${item.text}" verwijderen?`)) return;
            try {
              await api(`/api/items/${item.id}`, { method: 'DELETE' });
              items = items.filter(x => x.id !== item.id);
              paintItems();
              paintProgress();
            } catch (err) { toast(err.message); }
          },
        }, '✕');
        const li = el('li', { class: 'item' + (item.is_checked ? ' done' : '') }, cb, text, del);
        list.append(li);
      }
      itemsContainer.append(
        el('div', { class: 'category-group' },
          el('h2', {}, cat),
          list,
        )
      );
    }
  }

  // Add item
  const newItemIn = el('input', { type: 'text', placeholder: 'Item toevoegen…' });
  const addForm = el('form', {
    class: 'add-item',
    onsubmit: async (e) => {
      e.preventDefault();
      const text = newItemIn.value.trim();
      if (!text) return;
      try {
        const res = await api(`/api/checklists/${c.id}/items`, { method: 'POST', body: { text } });
        items.push(res.item);
        newItemIn.value = '';
        paintItems();
        paintProgress();
      } catch (err) { toast(err.message); }
    },
  },
    newItemIn,
    el('button', { type: 'submit', class: 'btn btn-primary' }, 'Toevoegen')
  );

  const dates = (c.start_date || c.end_date)
    ? [fmtDate(c.start_date), fmtDate(c.end_date)].filter(Boolean).join(' – ')
    : '';
  const metaParts = [c.destination, dates].filter(Boolean);

  clear(app);
  app.append(
    el('a', { href: '#/', class: 'btn btn-sm btn-ghost' }, '← Terug'),
    el('div', { class: 'checklist-head' },
      el('div', {},
        el('h1', { style: 'margin-top: 8px' }, c.name),
        metaParts.length ? el('div', { class: 'checklist-meta' }, metaParts.join(' • ')) : null,
      ),
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
    el('div', { class: 'global-progress' },
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
