// Smart Zmanim - display logic
// Loads data/*.json from the repo, renders a kiosk-style synagogue board.

(() => {
  const { HDate, GeoLocation, Zmanim, HebrewCalendar, flags, Locale } = window.hebcal;
  const FLAG_PARSHA = (flags && flags.PARSHA_HASHAVUA) || 1024;
  const FLAG_CHAG = (flags && flags.CHAG) || 1;

  const hebMonth = (hdate) => {
    try { return Locale.gettext(hdate.getMonthName(), 'he'); }
    catch { return hdate.getMonthName(); }
  };
  const makeGeo = () => {
    const { latitude, longitude, timezone } = state.config.location;
    return new GeoLocation(
      state.config.synagogueName || 'site',
      Number(latitude), Number(longitude),
      0,
      timezone || 'Asia/Jerusalem'
    );
  };

  const HEB_DOW = ['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'];

  const state = {
    config: null,
    rooms: [],
    memorial: [],
    announcements: [],
    specialTimes: [],
    activeRoomId: null, // room id, or "all"
  };

  // ---------- helpers ----------
  const qs = (sel) => document.querySelector(sel);
  const fmtTime = (d) => {
    if (!d || !(d instanceof Date) || isNaN(d)) return '';
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  };
  const parseTime = (s) => {
    // HH:MM -> minutes-since-midnight
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
    if (!m) return NaN;
    return Number(m[1]) * 60 + Number(m[2]);
  };
  const addMinutes = (date, mins) => new Date(date.getTime() + mins * 60000);
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

  async function fetchJSON(path) {
    const url = `${path}?v=${Date.now()}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Failed to fetch ${path}: ${res.status}`);
    return res.json();
  }

  async function loadData() {
    const [config, rooms, memorial, announcements, specialTimes] = await Promise.all([
      fetchJSON('data/config.json').catch(() => null),
      fetchJSON('data/rooms.json').catch(() => ({ rooms: [] })),
      fetchJSON('data/memorial.json').catch(() => ({ entries: [] })),
      fetchJSON('data/announcements.json').catch(() => ({ entries: [] })),
      fetchJSON('data/special-times.json').catch(() => ({ entries: [] })),
    ]);
    if (!config) throw new Error('config.json missing');
    state.config = config;
    state.config.zmanimOverrides = state.config.zmanimOverrides || {};
    state.rooms = (rooms.rooms || []).map(normalizeRoom);
    state.memorial = memorial.entries || [];
    state.announcements = announcements.entries || [];
    state.specialTimes = specialTimes.entries || [];

    // active room from URL ?room=
    const params = new URLSearchParams(location.search);
    const fromUrl = params.get('room');
    if (fromUrl === 'all' || (fromUrl && state.rooms.find(r => r.id === fromUrl))) {
      state.activeRoomId = fromUrl;
    } else if (state.activeRoomId == null) {
      // default: all rooms if >1, else the single room
      state.activeRoomId = state.rooms.length > 1 ? 'all' : (state.rooms[0]?.id || null);
    }
  }

  // ---------- header / omer / parasha ----------
  function findOmerText(hdate) {
    try {
      const evs = HebrewCalendar.calendar({ start: hdate, end: hdate, omer: true, locale: 'he', il: true });
      const omerEv = evs.find(e => e.constructor && e.constructor.name === 'OmerEvent')
                  || evs.find(e => typeof e.getTodayIs === 'function');
      if (!omerEv) return '';
      if (typeof omerEv.getTodayIs === 'function') {
        const text = omerEv.getTodayIs('he');
        const sefira = typeof omerEv.sefira === 'function' ? omerEv.sefira('he') : '';
        return sefira ? `${text} · ${sefira}` : text;
      }
      return omerEv.render('he');
    } catch { return ''; }
  }

  function findParashaText(hdate, now) {
    try {
      const events = HebrewCalendar.calendar({ start: hdate, end: hdate, sedrot: true, il: true, locale: 'he' });
      const parashaEv = events.find(e => e.getFlags && (e.getFlags() & FLAG_PARSHA));
      if (parashaEv) return parashaEv.render('he');
      const daysToShabbat = (6 - now.getDay() + 7) % 7 || 7;
      const shabbat = new HDate(new Date(now.getTime() + daysToShabbat * 86400000));
      const wkEvents = HebrewCalendar.calendar({ start: shabbat, end: shabbat, sedrot: true, il: true, locale: 'he' });
      const pEv = wkEvents.find(e => e.getFlags && (e.getFlags() & FLAG_PARSHA));
      return pEv ? pEv.render('he') : '';
    } catch { return ''; }
  }

  function renderHeader() {
    qs('#synagogue-name').textContent = state.config.synagogueName || '';
    const now = new Date();
    const hdate = new HDate(now);
    qs('#hebrew-date').textContent = hdate.renderGematriya();
    const dow = HEB_DOW[now.getDay()];
    qs('#gregorian-date').textContent = `יום ${dow}, ${now.toLocaleDateString('he-IL', {day:'numeric', month:'long', year:'numeric'})}`;

    const parashaText = findParashaText(hdate, now);
    qs('#parasha').textContent = parashaText;
    qs('.parasha-sep').style.display = parashaText ? '' : 'none';

    const omerText = findOmerText(hdate);
    const omerEl = qs('#omer-line');
    if (omerEl) {
      omerEl.textContent = omerText;
      omerEl.style.display = omerText ? '' : 'none';
    }
  }

  function renderClock() {
    const now = new Date();
    const h = String(now.getHours()).padStart(2,'0');
    const m = String(now.getMinutes()).padStart(2,'0');
    const s = String(now.getSeconds()).padStart(2,'0');
    qs('#current-time').textContent = `${h}:${m}`;
    qs('#current-seconds').textContent = s;
  }

  // ---------- zmanim ----------
  const ZMANIM_DEFS = [
    { key: 'alotHaShachar',    label: 'עלות השחר',                   fn: z => z.alotHaShachar() },
    { key: 'misheyakir',       label: 'משיכיר',                      fn: z => z.misheyakir() },
    { key: 'sunrise',          label: 'הנץ החמה',                     fn: z => z.sunrise() },
    { key: 'sofZmanShmaMGA',   label: 'סוף זמן ק״ש (מג״א)',           fn: z => z.sofZmanShmaMGA() },
    { key: 'sofZmanShma',      label: 'סוף זמן ק״ש (גר״א)',           fn: z => z.sofZmanShma() },
    { key: 'sofZmanTfillaMGA', label: 'סוף זמן תפילה (מג״א)',         fn: z => z.sofZmanTfillaMGA() },
    { key: 'sofZmanTfilla',    label: 'סוף זמן תפילה (גר״א)',         fn: z => z.sofZmanTfilla() },
    { key: 'chatzot',          label: 'חצות היום',                    fn: z => z.chatzot() },
    { key: 'minchaGedola',     label: 'מנחה גדולה',                   fn: z => z.minchaGedola() },
    { key: 'minchaKetana',     label: 'מנחה קטנה',                    fn: z => z.minchaKetana() },
    { key: 'plagHaMincha',     label: 'פלג המנחה',                    fn: z => z.plagHaMincha() },
    { key: 'sunset',           label: 'שקיעת החמה',                   fn: z => z.sunset() },
    { key: 'tzeit',            label: 'צאת הכוכבים',                  fn: z => z.tzeit() },
  ];

  function computeZmanim() {
    const z = new Zmanim(makeGeo(), new Date());
    const overrides = state.config.zmanimOverrides || {};
    const results = {};
    for (const def of ZMANIM_DEFS) {
      let label = def.label;
      let time = '';
      let isOverride = false;
      const ov = overrides[def.key];
      if (ov && /^\d{1,2}:\d{2}$/.test(String(ov).trim())) {
        time = String(ov).trim().padStart(5, '0');
        isOverride = true;
      } else {
        try {
          const d = def.fn(z);
          time = fmtTime(d instanceof Date ? d : new Date(d));
        } catch {}
      }
      results[def.key] = { label, time, isOverride };
    }
    return results;
  }

  function renderZmanim() {
    const tbody = qs('#zmanim-table tbody');
    tbody.innerHTML = '';
    const displayed = state.config.displayedZmanim || {};
    const computed = computeZmanim();
    for (const def of ZMANIM_DEFS) {
      if (!displayed[def.key]) continue;
      const r = computed[def.key];
      if (!r.time) continue;
      const tr = document.createElement('tr');
      const mark = r.isOverride ? '<span class="ov" title="ערך מותאם אישית">*</span>' : '';
      tr.innerHTML = `<td>${def.label}${mark}</td><td>${r.time}</td>`;
      tbody.appendChild(tr);
    }
  }

  // ---------- rooms / tefillot ----------
  function computeShabbatContext() {
    const geo = makeGeo();
    const now = new Date();
    const dow = now.getDay();
    let friday = new Date(now);
    if (dow === 6) friday.setDate(now.getDate() - 1);
    else if (dow === 5) { /* today */ }
    else {
      const daysToFri = (5 - dow + 7) % 7;
      friday.setDate(now.getDate() + daysToFri);
    }
    friday.setHours(12, 0, 0, 0);
    const saturday = new Date(friday); saturday.setDate(friday.getDate() + 1);
    const zFri = new Zmanim(geo, friday);
    const zSat = new Zmanim(geo, saturday);
    const candleMinutes = Number(state.config.location.candleLightingMinutes) || 18;
    const candle = addMinutes(zFri.sunset(), -candleMinutes);
    const havdalah = zSat.tzeit(8.5);
    return { candle, havdalah };
  }

  // Build one room's rows for today.
  // Returns [{ label, time, sortKey }]
  function buildWeekdayRows(room) {
    const rows = [];
    for (const t of room.weekday.shacharit) rows.push({ group: 'שחרית', time: t });
    for (const t of room.weekday.mincha)    rows.push({ group: 'מנחה',   time: t });
    for (const t of room.weekday.arvit)     rows.push({ group: 'ערבית',  time: t });
    return rows;
  }

  function buildShabbatRows(room, ctx) {
    const rows = [];
    for (const t of room.shabbat.kabbalat) rows.push({ group: 'קבלת שבת', time: t });
    for (const off of room.shabbat.minchaErevOffsets) {
      rows.push({ group: 'מנחה ערב שבת', time: fmtTime(addMinutes(ctx.candle, off)) });
    }
    for (const t of room.shabbat.shacharit) rows.push({ group: 'שחרית שבת', time: t });
    for (const t of room.shabbat.mincha)    rows.push({ group: 'מנחה שבת',  time: t });
    for (const off of room.shabbat.arvitMotzashOffsets) {
      rows.push({ group: 'ערבית מוצ״ש', time: fmtTime(addMinutes(ctx.havdalah, off)) });
    }
    return rows;
  }

  function applySpecialOverrides(rows, room) {
    const todayStr = new Date().toISOString().slice(0, 10);
    const overrides = state.specialTimes.filter(e =>
      e.date === todayStr && (!e.roomId || e.roomId === room.id || e.roomId === '*')
    );
    for (const ov of overrides) {
      if (!ov.label || !ov.time) continue;
      // Replace all rows with matching label/group; if none match, append as ad-hoc row
      const matches = rows.filter(r => r.group === ov.label || r.label === ov.label);
      if (matches.length) {
        rows.forEach(r => {
          if (r.group === ov.label || r.label === ov.label) r.time = ov.time;
        });
      } else {
        rows.push({ group: ov.label, time: ov.time });
      }
    }
    return rows;
  }

  const PRAYER_ORDER = [
    'קבלת שבת',
    'שחרית', 'שחרית שבת',
    'מנחה ערב שבת', 'מנחה', 'מנחה שבת',
    'ערבית', 'ערבית מוצ״ש',
  ];
  const prayerOrderIdx = (name) => {
    const i = PRAYER_ORDER.indexOf(name);
    return i < 0 ? 99 : i;
  };

  function renderTefillot() {
    const container = qs('#tefillot-rooms');
    container.innerHTML = '';
    if (!state.rooms.length) {
      container.innerHTML = '<div class="empty-state">לא הוגדרו חדרי תפילה</div>';
      return;
    }

    const now = new Date();
    const dow = now.getDay();
    const isShabbat = dow === 6;
    const isErevShabbat = dow === 5;
    const shabbatCtx = (isShabbat || isErevShabbat) ? computeShabbatContext() : null;

    qs('#tefillot-title').textContent = isShabbat || isErevShabbat ? 'זמני תפילות שבת' : 'זמני תפילות';

    const showAll = state.activeRoomId === 'all' || !state.activeRoomId;
    const rooms = showAll ? state.rooms : state.rooms.filter(r => r.id === state.activeRoomId);

    if (showAll && state.rooms.length > 1) {
      // Compute shabbat context shared shown above
      if (shabbatCtx) {
        const shared = document.createElement('div');
        shared.className = 'shabbat-shared';
        shared.innerHTML = `
          <div><span>הדלקת נרות</span><b>${fmtTime(shabbatCtx.candle)}</b></div>
          <div><span>צאת השבת</span><b>${fmtTime(shabbatCtx.havdalah)}</b></div>
        `;
        container.appendChild(shared);
      }

      // Gather minyans across rooms and group by prayer
      const byGroup = new Map();
      for (const room of rooms) {
        const raw = (isShabbat || isErevShabbat) ? buildShabbatRows(room, shabbatCtx) : buildWeekdayRows(room);
        applySpecialOverrides(raw, room);
        for (const r of raw) {
          const list = byGroup.get(r.group) || [];
          list.push({ ...r, roomName: room.name });
          byGroup.set(r.group, list);
        }
      }

      const groups = [...byGroup.entries()].sort((a, b) => prayerOrderIdx(a[0]) - prayerOrderIdx(b[0]));
      for (const [group, minyans] of groups) {
        minyans.sort((a, b) => parseTime(a.time) - parseTime(b.time));
        const block = document.createElement('div');
        block.className = 'prayer-block';
        const rowsHtml = minyans.map(m =>
          `<tr><td class="ptime">${m.time || '—'}</td><td class="proom">${m.roomName}</td></tr>`
        ).join('');
        block.innerHTML = `<h3>${group}</h3><table><tbody>${rowsHtml}</tbody></table>`;
        container.appendChild(block);
      }
      return;
    }

    // Single room view
    for (const room of rooms) {
      const block = document.createElement('div');
      block.className = 'room-block';
      const title = state.rooms.length > 1 ? `<h3>${room.name}</h3>` : '';
      const raw = (isShabbat || isErevShabbat) ? buildShabbatRows(room, shabbatCtx) : buildWeekdayRows(room);
      applySpecialOverrides(raw, room);

      // Build "Candle lighting" and "Havdalah" as prefix/suffix for shabbat single-room
      const extraTop = [];
      const extraBottom = [];
      if (shabbatCtx) {
        extraTop.push({ group: 'הדלקת נרות', time: fmtTime(shabbatCtx.candle) });
        extraBottom.push({ group: 'צאת השבת', time: fmtTime(shabbatCtx.havdalah) });
      }
      raw.sort((a, b) => {
        const oa = prayerOrderIdx(a.group), ob = prayerOrderIdx(b.group);
        if (oa !== ob) return oa - ob;
        return parseTime(a.time) - parseTime(b.time);
      });
      const all = [...extraTop, ...raw, ...extraBottom];
      const rowsHtml = all.length
        ? `<table><tbody>${all.map(r =>
            `<tr><td>${r.group}</td><td>${r.time || '—'}</td></tr>`
          ).join('')}</tbody></table>`
        : `<div class="empty-state">אין זמני תפילה</div>`;
      block.innerHTML = title + rowsHtml;
      container.appendChild(block);
    }
  }

  function renderRoomSwitcher() {
    const container = qs('#room-switcher');
    container.innerHTML = '';
    if (state.rooms.length <= 1) return;
    const mkBtn = (id, label) => {
      const btn = document.createElement('button');
      btn.textContent = label;
      if (id === state.activeRoomId) btn.classList.add('active');
      btn.addEventListener('click', () => {
        state.activeRoomId = id;
        const url = new URL(location.href);
        url.searchParams.set('room', id);
        history.replaceState({}, '', url);
        renderRoomSwitcher();
        renderTefillot();
      });
      return btn;
    };
    container.appendChild(mkBtn('all', 'כל החדרים'));
    for (const room of state.rooms) {
      container.appendChild(mkBtn(room.id, room.name));
    }
  }

  // ---------- memorial ----------
  function hebrewDateMatches(entry, hdate) {
    if (!entry.hebrewMonth || !entry.hebrewDay) return false;
    const monthHe = hebMonth(hdate);
    const monthEn = hdate.getMonthName();
    const day = hdate.getDate();
    const em = String(entry.hebrewMonth).trim();
    const byName = em === monthHe.trim() || em.toLowerCase() === monthEn.toLowerCase();
    const byIndex = Number(em) === hdate.getMonth();
    return (byName || byIndex) && Number(entry.hebrewDay) === day;
  }

  function renderMemorial() {
    const list = qs('#memorial-list');
    const card = qs('#memorial-card');
    list.innerHTML = '';
    if (!state.memorial.length) {
      card.style.display = 'none';
      return;
    }
    card.style.display = '';
    const today = new HDate(new Date());
    const items = [...state.memorial].map(e => ({ ...e, _today: hebrewDateMatches(e, today) }));
    items.sort((a, b) => {
      if (a._today && !b._today) return -1;
      if (!a._today && b._today) return 1;
      return (a.name || '').localeCompare(b.name || '', 'he');
    });
    for (const entry of items.slice(0, 50)) {
      const li = document.createElement('li');
      const dateStr = entry.hebrewDay && entry.hebrewMonth
        ? `${entry.hebrewDay} ${entry.hebrewMonth}`
        : '';
      li.innerHTML = `
        <span class="mem-name${entry._today ? ' mem-today' : ''}">${entry.name || ''}</span>
        <span class="mem-date">${dateStr}</span>
      `;
      list.appendChild(li);
    }
  }

  function renderAnnouncements() {
    const container = qs('#announcements-container');
    const ticker = qs('#announcements-ticker');
    const today = new Date().toISOString().slice(0, 10);
    const active = state.announcements.filter(a => {
      const startOk = !a.startDate || a.startDate <= today;
      const endOk = !a.endDate || a.endDate >= today;
      return startOk && endOk && a.text;
    });
    if (!active.length) {
      container.style.display = 'none';
      return;
    }
    container.style.display = 'block';
    ticker.textContent = active.map(a => a.text).join('   •   ');
  }

  function renderUpcoming() {
    try {
      const now = new Date();
      const hdate = new HDate(now);
      const end = new HDate(new Date(now.getTime() + 14 * 86400000));
      const events = HebrewCalendar.calendar({
        start: hdate, end, il: true, locale: 'he',
        candlelighting: false, sedrot: false, omer: false,
      });
      const upcoming = events.find(e => (e.getFlags() & FLAG_CHAG));
      qs('#upcoming-event').textContent = upcoming ? upcoming.render('he') : '';
    } catch { /* ignore */ }
  }

  // ---------- refresh ----------
  async function refreshAll() {
    try {
      await loadData();
      renderHeader();
      renderZmanim();
      renderRoomSwitcher();
      renderTefillot();
      renderMemorial();
      renderAnnouncements();
      renderUpcoming();
    } catch (e) {
      console.error('refresh failed', e);
    }
  }

  function lightRefresh() {
    try {
      renderHeader();
      renderZmanim();
      renderTefillot();
      renderMemorial();
    } catch (e) { console.error('lightRefresh failed', e); }
  }

  document.addEventListener('DOMContentLoaded', async () => {
    await refreshAll();
    renderClock();
    setInterval(renderClock, 1000);
    setInterval(lightRefresh, 60 * 1000);
    setInterval(refreshAll, 5 * 60 * 1000);
  });
})();
