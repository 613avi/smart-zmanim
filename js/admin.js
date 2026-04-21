// Admin UI — edits local copy of data/*.json, saves via workflow_dispatch.

(() => {
  const HEB_MONTHS = ['ניסן','אייר','סיון','תמוז','אב','אלול','תשרי','חשון','כסלו','טבת','שבט','אדר','אדר א׳','אדר ב׳'];

  const DEFAULT_CONFIG = {
    synagogueName: 'בית הכנסת',
    location: { address: '', latitude: 31.778, longitude: 35.235, timezone: 'Asia/Jerusalem', candleLightingMinutes: 18 },
    displayedZmanim: {
      alotHaShachar: true, misheyakir: false, sunrise: true,
      sofZmanShmaMGA: true, sofZmanShma: true,
      sofZmanTfillaMGA: true, sofZmanTfilla: true,
      chatzot: true, minchaGedola: true, minchaKetana: false,
      plagHaMincha: false, sunset: true, tzeit: true,
    },
    zmanimOverrides: {},
    theme: { accent: '#d4af37', background: '#0e1320' },
    design: { theme: 'dark', layout: '3col' },
    rotation: { enabled: false, intervalSeconds: 20 },
  };

  // ---- data normalization ----
  const asArr = (v) => Array.isArray(v) ? v.filter(x => x !== '' && x != null) : (v ? [v] : []);
  function normalizeRoom(room) {
    const wk = room.weekday || {};
    const sh = room.shabbat || {};
    room.weekday = {
      shacharit: [...asArr(wk.shacharit), ...asArr(wk.shacharit2)].map(String),
      mincha:    asArr(wk.mincha).map(String),
      arvit:     asArr(wk.arvit).map(String),
    };
    room.shabbat = {
      kabbalat:            asArr(sh.kabbalat).map(String),
      minchaErevOffsets:   asArr(sh.minchaErevOffsets ?? sh.minchaErevOffset).map(Number).filter(n => !isNaN(n)),
      shacharit:           asArr(sh.shacharit).map(String),
      mincha:              asArr(sh.mincha).map(String),
      arvitMotzashOffsets: asArr(sh.arvitMotzashOffsets ?? sh.arvitMotzashOffset).map(Number).filter(n => !isNaN(n)),
    };
    return room;
  }

  const state = {
    ownerRepo: '',
    token: '',
    password: '',
    data: {
      config: null,
      rooms: { rooms: [] },
      memorial: { entries: [] },
      announcements: { entries: [] },
      specialTimes: { entries: [] },
      zmanimCalendar: { entries: {} },
    },
    dirty: false,
  };

  // ---------- Storage ----------
  const LS_TOKEN = 'sz_token_v1';
  const LS_OWNER = 'sz_owner_v1';

  // ---------- Helpers ----------
  const qs = (s, p=document) => p.querySelector(s);
  const qsa = (s, p=document) => [...p.querySelectorAll(s)];
  const el = (tag, attrs = {}, ...children) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') e.className = v;
      else if (k === 'html') e.innerHTML = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v);
    }
    for (const c of children) {
      if (c == null) continue;
      e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return e;
  };

  function status(msg, kind = '') {
    const bar = qs('#status-bar');
    bar.textContent = msg;
    bar.className = `status-bar show ${kind}`;
    clearTimeout(status._t);
    status._t = setTimeout(() => bar.classList.remove('show'), 4000);
  }

  function markDirty() {
    state.dirty = true;
    qs('#unsaved').classList.add('show');
  }
  function markClean() {
    state.dirty = false;
    qs('#unsaved').classList.remove('show');
  }

  // ---------- Load ----------
  async function loadData() {
    const [owner, repo] = state.ownerRepo.split('/');
    const fetchFile = async (path, fallback) => {
      try {
        return await GitHubAPI.fetchPublicJSON(owner, repo, path);
      } catch (e) {
        console.warn('missing', path, e);
        return fallback;
      }
    };
    state.data.config = await fetchFile('data/config.json', DEFAULT_CONFIG);
    state.data.rooms = await fetchFile('data/rooms.json', { rooms: [] });
    state.data.memorial = await fetchFile('data/memorial.json', { entries: [] });
    state.data.announcements = await fetchFile('data/announcements.json', { entries: [] });
    state.data.specialTimes = await fetchFile('data/special-times.json', { entries: [] });
    state.data.zmanimCalendar = await fetchFile('data/zmanim-calendar.json', { entries: {} });
    // normalize
    if (!state.data.config.location) state.data.config.location = { ...DEFAULT_CONFIG.location };
    if (!state.data.config.displayedZmanim) state.data.config.displayedZmanim = { ...DEFAULT_CONFIG.displayedZmanim };
    if (!state.data.config.zmanimOverrides) state.data.config.zmanimOverrides = {};
    if (!state.data.config.design) state.data.config.design = { theme: 'dark', layout: '3col', style: 'classic' };
    if (!state.data.config.design.style) state.data.config.design.style = 'classic';
    if (!Array.isArray(state.data.rooms.rooms)) state.data.rooms.rooms = [];
    state.data.rooms.rooms = state.data.rooms.rooms.map(normalizeRoom);
    if (!Array.isArray(state.data.memorial.entries)) state.data.memorial.entries = [];
    if (!Array.isArray(state.data.announcements.entries)) state.data.announcements.entries = [];
    if (!Array.isArray(state.data.specialTimes.entries)) state.data.specialTimes.entries = [];
    migrateSpecial();
    if (!state.data.zmanimCalendar || typeof state.data.zmanimCalendar.entries !== 'object' || Array.isArray(state.data.zmanimCalendar.entries)) {
      state.data.zmanimCalendar = { entries: {} };
    }
  }

  // ---------- Login ----------
  async function handleLogin() {
    const ownerRepo = qs('#login-owner').value.trim();
    const token = qs('#login-token').value.trim();
    const password = qs('#login-password').value;
    const msg = qs('#login-msg');
    msg.textContent = '';

    if (!ownerRepo || !ownerRepo.includes('/')) { msg.textContent = 'יש להזין owner/repo'; return; }
    if (!token) { msg.textContent = 'יש להזין GitHub token'; return; }
    if (!password) { msg.textContent = 'יש להזין סיסמת ניהול'; return; }

    qs('#login-btn').disabled = true;
    msg.textContent = 'בודק חיבור...';
    try {
      const [owner, repo] = ownerRepo.split('/');
      await GitHubAPI.validateToken(owner, repo, token);
    } catch (e) {
      msg.textContent = `כשל באימות הטוקן: ${e.message}`;
      qs('#login-btn').disabled = false;
      return;
    }

    state.ownerRepo = ownerRepo;
    state.token = token;
    state.password = password;
    localStorage.setItem(LS_OWNER, ownerRepo);
    localStorage.setItem(LS_TOKEN, token);

    msg.textContent = 'טוען נתונים...';
    try {
      await loadData();
    } catch (e) {
      msg.textContent = `כשל בטעינת נתונים: ${e.message}`;
      qs('#login-btn').disabled = false;
      return;
    }

    qs('#login-view').style.display = 'none';
    qs('#app-view').style.display = '';
    qs('#set-owner').value = ownerRepo;
    renderAll();
    qs('#login-btn').disabled = false;
  }

  function logout() {
    state.password = '';
    state.token = '';
    localStorage.removeItem(LS_TOKEN);
    qs('#login-token').value = '';
    qs('#login-password').value = '';
    qs('#app-view').style.display = 'none';
    qs('#login-view').style.display = '';
  }

  // ---------- Tabs ----------
  function setupTabs() {
    qsa('.tab-bar button').forEach(btn => {
      btn.addEventListener('click', () => {
        qsa('.tab-bar button').forEach(b => b.classList.remove('active'));
        qsa('.tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        qs(`.tab-content[data-tab="${btn.dataset.tab}"]`).classList.add('active');
      });
    });
  }

  // ---------- General ----------
  function renderGeneral() {
    const c = state.data.config;
    qs('#g-name').value = c.synagogueName || '';
    qs('#g-address').value = c.location.address || '';
    qs('#g-lat').value = c.location.latitude ?? '';
    qs('#g-lon').value = c.location.longitude ?? '';
    qs('#g-tz').value = c.location.timezone || 'Asia/Jerusalem';
    qs('#g-candle').value = c.location.candleLightingMinutes ?? 18;

    // Design
    if (qs('#d-theme')) qs('#d-theme').value = c.design?.theme || 'dark';
    if (qs('#d-style')) qs('#d-style').value = c.design?.style || 'classic';
    if (qs('#d-layout')) qs('#d-layout').value = c.design?.layout || '3col';
    if (qs('#d-logo-url')) qs('#d-logo-url').value = c.design?.logoUrl || '';
    if (qs('#d-bg-url')) qs('#d-bg-url').value = c.design?.backgroundUrl || '';
  }
  function bindGeneral() {
    const fields = [
      ['#g-name', (v) => state.data.config.synagogueName = v],
      ['#g-address', (v) => state.data.config.location.address = v],
      ['#g-lat', (v) => state.data.config.location.latitude = parseFloat(v) || 0],
      ['#g-lon', (v) => state.data.config.location.longitude = parseFloat(v) || 0],
      ['#g-tz', (v) => state.data.config.location.timezone = v],
      ['#g-candle', (v) => state.data.config.location.candleLightingMinutes = parseInt(v, 10) || 18],
    ];
    for (const [sel, setter] of fields) {
      qs(sel).addEventListener('input', (e) => { setter(e.target.value); markDirty(); });
    }
    qs('#g-geocode').addEventListener('click', geocodeAddress);

    // Design
    const updatePreview = () => {
      const iframe = qs('#design-preview');
      if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage({
          type: 'PREVIEW_DESIGN',
          theme: qs('#d-theme')?.value || 'dark',
          style: qs('#d-style')?.value || 'classic',
          layout: qs('#d-layout')?.value || '3col',
          logoUrl: qs('#d-logo-url')?.value || '',
          backgroundUrl: qs('#d-bg-url')?.value || ''
        }, '*');
      }
    };

    if (qs('#d-theme')) qs('#d-theme').addEventListener('change', (e) => {
      if (!state.data.config.design) state.data.config.design = {};
      state.data.config.design.theme = e.target.value;
      markDirty();
      updatePreview();
    });
    if (qs('#d-style')) qs('#d-style').addEventListener('change', (e) => {
      if (!state.data.config.design) state.data.config.design = {};
      state.data.config.design.style = e.target.value;
      markDirty();
      updatePreview();
    });
    if (qs('#d-layout')) qs('#d-layout').addEventListener('change', (e) => {
      if (!state.data.config.design) state.data.config.design = {};
      state.data.config.design.layout = e.target.value;
      markDirty();
      updatePreview();
    });
    if (qs('#d-logo-url')) qs('#d-logo-url').addEventListener('input', (e) => {
      if (!state.data.config.design) state.data.config.design = {};
      state.data.config.design.logoUrl = e.target.value;
      markDirty();
      updatePreview();
    });
    if (qs('#d-bg-url')) qs('#d-bg-url').addEventListener('input', (e) => {
      if (!state.data.config.design) state.data.config.design = {};
      state.data.config.design.backgroundUrl = e.target.value;
      markDirty();
      updatePreview();
    });

    // Initial preview setup on load
    const iframe = qs('#design-preview');
    if (iframe) {
        iframe.addEventListener('load', () => updatePreview());
    }
  }
  async function geocodeAddress() {
    const address = qs('#g-address').value.trim();
    const st = qs('#g-geocode-status');
    if (!address) { st.textContent = 'הזינו כתובת'; return; }
    st.textContent = 'מחפש...';
    try {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`;
      const res = await fetch(url, { headers: { 'Accept-Language': 'he' } });
      const data = await res.json();
      if (!data.length) { st.textContent = 'לא נמצא'; return; }
      const { lat, lon, display_name } = data[0];
      qs('#g-lat').value = lat;
      qs('#g-lon').value = lon;
      state.data.config.location.latitude = parseFloat(lat);
      state.data.config.location.longitude = parseFloat(lon);
      if (!state.data.config.location.timezone) {
        qs('#g-tz').value = 'Asia/Jerusalem';
        state.data.config.location.timezone = 'Asia/Jerusalem';
      }
      st.textContent = `נמצא: ${display_name}`;
      markDirty();
    } catch (e) {
      st.textContent = `שגיאה: ${e.message}`;
    }
  }

  // ---------- Zmanim ----------
  const ZMANIM_KEYS = [
    ['alotHaShachar',    'עלות השחר'],
    ['misheyakir',       'משיכיר'],
    ['sunrise',          'הנץ החמה'],
    ['sofZmanShmaMGA',   'סוף זמן ק״ש (מג״א)'],
    ['sofZmanShma',      'סוף זמן ק״ש (גר״א)'],
    ['sofZmanTfillaMGA', 'סוף זמן תפילה (מג״א)'],
    ['sofZmanTfilla',    'סוף זמן תפילה (גר״א)'],
    ['chatzot',          'חצות היום'],
    ['minchaGedola',     'מנחה גדולה'],
    ['minchaKetana',     'מנחה קטנה'],
    ['plagHaMincha',     'פלג המנחה'],
    ['sunset',           'שקיעת החמה'],
    ['tzeit',            'צאת הכוכבים'],
  ];
  // hebcal method map (matches display.js ZMANIM_DEFS)
  const ZMANIM_FN = {
    alotHaShachar:    z => z.alotHaShachar(),
    misheyakir:       z => z.misheyakir(),
    sunrise:          z => z.sunrise(),
    sofZmanShmaMGA:   z => z.sofZmanShmaMGA(),
    sofZmanShma:      z => z.sofZmanShma(),
    sofZmanTfillaMGA: z => z.sofZmanTfillaMGA(),
    sofZmanTfilla:    z => z.sofZmanTfilla(),
    chatzot:          z => z.chatzot(),
    minchaGedola:     z => z.minchaGedola(),
    minchaKetana:     z => z.minchaKetana(),
    plagHaMincha:     z => z.plagHaMincha(),
    sunset:           z => z.sunset(),
    tzeit:            z => z.tzeit(),
  };

  function computeDefaultZmanim() {
    const out = {};
    try {
      const h = window.hebcal;
      if (!h || !h.GeoLocation || !h.Zmanim) return out;
      const loc = state.data.config.location || {};
      const geo = new h.GeoLocation(
        state.data.config.synagogueName || 'site',
        Number(loc.latitude) || 0,
        Number(loc.longitude) || 0,
        0,
        loc.timezone || 'Asia/Jerusalem'
      );
      const z = new h.Zmanim(geo, new Date());
      for (const key of Object.keys(ZMANIM_FN)) {
        try {
          const d = ZMANIM_FN[key](z);
          if (d instanceof Date && !isNaN(d)) {
            out[key] = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
          }
        } catch {}
      }
    } catch {}
    return out;
  }

  function renderZmanim() {
    const grid = qs('#zmanim-grid');
    grid.innerHTML = '';
    const displayed = state.data.config.displayedZmanim || {};
    const overrides = state.data.config.zmanimOverrides || {};
    const defaults = computeDefaultZmanim();
    for (const [key, label] of ZMANIM_KEYS) {
      const row = el('div', { class: 'zmanim-row' });
      const cb = el('input', { type: 'checkbox' });
      cb.checked = !!displayed[key];
      cb.addEventListener('change', () => {
        state.data.config.displayedZmanim[key] = cb.checked;
        markDirty();
      });
      const ov = el('input', { type: 'text', placeholder: defaults[key] || 'HH:MM', maxlength: '5' });
      ov.value = overrides[key] || '';
      ov.style.width = '5.5rem';
      ov.style.direction = 'ltr';
      ov.style.textAlign = 'center';
      ov.addEventListener('input', () => {
        const v = ov.value.trim();
        if (v) state.data.config.zmanimOverrides[key] = v;
        else delete state.data.config.zmanimOverrides[key];
        markDirty();
      });
      const lbl = el('label', {}, cb, el('span', { class: 'zm-label' }, label));
      const defStr = defaults[key] ? `ברירת מחדל: ${defaults[key]}` : '';
      row.appendChild(lbl);
      row.appendChild(el('span', { class: 'zm-default small' }, defStr));
      row.appendChild(ov);
      grid.appendChild(row);
    }
  }

  // ---------- Rooms ----------
  function renderRooms() {
    const list = qs('#rooms-list');
    list.innerHTML = '';
    if (!state.data.rooms.rooms.length) {
      list.appendChild(el('div', { class: 'empty-state' }, 'אין חדרי תפילה — הוסיפו חדר כדי להתחיל.'));
      return;
    }
    for (const room of state.data.rooms.rooms) {
      list.appendChild(renderRoomCard(room));
    }
  }
  function renderRoomCard(room) {
    const card = el('div', { class: 'list-item' });
    const head = el('div', { class: 'head' },
      el('strong', {}, room.name || '(ללא שם)'),
      el('button', { class: 'btn btn-danger btn-sm', onclick: () => {
        if (!confirm(`למחוק את החדר "${room.name}"?`)) return;
        state.data.rooms.rooms = state.data.rooms.rooms.filter(r => r !== room);
        markDirty(); renderRooms();
      }}, 'מחיקה')
    );

    const body = el('div', {});
    const fieldRow = (label, inputEl) => el('div', { class: 'field' }, el('label', {}, label), inputEl);
    const mkInput = (type, value, onchange) => {
      const i = el('input', { type });
      i.value = value ?? '';
      i.addEventListener('input', (e) => { onchange(e.target.value); markDirty(); });
      return i;
    };

    body.appendChild(el('div', { class: 'row' },
      fieldRow('מזהה (id)', mkInput('text', room.id, v => { room.id = v.trim().toLowerCase().replace(/[^a-z0-9-]/g,'-'); })),
      fieldRow('שם להצגה', mkInput('text', room.name, v => { room.name = v; renderRooms(); })),
    ));

    // Multi-minyan builder
    const buildList = (title, arr, opts = {}) => {
      const wrap = el('div', { class: 'minyan-list' });
      wrap.appendChild(el('label', {}, title));
      const rows = el('div', { class: 'minyan-rows' });
      const draw = () => {
        rows.innerHTML = '';
        arr.forEach((val, idx) => {
          const inp = document.createElement('input');
          inp.type = opts.numeric ? 'number' : 'text';
          inp.placeholder = opts.placeholder || 'HH:MM';
          inp.value = val ?? '';
          inp.addEventListener('input', (e) => {
            arr[idx] = opts.numeric ? Number(e.target.value) : e.target.value;
            markDirty();
          });
          const rm = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => {
            arr.splice(idx, 1); markDirty(); draw();
          }}, '×');
          rows.appendChild(el('div', { class: 'minyan-row' }, inp, rm));
        });
        const add = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => {
          arr.push(opts.numeric ? 0 : '');
          markDirty(); draw();
        }}, '+ מניין');
        rows.appendChild(add);
      };
      draw();
      wrap.appendChild(rows);
      if (opts.hint) wrap.appendChild(el('div', { class: 'small' }, opts.hint));
      return wrap;
    };

    body.appendChild(el('h3', {}, 'יום חול'));
    body.appendChild(el('div', { class: 'row-3' },
      buildList('שחרית', room.weekday.shacharit),
      buildList('מנחה',   room.weekday.mincha),
      buildList('ערבית',  room.weekday.arvit),
    ));

    body.appendChild(el('h3', {}, 'שבת'));
    body.appendChild(el('div', { class: 'row-3' },
      buildList('קבלת שבת', room.shabbat.kabbalat, { hint: 'שעה קבועה (אופציונלי)' }),
      buildList('מנחה ערב שבת (דקות מהדלקת נרות)', room.shabbat.minchaErevOffsets, { numeric: true, placeholder: '-15', hint: 'מספר שלילי = לפני הדלקת נרות' }),
      buildList('שחרית שבת', room.shabbat.shacharit),
    ));
    body.appendChild(el('div', { class: 'row-3' },
      buildList('מנחה שבת',  room.shabbat.mincha),
      buildList('ערבית מוצ״ש (דקות אחרי צאה״כ)', room.shabbat.arvitMotzashOffsets, { numeric: true, placeholder: '30' }),
      el('div'),
    ));

    card.appendChild(head);
    card.appendChild(body);
    return card;
  }

  // ---------- Memorial ----------
  function renderMemorial() {
    const tbody = qs('#mem-table tbody');
    tbody.innerHTML = '';
    for (const entry of state.data.memorial.entries) {
      tbody.appendChild(renderMemRow(entry));
    }
  }
  function renderMemRow(entry) {
    const tr = document.createElement('tr');
    const mkTd = (field, type='text') => {
      const td = document.createElement('td');
      const input = document.createElement('input');
      input.type = type;
      input.value = entry[field] ?? '';
      input.addEventListener('input', (e) => { entry[field] = type === 'number' ? Number(e.target.value) : e.target.value; markDirty(); });
      td.appendChild(input);
      return td;
    };
    tr.appendChild(mkTd('name'));
    tr.appendChild(mkTd('hebrewDay', 'number'));
    // month as select
    const tdMonth = document.createElement('td');
    const sel = document.createElement('select');
    sel.appendChild(el('option', { value: '' }, '—'));
    for (const m of HEB_MONTHS) sel.appendChild(el('option', { value: m }, m));
    sel.value = entry.hebrewMonth || '';
    sel.addEventListener('change', () => { entry.hebrewMonth = sel.value; markDirty(); });
    tdMonth.appendChild(sel);
    tr.appendChild(tdMonth);
    tr.appendChild(mkTd('notes'));
    const tdAct = document.createElement('td');
    tdAct.className = 'col-actions';
    const del = el('button', { class: 'btn btn-danger btn-sm', onclick: () => {
      state.data.memorial.entries = state.data.memorial.entries.filter(e => e !== entry);
      markDirty(); renderMemorial();
    }}, '×');
    tdAct.appendChild(del);
    tr.appendChild(tdAct);
    return tr;
  }

  // ---------- Announcements ----------
  function renderAnnouncements() {
    const tbody = qs('#ann-table tbody');
    tbody.innerHTML = '';
    for (const a of state.data.announcements.entries) {
      tbody.appendChild(renderAnnRow(a));
    }
  }
  function renderAnnRow(a) {
    const tr = document.createElement('tr');
    const mkTd = (field, type='text') => {
      const td = document.createElement('td');
      const input = document.createElement('input');
      input.type = type;
      input.value = a[field] ?? '';
      input.addEventListener('input', (e) => { a[field] = e.target.value; markDirty(); });
      td.appendChild(input);
      return td;
    };
    tr.appendChild(mkTd('text'));
    tr.appendChild(mkTd('startDate', 'date'));
    tr.appendChild(mkTd('endDate', 'date'));
    const tdAct = document.createElement('td');
    tdAct.className = 'col-actions';
    tdAct.appendChild(el('button', { class: 'btn btn-danger btn-sm', onclick: () => {
      state.data.announcements.entries = state.data.announcements.entries.filter(e => e !== a);
      markDirty(); renderAnnouncements();
    }}, '×'));
    tr.appendChild(tdAct);
    return tr;
  }

  // ---------- Special events ----------
  const HOLIDAY_PRESETS = [
    { name: 'ראש השנה א׳',    day: 1,  month: 'תשרי' },
    { name: 'ראש השנה ב׳',    day: 2,  month: 'תשרי' },
    { name: 'יום הכיפורים',    day: 10, month: 'תשרי' },
    { name: 'סוכות א׳',        day: 15, month: 'תשרי' },
    { name: 'שמיני עצרת',      day: 22, month: 'תשרי' },
    { name: 'שמחת תורה',       day: 23, month: 'תשרי' },
    { name: 'חנוכה א׳',        day: 25, month: 'כסלו' },
    { name: 'ט״ו בשבט',        day: 15, month: 'שבט' },
    { name: 'פורים',           day: 14, month: 'אדר' },
    { name: 'שושן פורים',      day: 15, month: 'אדר' },
    { name: 'פסח א׳',          day: 15, month: 'ניסן' },
    { name: 'שביעי של פסח',    day: 21, month: 'ניסן' },
    { name: 'ל״ג בעומר',       day: 18, month: 'אייר' },
    { name: 'יום ירושלים',     day: 28, month: 'אייר' },
    { name: 'שבועות',          day: 6,  month: 'סיון' },
    { name: 'צום י״ז בתמוז',   day: 17, month: 'תמוז' },
    { name: 'תשעה באב',        day: 9,  month: 'אב' },
  ];

  function migrateSpecial() {
    let arr = state.data.specialTimes.entries || [];
    if (arr.length && arr[0] && (Array.isArray(arr[0].times) || arr[0].dateType)) {
      // Already events
      state.data.specialTimes.entries = arr.map(ev => ({
        id: ev.id || String(Math.random()).slice(2),
        name: ev.name || '',
        dateType: ev.dateType === 'hebrew' ? 'hebrew' : 'gregorian',
        date: ev.date || '',
        hebrewDay: Number(ev.hebrewDay) || 0,
        hebrewMonth: ev.hebrewMonth || '',
        times: Array.isArray(ev.times) ? ev.times : [],
      }));
      return;
    }
    // Flat legacy rows → group by date
    const groups = new Map();
    for (const r of arr) {
      const key = r.date || '';
      if (!groups.has(key)) groups.set(key, {
        id: String(Math.random()).slice(2),
        name: '',
        dateType: 'gregorian',
        date: key,
        hebrewDay: 0,
        hebrewMonth: '',
        times: [],
      });
      groups.get(key).times.push({ roomId: r.roomId || '', label: r.label || '', time: r.time || '' });
    }
    state.data.specialTimes.entries = [...groups.values()];
  }

  function renderSpecial() {
    const host = qs('#sp-list');
    host.innerHTML = '';
    if (!state.data.specialTimes.entries.length) {
      host.appendChild(el('div', { class: 'empty-state' }, 'אין אירועים — הוסיפו אירוע (חג/תאריך מיוחד).'));
      return;
    }
    for (const ev of state.data.specialTimes.entries) {
      host.appendChild(renderEventCard(ev));
    }
  }

  function renderEventCard(ev) {
    const card = el('div', { class: 'list-item' });
    const head = el('div', { class: 'head' },
      el('strong', {}, ev.name || '(ללא שם)'),
      el('button', { class: 'btn btn-danger btn-sm', onclick: () => {
        state.data.specialTimes.entries = state.data.specialTimes.entries.filter(e => e !== ev);
        markDirty(); renderSpecial();
      }}, 'מחיקה')
    );

    const body = el('div', {});
    const nameInp = document.createElement('input');
    nameInp.type = 'text';
    nameInp.placeholder = 'שם האירוע (למשל: שבועות)';
    nameInp.value = ev.name || '';
    nameInp.addEventListener('input', () => {
      ev.name = nameInp.value;
      head.querySelector('strong').textContent = ev.name || '(ללא שם)';
      markDirty();
    });
    body.appendChild(el('div', { class: 'field' }, el('label', {}, 'שם'), nameInp));

    // Preset
    const preset = document.createElement('select');
    preset.appendChild(el('option', { value: '' }, '— חג מוכן (אופציונלי) —'));
    for (const h of HOLIDAY_PRESETS) preset.appendChild(el('option', { value: h.name }, h.name));
    preset.addEventListener('change', () => {
      const p = HOLIDAY_PRESETS.find(h => h.name === preset.value);
      if (!p) return;
      ev.name = p.name;
      ev.dateType = 'hebrew';
      ev.hebrewDay = p.day;
      ev.hebrewMonth = p.month;
      nameInp.value = p.name;
      head.querySelector('strong').textContent = p.name;
      markDirty();
      renderSpecial(); // re-render to reflect new dateType selection
    });
    body.appendChild(el('div', { class: 'field' }, el('label', {}, 'מילוי מהיר לפי חג'), preset));

    // Date type
    const dtWrap = el('div', { class: 'field' });
    dtWrap.appendChild(el('label', {}, 'סוג תאריך'));
    const dtSel = document.createElement('select');
    dtSel.appendChild(el('option', { value: 'hebrew' }, 'תאריך עברי'));
    dtSel.appendChild(el('option', { value: 'gregorian' }, 'תאריך לועזי'));
    dtSel.value = ev.dateType === 'gregorian' ? 'gregorian' : 'hebrew';
    dtSel.addEventListener('change', () => {
      ev.dateType = dtSel.value;
      markDirty();
      renderSpecial();
    });
    dtWrap.appendChild(dtSel);
    body.appendChild(dtWrap);

    if (ev.dateType === 'gregorian') {
      const di = document.createElement('input');
      di.type = 'date';
      di.value = ev.date || '';
      di.addEventListener('input', () => { ev.date = di.value; markDirty(); });
      body.appendChild(el('div', { class: 'field' }, el('label', {}, 'תאריך לועזי'), di));
    } else {
      const dayInp = document.createElement('input');
      dayInp.type = 'number';
      dayInp.min = '1'; dayInp.max = '30';
      dayInp.value = ev.hebrewDay || '';
      dayInp.addEventListener('input', () => { ev.hebrewDay = Number(dayInp.value) || 0; markDirty(); });
      const monthSel = document.createElement('select');
      monthSel.appendChild(el('option', { value: '' }, '—'));
      for (const m of HEB_MONTHS) monthSel.appendChild(el('option', { value: m }, m));
      monthSel.value = ev.hebrewMonth || '';
      monthSel.addEventListener('change', () => { ev.hebrewMonth = monthSel.value; markDirty(); });
      body.appendChild(el('div', { class: 'row' },
        el('div', { class: 'field' }, el('label', {}, 'יום עברי'), dayInp),
        el('div', { class: 'field' }, el('label', {}, 'חודש עברי'), monthSel),
      ));
    }

    // Times list
    body.appendChild(el('h3', {}, 'זמני תפילה לאירוע'));
    const timesHost = el('div', { class: 'sp-times' });
    const drawTimes = () => {
      timesHost.innerHTML = '';
      (ev.times || []).forEach((t, idx) => {
        const roomSel = document.createElement('select');
        roomSel.appendChild(el('option', { value: '' }, 'כל החדרים'));
        for (const r of state.data.rooms.rooms) roomSel.appendChild(el('option', { value: r.id }, r.name));
        roomSel.value = t.roomId || '';
        roomSel.addEventListener('change', () => { t.roomId = roomSel.value; markDirty(); });
        const labelInp = document.createElement('input');
        labelInp.type = 'text';
        labelInp.placeholder = 'שם התפילה (למשל: שחרית)';
        labelInp.value = t.label || '';
        labelInp.addEventListener('input', () => { t.label = labelInp.value; markDirty(); });
        const timeInp = document.createElement('input');
        timeInp.type = 'text';
        timeInp.placeholder = 'HH:MM';
        timeInp.value = t.time || '';
        timeInp.addEventListener('input', () => { t.time = timeInp.value; markDirty(); });
        const rm = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => {
          ev.times.splice(idx, 1); markDirty(); drawTimes();
        }}, '×');
        timesHost.appendChild(el('div', { class: 'sp-time-row' }, roomSel, labelInp, timeInp, rm));
      });
      const add = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => {
        ev.times = ev.times || [];
        ev.times.push({ roomId: '', label: '', time: '' });
        markDirty(); drawTimes();
      }}, '+ שעת תפילה');
      timesHost.appendChild(add);
    };
    drawTimes();
    body.appendChild(timesHost);

    card.appendChild(head);
    card.appendChild(body);
    return card;
  }

  // ---------- CSV ----------
  function parseCSV(text) {
    const lines = text.replace(/\r/g,'').split('\n').filter(l => l.trim());
    if (!lines.length) return [];
    // tiny CSV parser with quoted values
    const parseLine = (line) => {
      const out = [];
      let cur = ''; let inQ = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (inQ) {
          if (c === '"' && line[i+1] === '"') { cur += '"'; i++; }
          else if (c === '"') inQ = false;
          else cur += c;
        } else {
          if (c === ',') { out.push(cur); cur = ''; }
          else if (c === '"') inQ = true;
          else cur += c;
        }
      }
      out.push(cur);
      return out.map(s => s.trim());
    };
    const header = parseLine(lines[0]);
    return lines.slice(1).map(l => {
      const cols = parseLine(l);
      const obj = {};
      header.forEach((h, i) => obj[h] = cols[i] ?? '');
      return obj;
    });
  }

  function toCSV(rows, columns) {
    const esc = (v) => {
      v = v == null ? '' : String(v);
      if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
      return v;
    };
    const lines = [columns.map(c => esc(c.label)).join(',')];
    for (const row of rows) {
      lines.push(columns.map(c => esc(row[c.key])).join(','));
    }
    return lines.join('\n');
  }

  function download(filename, text) {
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function setupCSV() {
    // Memorial CSV
    qs('#mem-file').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const text = await file.text();
      const rows = parseCSV(text);
      // Accept columns: name|שם, day|יום, month|חודש, notes|הערות
      const entries = rows.map(r => ({
        name: r['שם'] || r['name'] || '',
        hebrewDay: Number(r['יום'] || r['day'] || '') || 0,
        hebrewMonth: r['חודש'] || r['month'] || '',
        notes: r['הערות'] || r['notes'] || '',
      })).filter(e => e.name);
      if (!entries.length) { status('לא זוהו שורות', 'error'); return; }
      if (!confirm(`לטעון ${entries.length} שורות ולהחליף את הרשימה הנוכחית?`)) return;
      state.data.memorial.entries = entries;
      markDirty();
      renderMemorial();
      status('CSV נטען — לחצו "שמירה ופרסום"', 'success');
    });
    qs('#mem-download').addEventListener('click', () => {
      const csv = toCSV(state.data.memorial.entries, [
        { key: 'name', label: 'שם' },
        { key: 'hebrewDay', label: 'יום' },
        { key: 'hebrewMonth', label: 'חודש' },
        { key: 'notes', label: 'הערות' },
      ]);
      download('memorial.csv', csv);
    });
    qs('#mem-clear').addEventListener('click', () => {
      if (!confirm('למחוק את כל ההנצחות?')) return;
      state.data.memorial.entries = [];
      markDirty(); renderMemorial();
    });

    // -- Zmanim-calendar CSV --
    setupZmanimCSV();

  }

  // ---------- Save ----------
  async function saveAll() {
    if (!state.dirty) { status('אין שינויים לשמור'); return; }
    if (!state.password) { status('יש להיכנס מחדש', 'error'); return; }

    const btn = qs('#save-all-btn');
    btn.disabled = true;
    btn.textContent = 'שומר...';
    const [owner, repo] = state.ownerRepo.split('/');

    const payload = {
      files: {
        'data/config.json': state.data.config,
        'data/rooms.json': state.data.rooms,
        'data/memorial.json': state.data.memorial,
        'data/announcements.json': state.data.announcements,
        'data/special-times.json': state.data.specialTimes,
        'data/zmanim-calendar.json': state.data.zmanimCalendar,
      },
    };

    try {
      const { dispatchedAt } = await GitHubAPI.dispatchSave(owner, repo, state.token, state.password, payload);
      status('נשלח — ממתין לאישור...');
      qs('#last-save-status').textContent = `נשלח ב־${new Date(dispatchedAt).toLocaleString('he-IL')}. בודק סטטוס...`;

      const run = await GitHubAPI.pollLatestRun(owner, repo, state.token, dispatchedAt, 120);
      if (!run) {
        status('נשלח אבל לא נמצא עדיין ה־run. בדקו Actions בגיטהאב.', '');
        qs('#last-save-status').textContent = 'לא זוהה run תואם בזמן — בדקו ידנית.';
      } else if (run.conclusion === 'success') {
        markClean();
        status('נשמר ופורסם בהצלחה ✓', 'success');
        qs('#last-save-status').innerHTML = `נשמר בהצלחה: <a href="${run.html_url}" target="_blank">${new Date(run.updated_at).toLocaleString('he-IL')}</a>`;
      } else if (run.conclusion === 'failure') {
        status('השמירה נכשלה — כנראה סיסמה שגויה. לחצו לראות פרטים.', 'error');
        qs('#last-save-status').innerHTML = `<span style="color:#c00">נכשל: <a href="${run.html_url}" target="_blank">לצפייה ב־log</a></span>`;
      } else {
        status(`סטטוס: ${run.conclusion || run.status}`, '');
        qs('#last-save-status').innerHTML = `סטטוס: ${run.conclusion || run.status} — <a href="${run.html_url}" target="_blank">פתיחה</a>`;
      }
    } catch (e) {
      status(`שגיאה: ${e.message}`, 'error');
      qs('#last-save-status').textContent = `שגיאה: ${e.message}`;
    } finally {
      btn.disabled = false;
      btn.textContent = 'שמירה ופרסום';
    }
  }

  // ---------- Zmanim calendar CSV ----------
  const ZMANIM_CSV_KEYS = [
    'alotHaShachar','misheyakir','sunrise',
    'sofZmanShmaMGA','sofZmanShma',
    'sofZmanTfillaMGA','sofZmanTfilla',
    'chatzot','minchaGedola','minchaKetana','plagHaMincha',
    'sunset','tzeit',
  ];

  function updateZmCsvCount() {
    const n = Object.keys(state.data.zmanimCalendar.entries || {}).length;
    const el = qs('#zm-csv-count');
    if (el) el.textContent = n ? `${n} תאריכים עם דריסות` : 'אין תאריכים בלוח השנתי';
  }

  function parseZmanimCsv(text) {
    const rows = parseCSV(text);
    if (!rows.length) return { entries: {}, errors: ['הקובץ ריק או לא תקין'] };
    const sample = rows[0];
    const headers = Object.keys(sample);
    const dateHeader = headers.find(h => /^(date|תאריך)$/i.test(h.trim()));
    if (!dateHeader) return { entries: {}, errors: ['חסר שדה "date" או "תאריך" בשורת הכותרת'] };

    const validKeys = headers.filter(h => ZMANIM_CSV_KEYS.includes(h.trim()));
    const unknown = headers.filter(h => h !== dateHeader && h.trim() && !ZMANIM_CSV_KEYS.includes(h.trim()));
    const errors = [];
    if (unknown.length) errors.push(`עמודות לא מוכרות: ${unknown.join(', ')}`);

    const entries = {};
    for (const row of rows) {
      const date = String(row[dateHeader] || '').trim();
      if (!date) continue;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        errors.push(`תאריך לא תקני: ${date}`);
        continue;
      }
      const override = {};
      for (const k of validKeys) {
        const v = String(row[k] || '').trim();
        if (!v) continue;
        if (!/^\d{1,2}:\d{2}$/.test(v)) {
          errors.push(`שעה לא תקנית בעמודה ${k} בתאריך ${date}: ${v}`);
          continue;
        }
        const [hh, mm] = v.split(':');
        override[k.trim()] = `${hh.padStart(2,'0')}:${mm.padStart(2,'0')}`;
      }
      if (Object.keys(override).length) entries[date] = override;
    }
    return { entries, errors };
  }

  function buildZmanimCsv(entries) {
    const dates = Object.keys(entries).sort();
    const header = ['date', ...ZMANIM_CSV_KEYS];
    const esc = (v) => {
      v = v == null ? '' : String(v);
      if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
      return v;
    };
    const lines = [header.map(esc).join(',')];
    for (const d of dates) {
      const row = [d, ...ZMANIM_CSV_KEYS.map(k => entries[d][k] || '')];
      lines.push(row.map(esc).join(','));
    }
    return lines.join('\n');
  }

  function buildZmanimSample() {
    const header = ['date', ...ZMANIM_CSV_KEYS];
    const lines = [header.join(',')];
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()); // midnight local
    for (let i = 0; i < 365; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      const iso = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      lines.push([iso, ...ZMANIM_CSV_KEYS.map(() => '')].join(','));
    }
    return lines.join('\n');
  }

  function setupZmanimCSV() {
    const fileInp = qs('#zm-csv-file');
    const doImport = async (file, mode) => {
      if (!file) return;
      const text = await file.text();
      const { entries, errors } = parseZmanimCsv(text);
      const count = Object.keys(entries).length;
      if (errors.length && !count) {
        alert('כשל בטעינה:\n' + errors.slice(0, 10).join('\n'));
        return;
      }
      if (!count) { status('לא זוהו דריסות בקובץ', 'error'); return; }

      const msg = mode === 'replace'
        ? `להחליף את הלוח השנתי ב־${count} תאריכים חדשים (המחיקה היא מקומית עד שתלחצו שמירה)?`
        : `למזג ${count} תאריכים חדשים עם ${Object.keys(state.data.zmanimCalendar.entries).length} הקיימים?`;
      if (!confirm(msg)) return;

      if (mode === 'replace') state.data.zmanimCalendar.entries = {};
      Object.assign(state.data.zmanimCalendar.entries, entries);

      if (errors.length) {
        status(`נטען עם ${errors.length} אזהרות`, 'error');
        console.warn('Zmanim CSV warnings:', errors);
      } else {
        status(`נטענו ${count} תאריכים — לחצו "שמירה ופרסום"`, 'success');
      }
      markDirty();
      updateZmCsvCount();
    };

    fileInp.addEventListener('change', (e) => {
      doImport(e.target.files[0], 'merge');
      e.target.value = ''; // allow re-selecting same file
    });

    qs('#zm-csv-replace').addEventListener('click', () => {
      const f = fileInp.files && fileInp.files[0];
      if (!f) {
        // Trigger file picker first, then replace
        fileInp.addEventListener('change', function once(e) {
          fileInp.removeEventListener('change', once);
          doImport(e.target.files[0], 'replace');
          e.target.value = '';
        }, { once: true });
        fileInp.click();
        return;
      }
      doImport(f, 'replace');
    });

    qs('#zm-csv-sample').addEventListener('click', () => {
      download('zmanim-calendar-template.csv', buildZmanimSample());
    });

    qs('#zm-csv-download').addEventListener('click', () => {
      const entries = state.data.zmanimCalendar.entries || {};
      if (!Object.keys(entries).length) {
        status('אין נתונים להורדה', 'error');
        return;
      }
      download('zmanim-calendar.csv', buildZmanimCsv(entries));
    });

    qs('#zm-csv-clear').addEventListener('click', () => {
      const n = Object.keys(state.data.zmanimCalendar.entries).length;
      if (!n) { status('הלוח השנתי כבר ריק'); return; }
      if (!confirm(`למחוק את כל ${n} התאריכים בלוח השנתי?`)) return;
      state.data.zmanimCalendar.entries = {};
      markDirty();
      updateZmCsvCount();
      status('הלוח השנתי נוקה — לחצו "שמירה ופרסום"');
    });

    updateZmCsvCount();
  }

  // ---------- Render all ----------
  function renderAll() {
    renderGeneral();
    renderZmanim();
    renderRooms();
    renderMemorial();
    renderAnnouncements();
    renderSpecial();
    updateZmCsvCount();
  }

  // ---------- Boot ----------
  document.addEventListener('DOMContentLoaded', () => {
    // Prefill login
    const savedOwner = localStorage.getItem(LS_OWNER) || GitHubAPI.detectOwnerRepo();
    const savedToken = localStorage.getItem(LS_TOKEN) || '';
    qs('#login-owner').value = savedOwner;
    qs('#login-token').value = savedToken;

    qs('#login-btn').addEventListener('click', handleLogin);
    qs('#login-password').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleLogin();
    });

    qs('#logout-btn').addEventListener('click', logout);
    qs('#save-all-btn').addEventListener('click', saveAll);

    qs('#add-room-btn').addEventListener('click', () => {
      const next = state.data.rooms.rooms.length + 1;
      const room = normalizeRoom({
        id: `room-${next}`,
        name: `חדר ${next}`,
      });
      state.data.rooms.rooms.push(room);
      markDirty(); renderRooms();
    });

    qs('#add-mem-btn').addEventListener('click', () => {
      state.data.memorial.entries.push({ name: '', hebrewDay: 0, hebrewMonth: '', notes: '' });
      markDirty(); renderMemorial();
    });
    qs('#add-ann-btn').addEventListener('click', () => {
      state.data.announcements.entries.push({ text: '', startDate: '', endDate: '' });
      markDirty(); renderAnnouncements();
    });
    qs('#add-sp-btn').addEventListener('click', () => {
      state.data.specialTimes.entries.push({
        id: String(Math.random()).slice(2),
        name: '',
        dateType: 'hebrew',
        date: '',
        hebrewDay: 0,
        hebrewMonth: '',
        times: [{ roomId: '', label: 'שחרית', time: '' }],
      });
      markDirty(); renderSpecial();
    });

    qs('#save-token-btn').addEventListener('click', () => {
      const t = qs('#set-token').value.trim();
      if (t) {
        localStorage.setItem(LS_TOKEN, t);
        state.token = t;
        qs('#set-token').value = '';
        status('טוקן נשמר', 'success');
      }
    });

    bindGeneral();
    setupTabs();
    setupCSV();

    window.addEventListener('beforeunload', (e) => {
      if (state.dirty) { e.preventDefault(); e.returnValue = ''; }
    });
  });
})();
