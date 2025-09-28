
/*!
 * Essential Radio - nowplaying.js
 * Handles schedule-based FIXED periods and ALT/MAIN source labelling,
 * plus robust iTunes (music-only) artwork fetching with caching.
 *
 * v1.0.0
 */

(function (global) {
  'use strict';

  const DEFAULTS = {
    scheduleUrl: 'https://player-green.vercel.app/schedule.json',
    // Selectors
    showTitleSel: '#showTitle',
    presenterSel: '#showPresenter',
    sourceSel: '#showSource',
    artworkImgSel: '#artworkImg',
    statusSel: '',

    // Polling
    refreshMs: 20000,

    // Artwork
    region: 'GB',

    // Version string for cache-busting (optional)
    appVersion: ''
  };

  const state = {
    schedule: [],
    artworkCache: Object.create(null),
    lastFixedKey: '',
    timer: null
  };

  // --- Utilities -----------------------------------------------------------

  function qs(sel) { return sel ? document.querySelector(sel) : null; }
  function text(el, s) { if (el) el.textContent = s || ''; }
  function setSrc(img, url) { if (img && url) img.src = url; }
  function safeJSON(res) { return res.ok ? res.json() : Promise.reject(new Error(res.status)); }

  function pad2(n) { return String(n).padStart(2, '0'); }

  function localTimeParts(d) {
    return {
      dow: d.getDay(), // 0=Sun..6=Sat
      h: d.getHours(),
      m: d.getMinutes()
    };
  }

  const DAY_MAP = {
    'sun': 0, 'mon': 1, 'tue': 2, 'wed': 3, 'thu': 4, 'fri': 5, 'sat': 6
  };

  function parseTimeHM(str) {
    // "19:00" -> {h:19,m:0}
    const m = /^(\d{1,2}):(\d{2})$/.exec(str || '');
    if (!m) return null;
    return { h: Math.min(23, parseInt(m[1], 10)), m: Math.min(59, parseInt(m[2], 10)) };
  }

  function timeToMinutes(h, m) { return h * 60 + m; }

  function matchDay(entryDays, nowDow) {
    if (!entryDays || !entryDays.length) return true; // no filter
    return entryDays.some(d => {
      if (typeof d === 'number') return d === nowDow;
      const k = String(d).trim().slice(0,3).toLowerCase();
      return DAY_MAP[k] === nowDow;
    });
  }

  function inWindow(now, startHM, endHM) {
    // Handles cross-midnight, inclusive of start, exclusive of end
    const n = timeToMinutes(now.h, now.m);
    const s = timeToMinutes(startHM.h, startHM.m);
    const e = timeToMinutes(endHM.h, endHM.m);
    if (s === e) return false; // zero-length
    if (s < e) return n >= s && n < e;
    // cross-midnight case
    return n >= s || n < e;
  }

  function normaliseEntry(e) {
    // Accept flexible fields: 'presenter' or 'dj', 'source' defaults to 'MAIN'
    const start = parseTimeHM(e.start);
    const end = parseTimeHM(e.end);
    if (!start || !end) return null;
    return {
      title: e.title || '',
      presenter: e.presenter || e.dj || '',
      fixed: !!e.fixed,
      source: (e.source || 'MAIN').toUpperCase() === 'ALT' ? 'ALT' : 'MAIN',
      days: Array.isArray(e.days) ? e.days : (e.day ? [e.day] : []),
      startHM: start,
      endHM: end
    };
  }

  function findCurrentEntry(schedule) {
    const now = localTimeParts(new Date());
    return schedule.find(e =>
      matchDay(e.days, now.dow) && inWindow(now, e.startHM, e.endHM)
    ) || null;
  }

  // --- Artwork (iTunes, music-only) ---------------------------------------

  async function getTrackArtwork(query, region, appVersion) {
    if (!query) return '';
    const cacheHit = state.artworkCache[query];
    if (cacheHit) return cacheHit;
    try {
      const url = `https://itunes.apple.com/search?media=music&entity=musicTrack&country=${encodeURIComponent(region)}&limit=5&term=${encodeURIComponent(query)}${appVersion ? `&v=${encodeURIComponent(appVersion)}` : ''}`;
      const res = await fetch(url);
      const d = await res.json();
      const hit = (d.results || []).find(r =>
        (r.kind === 'song' || r.wrapperType === 'track') && r.artworkUrl100
      );
      if (hit) {
        const hi = hit.artworkUrl100.replace('100x100','300x300');
        state.artworkCache[query] = hi;
        return hi;
      }
    } catch (e) {
      console.warn('[nowplaying] artwork fetch failed', e);
    }
    return '';
  }

  // --- Core logic ----------------------------------------------------------

  async function loadSchedule(url) {
    const res = await fetch(url, { cache: 'no-store' });
    const raw = await safeJSON(res);
    const arr = Array.isArray(raw) ? raw : (raw.schedule || raw.items || []);
    const normalised = arr.map(normaliseEntry).filter(Boolean);
    state.schedule = normalised;
    return normalised;
  }

  async function tick(cfg) {
    const showEl = qs(cfg.showTitleSel);
    const djEl = qs(cfg.presenterSel);
    const srcEl = qs(cfg.sourceSel);
    const artImg = qs(cfg.artworkImgSel);
    const statusEl = qs(cfg.statusSel);

    try {
      // Lazy-load schedule on first run or every 15 minutes
      if (!state._loadedAt || (Date.now() - state._loadedAt) > 15 * 60 * 1000) {
        await loadSchedule(cfg.scheduleUrl);
        state._loadedAt = Date.now();
      }

      const cur = findCurrentEntry(state.schedule);

      if (cur && cur.fixed) {
        // Fixed: show show title/presenter and source label
        text(showEl, cur.title || 'On Air');
        text(djEl, cur.presenter || '');
        text(srcEl, cur.source);
        const key = cur.title + '|' + cur.presenter;
        if (key !== state.lastFixedKey) {
          state.lastFixedKey = key;
          // Optional: fetch artwork by show title to dress the page
          if (artImg) {
            const art = await getTrackArtwork(cur.title, cfg.region, cfg.appVersion);
            if (art) setSrc(artImg, art);
          }
        }
        if (statusEl) text(statusEl, 'fixed slot');
      } else {
        // Not fixed: generic branding
        text(showEl, 'More music soon');
        text(djEl, '');
        text(srcEl, 'MAIN');
        state.lastFixedKey = '';
        if (statusEl) text(statusEl, 'non-fixed slot');
      }
    } catch (e) {
      console.warn('[nowplaying] tick error', e);
      if (statusEl) text(statusEl, 'error');
    }
  }

  function startLoop(cfg) {
    if (state.timer) clearInterval(state.timer);
    tick(cfg); // run immediately
    state.timer = setInterval(() => tick(cfg), cfg.refreshMs);
  }

  // --- Public API ----------------------------------------------------------

  const NowPlaying = {
    init(options) {
      const cfg = Object.assign({}, DEFAULTS, options || {});
      // Save version globally if provided
      if (cfg.appVersion) {
        try { window.APP_VERSION = String(cfg.appVersion); } catch {}
      }
      startLoop(cfg);
      return cfg;
    }
  };

  // UMD-ish export
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = NowPlaying;
  } else {
    global.NowPlaying = NowPlaying;
  }

})(typeof window !== 'undefined' ? window : this);
