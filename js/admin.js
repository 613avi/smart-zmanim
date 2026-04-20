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
    // normalize
    if (!state.data.config.location) state.data.config.location = { ...DEFAULT_CONFIG.location };
    if (!state.data.config.displayedZmanim) state.data.config.displayedZmanim = { ...DEFAULT_CONFIG.displayedZmanim };
    if (!state.data.config.zmanimOverrides) state.data.config.zmanimOverrides = {};
    if (!Array.isArray(state.data.rooms.rooms)) state.data.rooms.rooms = [];
    state.data.rooms.rooms = state.data.rooms.rooms.map(normalizeRoom);
    if (!Array.isArray(state.data.memorial.entries)) state.data.memorial.entries = [];
    if (!Array.isArray(state.data.announcements.entries)) state.data.announcements.entries = [];
    if (!Array.isArray(state.data.specialTimes.entries)) state.data.specialTimes.entries = [];
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
  function renderZmanim() {
    const grid = qs('#zmanim-grid');
    grid.innerHTML = '';
    const displayed = state.data.config.displayedZmanim || {};
    const overrides = state.data.config.zmanimOverrides || {};
    for (const [key, label] of ZMANIM_KEYS) {
      const row = el('div', { class: 'zmanim-row' });
      const cb = el('input', { type: 'checkbox' });
      cb.checked = !!displayed[key];
      cb.addEventListener('change', () => {
        state.data.config.displayedZmanim[key] = cb.checked;
        markDirty();
      });
      const ov = el('input', { type: 'text', placeholder: 'חישוב אוטומטי', maxlength: '5' });
      ov.value = overrides[key] || '';
      ov.style.width = '6rem';
      ov.style.direction = 'ltr';
      ov.style.textAlign = 'center';
      ov.addEventListener('input', () => {
        const v = ov.value.trim();
        if (v) state.data.config.zmanimOverrides[key] = v;
        else delete state.data.config.zmanimOverrides[key];
        markDirty();
      });
      const lbl = el('label', {}, cb, el('span', { class: 'zm-label' }, label));
      row.appendChild(lbl);
      row.appendChild(el('span', { class: 'zm-ov-label small' }, 'דריסה:'));
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

  // ---------- Special times ----------
  function renderSpecial() {
    const tbody = qs('#sp-table tbody');
    tbody.innerHTML = '';
    for (const e of state.data.specialTimes.entries) {
      tbody.appendChild(renderSpRow(e));
    }
  }
  function renderSpRow(entry) {
    const tr = document.createElement('tr');
    const mkTd = (field, type='text') => {
      const td = document.createElement('td');
      const input = document.createElement('input');
      input.type = type;
      input.value = entry[field] ?? '';
      input.addEventListener('input', (e) => { entry[field] = e.target.value; markDirty(); });
      td.appendChild(input);
      return td;
    };
    tr.appendChild(mkTd('date', 'date'));
    // room selector
    const tdRoom = document.createElement('td');
    const sel = document.createElement('select');
    sel.appendChild(el('option', { value: '' }, 'כל החדרים'));
    for (const r of state.data.rooms.rooms) sel.appendChild(el('option', { value: r.id }, r.name));
    sel.value = entry.roomId || '';
    sel.addEventListener('change', () => { entry.roomId = sel.value; markDirty(); });
    tdRoom.appendChild(sel);
    tr.appendChild(tdRoom);
    tr.appendChild(mkTd('label'));
    tr.appendChild(mkTd('time'));
    const tdAct = document.createElement('td');
    tdAct.className = 'col-actions';
    tdAct.appendChild(el('button', { class: 'btn btn-danger btn-sm', onclick: () => {
      state.data.specialTimes.entries = state.data.specialTimes.entries.filter(e => e !== entry);
      markDirty(); renderSpecial();
    }}, '×'));
    tr.appendChild(tdAct);
    return tr;
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

    // Special times CSV
    qs('#sp-file').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const text = await file.text();
      const rows = parseCSV(text);
      const entries = rows.map(r => ({
        date: r['תאריך'] || r['date'] || '',
        roomId: r['חדר'] || r['room'] || r['roomId'] || '',
        label: r['תפילה'] || r['label'] || '',
        time: r['שעה'] || r['time'] || '',
      })).filter(e => e.date && e.label);
      if (!entries.length) { status('לא זוהו שורות', 'error'); return; }
      if (!confirm(`לטעון ${entries.length} שורות ולהחליף את הרשימה הנוכחית?`)) return;
      state.data.specialTimes.entries = entries;
      markDirty();
      renderSpecial();
      status('CSV נטען', 'success');
    });
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

  // ---------- Render all ----------
  function renderAll() {
    renderGeneral();
    renderZmanim();
    renderRooms();
    renderMemorial();
    renderAnnouncements();
    renderSpecial();
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
      state.data.specialTimes.entries.push({ date: '', roomId: '', label: '', time: '' });
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
