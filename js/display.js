// Smart Zmanim - display logic
// Loads data/*.json, renders a kiosk-style synagogue board (always all-rooms).

(() => {
  const { HDate, GeoLocation, Zmanim, HebrewCalendar, flags, Locale, gematriya } = window.hebcal;
  const FLAG_PARSHA = (flags && flags.PARSHA_HASHAVUA) || 1024;
  const FLAG_CHAG = (flags && flags.CHAG) || 1;

  const hebMonth = (hdate) => {
    try { return Locale.gettext(hdate.getMonthName(), 'he'); }
    catch { return hdate.getMonthName(); }
  };
  const hebDay = (n) => {
    try { return gematriya(Number(n) || 0); }
    catch { return String(n); }
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
    specialEvents: [],
  };

  // ---------- helpers ----------
  const qs = (sel) => document.querySelector(sel);
  const fmtTime = (d) => {
    if (!d || !(d instanceof Date) || isNaN(d)) return '';
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  };
  const parseTime = (s) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
    if (!m) return NaN;
    return Number(m[1]) * 60 + Number(m[2]);
  };
  const addMinutes = (date, mins) => new Date(date.getTime() + mins * 60000);
  const asArr = (v) => Array.isArray(v) ? v.filter(x => x !== '' && x != null) : (v ? [v] : []);

  // Effective Hebrew date: after sunset at current location we're already on the next Hebrew day.
  function getEffectiveHDate() {
    const now = new Date();
    let hd = new HDate(now);
    if (state.config && state.config.location) {
      try {
        const sunset = new Zmanim(makeGeo(), now).sunset();
        if (sunset && now >= sunset) hd = hd.next();
      } catch {}
    }
    return hd;
  }

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

  // Normalize special-times to event-grouped format.
  function migrateSpecialTimes(arr) {
    if (!Array.isArray(arr)) return [];
    if (arr.length === 0) return [];
    if (arr[0] && (Array.isArray(arr[0].times) || arr[0].name != null || arr[0].dateType)) {
      // Already events format — ensure shape
      return arr.map(ev => ({
        id: ev.id || String(Math.random()).slice(2),
        name: ev.name || '',
        dateType: ev.dateType === 'hebrew' ? 'hebrew' : 'gregorian',
        date: ev.date || '',
        hebrewDay: ev.hebrewDay || 0,
        hebrewMonth: ev.hebrewMonth || '',
        times: Array.isArray(ev.times) ? ev.times : [],
      }));
    }
    // Flat rows (legacy): group by date
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
    return [...groups.values()];
  }

  async function fetchJSON(path) {
    const url = `${path}?v=${Date.now()}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`${path}: ${res.status}`);
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
    state.specialEvents = migrateSpecialTimes(specialTimes.entries || []);
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
    const hdate = getEffectiveHDate();
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
    const out = {};
    for (const def of ZMANIM_DEFS) {
      let time = '', isOverride = false;
      const ov = overrides[def.key];
      if (ov && /^\d{1,2}:\d{2}$/.test(String(ov).trim())) {
        const [hh, mm] = String(ov).trim().split(':');
        time = `${hh.padStart(2,'0')}:${mm.padStart(2,'0')}`;
        isOverride = true;
      } else {
        try {
          const d = def.fn(z);
          time = fmtTime(d instanceof Date ? d : new Date(d));
        } catch {}
      }
      out[def.key] = { time, isOverride };
    }
    return out;
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
    updateAutoScroll(qs('.zmanim-card'));
  }

  // ---------- auto-scroll for cards that overflow ----------
  function updateAutoScroll(el) {
    if (!el) return;
    clearInterval(el._scrollTimer);
    el._scrollTimer = null;
    el._scrollDir = 0;
    el.scrollTop = 0;
    // Defer: layout must settle
    requestAnimationFrame(() => {
      if (el.scrollHeight - el.clientHeight <= 4) return;
      el._scrollDir = 1;
      el._scrollHold = 40; // pause ticks at edges
      el._scrollTimer = setInterval(() => {
        if (el._scrollHold > 0) { el._scrollHold--; return; }
        el.scrollTop += el._scrollDir;
        if (el.scrollTop + el.clientHeight >= el.scrollHeight - 1) {
          el._scrollDir = -1; el._scrollHold = 40;
        } else if (el.scrollTop <= 0) {
          el._scrollDir = 1; el._scrollHold = 40;
        }
      }, 50);
    });
  }

  // ---------- tefillot (always all-rooms) ----------
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
    for (const off of room.shabbat.minchaErevOffsets) rows.push({ group: 'מנחה ערב שבת', time: fmtTime(addMinutes(ctx.candle, off)) });
    for (const t of room.shabbat.shacharit) rows.push({ group: 'שחרית שבת', time: t });
    for (const t of room.shabbat.mincha)    rows.push({ group: 'מנחה שבת',  time: t });
    for (const off of room.shabbat.arvitMotzashOffsets) rows.push({ group: 'ערבית מוצ״ש', time: fmtTime(addMinutes(ctx.havdalah, off)) });
    return rows;
  }

  function eventAppliesToday(ev, hdateToday, gregTodayStr) {
    if (ev.dateType === 'hebrew') {
      if (!ev.hebrewDay || !ev.hebrewMonth) return false;
      const monthHe = hebMonth(hdateToday);
      const monthEn = hdateToday.getMonthName();
      const em = String(ev.hebrewMonth).trim();
      const byName = em === monthHe.trim() || em.toLowerCase() === monthEn.toLowerCase();
      const byIndex = Number(em) === hdateToday.getMonth();
      return (byName || byIndex) && Number(ev.hebrewDay) === hdateToday.getDate();
    }
    return ev.date === gregTodayStr;
  }

  function applySpecialEventsToRoom(rows, room) {
    const hdate = getEffectiveHDate();
    const gregToday = new Date().toISOString().slice(0, 10);
    for (const ev of state.specialEvents) {
      if (!eventAppliesToday(ev, hdate, gregToday)) continue;
      for (const t of (ev.times || [])) {
        if (!t.label || !t.time) continue;
        if (t.roomId && t.roomId !== '*' && t.roomId !== room.id) continue;
        const matches = rows.filter(r => r.group === t.label);
        if (matches.length) {
          rows.forEach(r => { if (r.group === t.label) r.time = t.time; });
        } else {
          rows.push({ group: t.label, time: t.time, eventName: ev.name });
        }
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

  function currentEventName() {
    const hdate = getEffectiveHDate();
    const gregToday = new Date().toISOString().slice(0, 10);
    const match = state.specialEvents.find(ev => eventAppliesToday(ev, hdate, gregToday) && ev.name);
    return match ? match.name : '';
  }

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

    let title = isShabbat || isErevShabbat ? 'זמני תפילות שבת' : 'זמני תפילות';
    const eventName = currentEventName();
    if (eventName) title = `זמני תפילות — ${eventName}`;
    qs('#tefillot-title').textContent = title;

    // Shared shabbat row at top
    if (shabbatCtx) {
      const shared = document.createElement('div');
      shared.className = 'shabbat-shared';
      shared.innerHTML = `
        <div><span>הדלקת נרות</span><b>${fmtTime(shabbatCtx.candle)}</b></div>
        <div><span>צאת השבת</span><b>${fmtTime(shabbatCtx.havdalah)}</b></div>
      `;
      container.appendChild(shared);
    }

    // Gather minyans by prayer group from every room
    const byGroup = new Map();
    for (const room of state.rooms) {
      const raw = (isShabbat || isErevShabbat) ? buildShabbatRows(room, shabbatCtx) : buildWeekdayRows(room);
      applySpecialEventsToRoom(raw, room);
      for (const r of raw) {
        const list = byGroup.get(r.group) || [];
        list.push({ ...r, roomName: room.name });
        byGroup.set(r.group, list);
      }
    }

    const groups = [...byGroup.entries()].sort((a, b) => prayerOrderIdx(a[0]) - prayerOrderIdx(b[0]));
    const showRoomCol = state.rooms.length > 1;
    for (const [group, minyans] of groups) {
      minyans.sort((a, b) => parseTime(a.time) - parseTime(b.time));
      const block = document.createElement('div');
      block.className = 'prayer-block';
      const rowsHtml = minyans.map(m =>
        `<tr><td class="ptime">${m.time || '—'}</td>${showRoomCol ? `<td class="proom">${m.roomName}</td>` : ''}</tr>`
      ).join('');
      block.innerHTML = `<h3>${group}</h3><table><tbody>${rowsHtml}</tbody></table>`;
      container.appendChild(block);
    }

    updateAutoScroll(qs('.tefillot-card'));
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
    if (!state.memorial.length) { card.style.display = 'none'; return; }
    card.style.display = '';
    const today = getEffectiveHDate();
    const items = [...state.memorial].map(e => ({ ...e, _today: hebrewDateMatches(e, today) }));
    items.sort((a, b) => {
      if (a._today && !b._today) return -1;
      if (!a._today && b._today) return 1;
      return (a.name || '').localeCompare(b.name || '', 'he');
    });
    for (const entry of items.slice(0, 60)) {
      const li = document.createElement('li');
      const dateStr = entry.hebrewDay && entry.hebrewMonth
        ? `${hebDay(entry.hebrewDay)} ${entry.hebrewMonth}`
        : '';
      li.innerHTML = `
        <span class="mem-name${entry._today ? ' mem-today' : ''}">${entry.name || ''}</span>
        <span class="mem-date">${dateStr}</span>
      `;
      list.appendChild(li);
    }
    updateAutoScroll(qs('.memorial-card'));
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
    if (!active.length) { container.style.display = 'none'; return; }
    container.style.display = 'block';
    ticker.textContent = active.map(a => a.text).join('   •   ');
  }

  function renderUpcoming() {
    try {
      const now = new Date();
      const hdate = getEffectiveHDate();
      const end = new HDate(new Date(now.getTime() + 14 * 86400000));
      const events = HebrewCalendar.calendar({
        start: hdate, end, il: true, locale: 'he',
        candlelighting: false, sedrot: false, omer: false,
      });
      const upcoming = events.find(e => (e.getFlags() & FLAG_CHAG));
      qs('#upcoming-event').textContent = upcoming ? upcoming.render('he') : '';
    } catch { /* ignore */ }
  }

  async function refreshAll() {
    try {
      await loadData();
      renderHeader();
      renderZmanim();
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
