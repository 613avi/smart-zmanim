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

  const HEB_MONTHS = ['ניסן','אייר','סיון','תמוז','אב','אלול','תשרי','חשון','כסלו','טבת','שבט','אדר','אדר א׳','אדר ב׳'];
  const HEB_DOW = ['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'];

  const state = {
    config: null,
    rooms: [],
    memorial: [],
    announcements: [],
    specialTimes: [],
    activeRoomId: null,
  };

  // ------- helpers -------
  const qs = (sel) => document.querySelector(sel);
  const fmtTime = (d) => {
    if (!d || !(d instanceof Date) || isNaN(d)) return '';
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  };
  const addMinutes = (date, mins) => new Date(date.getTime() + mins * 60000);
  const roundToMinute = (date) => {
    const d = new Date(date);
    d.setSeconds(0, 0);
    return d;
  };

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
    state.rooms = rooms.rooms || [];
    state.memorial = memorial.entries || [];
    state.announcements = announcements.entries || [];
    state.specialTimes = specialTimes.entries || [];

    // active room from URL ?room=
    const params = new URLSearchParams(location.search);
    const fromUrl = params.get('room');
    if (fromUrl && state.rooms.find(r => r.id === fromUrl)) {
      state.activeRoomId = fromUrl;
    } else if (state.rooms.length) {
      state.activeRoomId = state.rooms[0].id;
    }
  }

  // ------- rendering -------
  function renderHeader() {
    qs('#synagogue-name').textContent = state.config.synagogueName || '';
    const now = new Date();
    const hdate = new HDate(now);
    qs('#hebrew-date').textContent = hdate.renderGematriya();
    const dow = HEB_DOW[now.getDay()];
    qs('#gregorian-date').textContent = `יום ${dow}, ${now.toLocaleDateString('he-IL', {day:'numeric', month:'long', year:'numeric'})}`;

    // parasha / special day
    let parashaText = '';
    try {
      const events = HebrewCalendar.calendar({
        start: hdate,
        end: hdate,
        sedrot: true,
        il: true,
        locale: 'he',
      });
      const parashaEv = events.find(e => e.getFlags && (e.getFlags() & FLAG_PARSHA));
      if (parashaEv) {
        parashaText = parashaEv.render('he');
      } else {
        // for weekday, find upcoming parasha (next saturday)
        const daysToShabbat = (6 - now.getDay() + 7) % 7 || 7;
        const shabbat = new HDate(new Date(now.getTime() + daysToShabbat * 86400000));
        const wkEvents = HebrewCalendar.calendar({
          start: shabbat, end: shabbat, sedrot: true, il: true, locale: 'he'
        });
        const pEv = wkEvents.find(e => e.getFlags && (e.getFlags() & FLAG_PARSHA));
        if (pEv) parashaText = pEv.render('he');
      }
    } catch (e) { console.warn('parasha error', e); }
    qs('#parasha').textContent = parashaText;
    qs('.parasha-sep').style.display = parashaText ? '' : 'none';
  }

  function renderClock() {
    const now = new Date();
    const h = String(now.getHours()).padStart(2,'0');
    const m = String(now.getMinutes()).padStart(2,'0');
    const s = String(now.getSeconds()).padStart(2,'0');
    qs('#current-time').textContent = `${h}:${m}`;
    qs('#current-seconds').textContent = s;
  }

  function getZmanimForToday() {
    return new Zmanim(makeGeo(), new Date());
  }

  const ZMANIM_DEFS = [
    { key: 'alotHaShachar', label: 'עלות השחר', fn: z => z.alotHaShachar() },
    { key: 'misheyakir',    label: 'משיכיר',     fn: z => z.misheyakir() },
    { key: 'sunrise',       label: 'הנץ החמה',    fn: z => z.sunrise() },
    { key: 'sofZmanShma',   label: 'סוף זמן ק״ש', fn: z => z.sofZmanShma() },
    { key: 'sofZmanTfilla', label: 'סוף זמן תפילה', fn: z => z.sofZmanTfilla() },
    { key: 'chatzot',       label: 'חצות היום',   fn: z => z.chatzot() },
    { key: 'minchaGedola',  label: 'מנחה גדולה',   fn: z => z.minchaGedola() },
    { key: 'minchaKetana',  label: 'מנחה קטנה',    fn: z => z.minchaKetana() },
    { key: 'plagHaMincha',  label: 'פלג המנחה',    fn: z => z.plagHaMincha() },
    { key: 'sunset',        label: 'שקיעת החמה',   fn: z => z.sunset() },
    { key: 'tzeit',         label: 'צאת הכוכבים',  fn: z => z.tzeit() },
  ];

  function renderZmanim() {
    const tbody = qs('#zmanim-table tbody');
    tbody.innerHTML = '';
    const zmanim = getZmanimForToday();
    const displayed = state.config.displayedZmanim || {};
    for (const def of ZMANIM_DEFS) {
      if (!displayed[def.key]) continue;
      let time = '';
      try {
        const d = def.fn(zmanim);
        time = fmtTime(d instanceof Date ? d : new Date(d));
      } catch (e) { /* ignore */ }
      if (!time) continue;
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${def.label}</td><td>${time}</td>`;
      tbody.appendChild(tr);
    }
  }

  function renderRoomSwitcher() {
    const container = qs('#room-switcher');
    container.innerHTML = '';
    if (state.rooms.length <= 1) return;
    for (const room of state.rooms) {
      const btn = document.createElement('button');
      btn.textContent = room.name;
      if (room.id === state.activeRoomId) btn.classList.add('active');
      btn.addEventListener('click', () => {
        state.activeRoomId = room.id;
        const url = new URL(location.href);
        url.searchParams.set('room', room.id);
        history.replaceState({}, '', url);
        renderRoomSwitcher();
        renderTefillot();
      });
      container.appendChild(btn);
    }
  }

  function computeShabbatTimes(room) {
    const geo = makeGeo();
    const now = new Date();
    const dow = now.getDay(); // 0=Sun..6=Sat
    // find this friday (if today is sat, use today-1)
    let friday = new Date(now);
    if (dow === 6) friday.setDate(now.getDate() - 1);
    else if (dow === 5) { /* today is friday */ }
    else {
      const daysToFri = (5 - dow + 7) % 7;
      friday.setDate(now.getDate() + daysToFri);
    }
    friday.setHours(12, 0, 0, 0);
    const saturday = new Date(friday); saturday.setDate(friday.getDate() + 1);

    const zFri = new Zmanim(geo, friday);
    const zSat = new Zmanim(geo, saturday);

    // candle lighting default 18 min before sunset (israel often uses 40 in Jerusalem; keep 18)
    const candleMinutes = state.config.location.candleLightingMinutes || 18;
    const candle = addMinutes(zFri.sunset(), -candleMinutes);
    const havdalah = zSat.tzeit(8.5); // ~3 stars

    const minchaErevOffset = Number(room.shabbat?.minchaErevOffset ?? -15);
    const arvitOffset = Number(room.shabbat?.arvitMotzashOffset ?? 30);

    return {
      candle,
      havdalah,
      minchaErev: addMinutes(candle, minchaErevOffset),
      arvitMotzash: addMinutes(havdalah, arvitOffset),
    };
  }

  function renderTefillot() {
    const container = qs('#tefillot-rooms');
    container.innerHTML = '';
    if (!state.rooms.length) {
      container.innerHTML = '<div class="empty-state">לא הוגדרו חדרי תפילה</div>';
      return;
    }

    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const isShabbat = now.getDay() === 6;
    const isErevShabbat = now.getDay() === 5;

    // Decide which rooms to show: active room, or all if "all" selected
    const rooms = state.activeRoomId === 'all'
      ? state.rooms
      : state.rooms.filter(r => r.id === state.activeRoomId);

    for (const room of rooms) {
      const block = document.createElement('div');
      block.className = 'room-block';
      const title = rooms.length > 1 ? `<h3>${room.name}</h3>` : '';
      const rows = [];

      if (isShabbat || isErevShabbat) {
        const st = computeShabbatTimes(room);
        rows.push(['הדלקת נרות', fmtTime(st.candle)]);
        if (room.shabbat?.kabbalat) rows.push(['קבלת שבת', room.shabbat.kabbalat]);
        if (room.shabbat?.minchaErevOffset != null) rows.push(['מנחה ערב שבת', fmtTime(st.minchaErev)]);
        if (room.shabbat?.shacharit) rows.push(['שחרית שבת', room.shabbat.shacharit]);
        if (room.shabbat?.mincha) rows.push(['מנחה שבת', room.shabbat.mincha]);
        rows.push(['צאת השבת', fmtTime(st.havdalah)]);
        if (room.shabbat?.arvitMotzashOffset != null) rows.push(['ערבית מוצ״ש', fmtTime(st.arvitMotzash)]);
      } else {
        if (room.weekday?.shacharit) rows.push(['שחרית', room.weekday.shacharit]);
        if (room.weekday?.shacharit2) rows.push(['שחרית ב׳', room.weekday.shacharit2]);
        if (room.weekday?.mincha) rows.push(['מנחה', room.weekday.mincha]);
        if (room.weekday?.arvit) rows.push(['ערבית', room.weekday.arvit]);
      }

      // overlay special times for today
      const todayOverrides = state.specialTimes.filter(e =>
        e.date === todayStr && (!e.roomId || e.roomId === room.id || e.roomId === '*')
      );
      for (const ov of todayOverrides) {
        const existing = rows.findIndex(r => r[0] === ov.label);
        if (existing >= 0) rows[existing][1] = ov.time;
        else rows.push([ov.label, ov.time]);
      }

      if (room.notes) {
        // optional — nothing for now
      }

      const rowsHtml = rows.length
        ? `<table><tbody>${rows.map(([n,t]) => `<tr><td>${n}</td><td>${t||'—'}</td></tr>`).join('')}</tbody></table>`
        : `<div class="empty-state">אין זמני תפילה</div>`;
      block.innerHTML = title + rowsHtml;
      container.appendChild(block);
    }

    qs('#tefillot-title').textContent = isShabbat || isErevShabbat ? 'זמני תפילות שבת' : 'זמני תפילות';
  }

  function hebrewDateMatches(entry, hdate) {
    // entry.hebrewMonth: 'ניסן'... or 1-based number; entry.hebrewDay: 1..30
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
    // Sort: today first, then alphabetical
    const items = [...state.memorial].map(e => ({ ...e, _today: hebrewDateMatches(e, today) }));
    items.sort((a, b) => {
      if (a._today && !b._today) return -1;
      if (!a._today && b._today) return 1;
      return (a.name || '').localeCompare(b.name || '', 'he');
    });
    for (const entry of items.slice(0, 40)) {
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
    } catch (e) { /* ignore */ }
  }

  // ------- main refresh -------
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
    // no data fetch, just re-render time-sensitive bits
    renderHeader();
    renderZmanim();
    renderTefillot();
    renderMemorial();
  }

  // ------- boot -------
  document.addEventListener('DOMContentLoaded', async () => {
    await refreshAll();
    renderClock();
    setInterval(renderClock, 1000);
    setInterval(lightRefresh, 60 * 1000);       // every minute: re-render
    setInterval(refreshAll, 5 * 60 * 1000);     // every 5 min: reload data
  });
})();
