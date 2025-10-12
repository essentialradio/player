/*!
 * Essential Radio - nowplaying.js (v1.1.1 - flash resistant, mapped selectors)
 *
 * - Maps to your DOM: #currentShow, #now-playing, #artwork
 * - Strict FIXED: never show cart info; clears track line
 * - Non-fixed: shows latest track; does NOT overwrite with empty when latest missing
 * - Debounced refresh: avoids flicker between schedule/initial load
 */

(function (global) {
  'use strict';

  const DEFAULTS = {
    scheduleUrl: 'schedule.json',
    latestUrl: 'latestTrack.json',

    // Selectors mapped to your index.html
    showTitleSel: '#currentShow',   // ON AIR NOW headline
    presenterSel: '',               // no presenter element in your HTML
    trackSel: '#now-playing',       // the line inside the card
    artworkImgSel: '#artwork',
    sourceSel: '',                  // not displayed on your page
    statusSel: '',

    // Polling
    refreshMs: 15000,
    // Behaviour
    hideProgressInFixed: true,
    showMainTrackInNonFixed: true
  };

  const state = {
    schedule: [],
    latest: null,
    lastShownTrack: '',
    lastFixedKey: '',
    isFixed: false,
    timer: null,
    _loadedAt: 0
  };

  // --- Utils ---------------------------------------------------------------
  function qs(sel){ return sel ? document.querySelector(sel) : null; }
  function text(el, s){ if (!el) return; el.textContent = s == null ? '' : s; }
  function setSrc(img, url){ if (img && url) img.src = url; }
  function safeJSON(res){ return res.ok ? res.json() : Promise.reject(new Error(res.status)); }

  const DAY_MAP = { 'sun':0,'mon':1,'tue':2,'wed':3,'thu':4,'fri':5,'sat':6 };
  function parseHM(str){ const m = /^(\d{1,2}):(\d{2})$/.exec(str||''); return m ? {h:+m[1], m:+m[2]} : null; }
  function mins(h,m){ return h*60+m; }
  function matchDay(days, dow){
    if (!days || !days.length) return true;
    return days.some(d => (typeof d==='number' ? d : DAY_MAP[String(d).slice(0,3).toLowerCase()]) === dow);
  }
  function inWindow(now, s, e){
    const n = mins(now.getHours(), now.getMinutes());
    const S = mins(s.h, s.m), E = mins(e.h, e.m);
    if (S === E) return false;
    return S < E ? (n >= S && n < E) : (n >= S || n < E);
  }
  function normEntry(e){
    const s = parseHM(e.start), ed = parseHM(e.end);
    if (!s || !ed) return null;
    return {
      title: e.title || '',
      presenter: e.presenter || e.dj || '',
      fixed: !!e.fixed,
      source: (e.source || 'MAIN').toUpperCase() === 'ALT' ? 'ALT' : 'MAIN',
      days: Array.isArray(e.days) ? e.days : (e.day ? [e.day] : []),
      s, ed
    };
  }
  function findCurrentEntry(schedule){
    const now = new Date();
    const dow = now.getDay();
    return schedule.find(e => matchDay(e.days, dow) && inWindow(now, e.s, e.ed)) || null;
  }

  // --- Data fetch ----------------------------------------------------------
  async function loadSchedule(url){
    const res = await fetch(url, { cache: 'no-store' });
    const raw = await safeJSON(res);
    const arr = Array.isArray(raw) ? raw : (raw.schedule || raw.items || []);
    state.schedule = arr.map(normEntry).filter(Boolean);
    return state.schedule;
  }
  async function loadLatest(url){
    try{
      const r = await fetch(url + (url.includes('?') ? '&' : '?') + 't=' + Date.now(), { cache: 'no-store' });
      state.latest = await r.json();
      return state.latest;
    }catch(e){
      console.warn('[nowplaying] latest fetch failed', e);
      return null;
    }
  }

  function detectFixed(cur, latest){
    if (cur && cur.fixed) return true;
    if (latest && String(latest.source || '').toUpperCase() === 'FIXED') return true;
    return false;
  }

  // --- Render --------------------------------------------------------------
  async function tick(cfg){
    const showEl = qs(cfg.showTitleSel);
    const trackEl = qs(cfg.trackSel);
    const artImg = qs(cfg.artworkImgSel);
    const djEl = qs(cfg.presenterSel);
    const srcEl = qs(cfg.sourceSel);

    if (!state._loadedAt || (Date.now() - state._loadedAt) > 15*60*1000){
      await loadSchedule(cfg.scheduleUrl);
      state._loadedAt = Date.now();
    }
    await loadLatest(cfg.latestUrl);

    const cur = findCurrentEntry(state.schedule);
    const latest = state.latest || {};
    const fixedNow = detectFixed(cur, latest);
    state.isFixed = fixedNow;

    if (fixedNow){
      const title = (cur && cur.title) ? cur.title : 'On Air';
      const presenter = (cur && cur.presenter) ? cur.presenter : '';
      text(showEl, title);
      if (djEl) text(djEl, presenter);
      if (srcEl) text(srcEl, 'FIXED');

      // Only clear if we previously showed something, to avoid replacing "Loading…"
      if (state.lastShownTrack){
        text(trackEl, '');
        state.lastShownTrack = '';
      }

      // Optional: artwork by show title
      if (artImg && title){
        const art = await itunesArt(title, 'GB', '');
        if (art) setSrc(artImg, art);
      }
      return;
    }

    // Non-fixed
    const srcFromSched = (cur && cur.source) ? String(cur.source).toUpperCase() : '';
    const src = srcFromSched || (String(latest.source || '').toUpperCase() || 'MAIN');
    const artist = latest.artist || '';
    const title = latest.title || '';

    const showMain = cfg.showMainTrackInNonFixed !== false;
    const newTrack = (src === 'ALT')
      ? (title || state.lastShownTrack || '')
      : (showMain && title ? title : (state.lastShownTrack || 'More music soon'));

    if (newTrack){
      if (newTrack !== state.lastShownTrack){
        text(trackEl, newTrack);
        state.lastShownTrack = newTrack;
      }
    }

    if (cur){
      text(showEl, cur.title || 'On Air');
      if (djEl) text(djEl, cur.presenter || '');
    } else {
      text(showEl, 'On Air');
      if (djEl) text(djEl, '');
    }
    if (srcEl) text(srcEl, src);

    if (artImg && (artist || title) && (src === 'ALT' || showMain)){
      const art = await itunesArt(`${artist} ${title}`.trim(), 'GB', '');
      if (art) setSrc(artImg, art);
    }
  }

  const artCache = Object.create(null);
  async function itunesArt(q, region, v){
    if (!q) return '';
    if (artCache[q]) return artCache[q];
    try{
      const url = `https://itunes.apple.com/search?media=music&entity=musicTrack&country=${encodeURIComponent(region)}&limit=5&term=${encodeURIComponent(q)}${v ? `&v=${encodeURIComponent(v)}` : ''}`;
      const r = await fetch(url);
      const d = await r.json();
      const hit = (d.results || []).find(r => (r.kind === 'song' || r.wrapperType === 'track') && r.artworkUrl100);
      if (hit){
        const hi = hit.artworkUrl100.replace('100x100','300x300');
        artCache[q] = hi;
        return hi;
      }
    }catch(e){ console.warn('[art]', e); }
    return '';
  }

  function startLoop(cfg){
    if (state.timer) clearInterval(state.timer);
    tick(cfg);
    state.timer = setInterval(() => tick(cfg), cfg.refreshMs);
  }

  const NowPlaying = {
    init(opts){
      const cfg = Object.assign({}, DEFAULTS, opts||{});
      startLoop(cfg);
      return cfg;
    }
  };

  if (typeof module !== 'undefined' && module.exports){
    module.exports = NowPlaying;
  } else {
    global.NowPlaying = NowPlaying;
  }
})(typeof window !== 'undefined' ? window : this);
