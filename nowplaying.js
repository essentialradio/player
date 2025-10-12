/*!
 * Essential Radio - nowplaying.js (ALT+FIXED patched)
 * v1.0.2
 * - ALT: fallback to latestTrack.json in non-fixed slots
 * - FIXED: suppress PlayIt/cart info; force 'FIXED' source; hide progress
 */

(function (global) {
  'use strict';

  const DEFAULTS = {
    scheduleUrl: 'https://player-green.vercel.app/schedule.json',
    latestUrl: '/latestTrack.json',

    // Progress selectors
    progressSel: '[data-progress]',
    progressFillSel: '[data-progress-fill]',

    // Progress timings
    progressUpdateMs: 1000,       // repaint the bar every second
    fallbackRefreshMs: 15000,     // how often to refetch latest if timing unknown

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
    appVersion: '',

    // Behaviour
    hideProgressInFixed: true,           // hide progress bar in fixed windows
    showMainTrackInNonFixed: true        // show PlayIt track in non-fixed MAIN
  };

  const state = {
    schedule: [],
    latest: null,
    tickTimer: null,
    refreshTimer: null,

    artworkCache: Object.create(null),
    lastFixedKey: '',
    isFixed: false,
    timer: null
  };

  // --- Utilities -----------------------------------------------------------

  function qs(sel) { return sel ? document.querySelector(sel) : null; }
  function qsa(sel){ return sel ? Array.from(document.querySelectorAll(sel)) : []; }
  function text(el, s) { if (el) el.textContent = s || ''; }
  function setSrc(img, url) { if (img && url) img.src = url; }
  function safeJSON(res) { return res.ok ? res.json() : Promise.reject(new Error(res.status)); }

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

  // --- Progress helpers ----------------------------------------------------

  function computePct(item){
    if (!item) return 0;
    const startMs = Date.parse(item.startTime || item.start || 0) || 0;
    const endMs = item.endTime ? Date.parse(item.endTime) : (startMs + ((item.duration || 0) * 1000));
    const span = Math.max(1, endMs - startMs);
    let pct = ((Date.now() - startMs) / span) * 100;
    if (!Number.isFinite(pct)) pct = 0;
    return Math.min(100, Math.max(0, pct));
  }

  function shouldShowProgress(cfg, item){
    if (!item) return false;
    if (cfg.hideProgressInFixed && state.isFixed) return false;
    const src = String(item.source || '').toUpperCase();
    const ind = item.indeterminate === true;
    return src !== 'ALT' && !ind;
  }

  function renderProgress(cfg, item, instant=false){
    const els = qsa(cfg.progressSel);
    const fills = qsa(cfg.progressFillSel);
    if (!els.length || !fills.length) return;

    const show = shouldShowProgress(cfg, item);
    els.forEach(el => el.toggleAttribute('hidden', !show));
    if (!show) return;

    const pct = computePct(item);
    fills.forEach(fill => {
      if (instant) fill.style.transition = 'none';
      fill.style.width = pct + '%';
      if (instant) requestAnimationFrame(() => { fill.style.transition = ''; });
    });
  }

  async function loadLatest(cfg){
    try{
      const r = await fetch(cfg.latestUrl, { cache: 'no-store' });
      state.latest = await r.json();
      return state.latest;
    }catch(e){
      console.warn('[nowplaying] latest fetch failed', e);
      return null;
    }
  }

  function nextRefreshDelay(cfg, item){
    if (!item) return cfg.fallbackRefreshMs;
    const src = String(item.source || '').toUpperCase();
    if (src === 'ALT') return cfg.fallbackRefreshMs;
    const startMs = Date.parse(item.startTime || item.start || 0) || 0;
    const endMs = item.endTime ? Date.parse(item.endTime) : (startMs + ((item.duration || 0) * 1000));
    const now = Date.now();
    if (!endMs || endMs <= now) return 2000;
    return Math.max(2000, Math.min(30000, (endMs - now) + 500));
  }

  function startProgressLoops(cfg){
    loadLatest(cfg).then(()=>{
      renderProgress(cfg, state.latest, /*instant*/true);
      scheduleLatestRefresh(cfg, state.latest);
    });

    if (state.tickTimer) clearInterval(state.tickTimer);
    state.tickTimer = setInterval(() => {
      renderProgress(cfg, state.latest);
    }, cfg.progressUpdateMs);

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden){
        loadLatest(cfg).then(()=>{
          renderProgress(cfg, state.latest, /*instant*/true);
          scheduleLatestRefresh(cfg, state.latest);
        });
      }
    });
  }

  function scheduleLatestRefresh(cfg, item){
    if (state.refreshTimer) clearTimeout(state.refreshTimer);
    const delay = nextRefreshDelay(cfg, item);
    state.refreshTimer = setTimeout(async () => {
      await loadLatest(cfg);
      renderProgress(cfg, state.latest, /*instant*/true);
      scheduleLatestRefresh(cfg, state.latest);
    }, delay);
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
      if (!state._loadedAt || (Date.now() - state._loadedAt) > 15 * 60 * 1000) {
        await loadSchedule(cfg.scheduleUrl);
        state._loadedAt = Date.now();
      }

      const cur = findCurrentEntry(state.schedule);

      if (cur && cur.fixed) {
        state.isFixed = true;

        text(showEl, cur.title || 'On Air');
        text(djEl, cur.presenter || '');
        text(srcEl, 'FIXED');

        const key = cur.title + '|' + cur.presenter;
        if (key !== state.lastFixedKey) {
          state.lastFixedKey = key;
          if (artImg) {
            const art = await getTrackArtwork(cur.title, cfg.region, cfg.appVersion);
            if (art) setSrc(artImg, art);
          }
        }
        if (statusEl) text(statusEl, 'fixed slot');
      } else {
        state.isFixed = false;

        const latest = state.latest || {};
        const srcFromSched = (cur && cur.source) ? String(cur.source).toUpperCase() : '';
        const src = srcFromSched || (String(latest.source || '').toUpperCase() || 'MAIN');

        const artist = latest.artist || '';
        const title = latest.title || '';

        const showMain = cfg.showMainTrackInNonFixed !== false;
        const displayTitle = (src === 'ALT')
          ? (title || 'Alternative Source')
          : (showMain && title ? title : 'More music soon');

        text(showEl, displayTitle);
        text(djEl, showMain ? artist : '');
        text(srcEl, src || 'MAIN');

        if (artImg && (artist || title) && (src === 'ALT' || showMain)) {
          const art = await getTrackArtwork(`${artist} ${title}`.trim(), cfg.region, cfg.appVersion);
          if (art) setSrc(artImg, art);
        }

        state.lastFixedKey = '';
        if (statusEl) text(statusEl, src === 'ALT' ? 'ALT source' : 'non-fixed slot');
      }
    } catch (e) {
      console.warn('[nowplaying] tick error', e);
      if (statusEl) text(statusEl, 'error');
    }
  }

  function startLoop(cfg) {
    if (state.timer) clearInterval(state.timer);
    tick(cfg);
    state.timer = setInterval(() => tick(cfg), cfg.refreshMs);
  }

  const NowPlaying = {
    init(options) {
      const cfg = Object.assign({}, DEFAULTS, options || {});
      if (cfg.appVersion) {
        try { window.APP_VERSION = String(cfg.appVersion); } catch {}
      }
      startLoop(cfg);
      startProgressLoops(cfg);
      return cfg;
    }
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = NowPlaying;
  } else {
    global.NowPlaying = NowPlaying;
  }

})(typeof window !== 'undefined' ? window : this);
