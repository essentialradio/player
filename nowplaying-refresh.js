// nowplaying-refresh.js (merged: Now Playing + Recently Played)
// Robust auto-refresh for both Now Playing and Recently Played.
// Drop this file in your web root (e.g., /public) and include with:
//   <script src="/nowplaying-refresh.js?v=20251006"></script>
//
// Exposes (on window):
//   - startIntervals()
//   - stopIntervals()
//   - fetchNowPlaying()
//   - fetchRecentFromGitHub()
//
// Assumptions:
// - DOM contains #np-artist, #np-title for Now Playing
// - DOM contains #recently-played container for the Recent list (HTML injected)
//
// Notes:
// - Uses cache:'no-store' + cache-busting query to prevent stale mobile caches.
// - Handles visibility changes (pauses when tab hidden, resumes on focus).
// - Defensive: won't throw if elements are missing.

(() => {
  'use strict';

  // ---- Config --------------------------------------------------------------
  const NP_IDS = {
    artist: 'np-artist',
    title:  'np-title',
  };

  const RECENT_CONTAINER_ID = 'recently-played';

  const REFRESH_MS = 15000; // 15s
  const TIMEOUT_MS = 8000;  // 8s per request

  // Endpoints (edit if your paths differ)
  const NOWPLAYING_PRIMARY = '/api/latestTrack';
  const NOWPLAYING_FALLBACK = '/player/latestTrack.json';
  // We'll try HTML first, then JSON; whichever returns OK we inject as text/HTML
  const RECENT_HTML_ENDPOINT = '/player/recently-played.html';
  const RECENT_JSON_ENDPOINT = '/player/recently-played.json';

  // ---- State ---------------------------------------------------------------
  let lastArtist = '';
  let lastTitle  = '';

  let nowPlayingInterval = null;
  let recentInterval = null;
  let started = false;

  // ---- Utils ---------------------------------------------------------------
  function withTimeout(promise, ms) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    return {
      fetch: (url, init={}) => {
        const merged = { ...init, signal: ctrl.signal };
        return fetch(url, merged).finally(() => clearTimeout(t));
      }
    };
  }

  async function fetchJSON(url, { timeoutMs = TIMEOUT_MS } = {}) {
    const { fetch: f } = withTimeout(fetch, timeoutMs);
    const res = await f(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function fetchTEXT(url, { timeoutMs = TIMEOUT_MS } = {}) {
    const { fetch: f } = withTimeout(fetch, timeoutMs);
    const res = await f(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  }

  function setText(id, text) {
    const el = document.getElementById(id);
    if (el && el.textContent !== text) el.textContent = text;
  }

  function updateNowPlaying(artist, title) {
    if (artist && artist !== lastArtist) {
      setText(NP_IDS.artist, artist);
      lastArtist = artist;
    }
    if (title && title !== lastTitle) {
      setText(NP_IDS.title, title);
      lastTitle = title;
    }
  }

  function normaliseFromPayload(data) {
    let artist = '';
    let title  = '';

    if (data && typeof data === 'object') {
      // Common shape: { artist, title }
      if (data.artist || data.title) {
        artist = String(data.artist || '').trim();
        title  = String(data.title  || '').trim();
      }
      // Alternative shape: { nowPlaying: "Artist - Title" }
      else if (typeof data.nowPlaying === 'string') {
        const s = data.nowPlaying;
        const i = s.indexOf(' - ');
        if (i > 0) {
          artist = s.slice(0, i).trim();
          title  = s.slice(i + 3).trim();
        }
      }
      // PlayIt ALT/Fixed modes sometimes provide { source, artist, title }
      else if (data.source && (data.artist || data.title)) {
        artist = String(data.artist || '').trim();
        title  = String(data.title  || '').trim();
      }
    }

    return { artist, title };
  }

  // ---- Now Playing ---------------------------------------------------------
  async function fetchNowPlaying() {
    try {
      // Primary
      let data = await fetchJSON(`${NOWPLAYING_PRIMARY}?ts=${Date.now()}`);
      let { artist, title } = normaliseFromPayload(data);

      // Fallback JSON
      if (!artist && !title) {
        try {
          data = await fetchJSON(`${NOWPLAYING_FALLBACK}?ts=${Date.now()}`, { timeoutMs: 5000 });
          ({ artist, title } = normaliseFromPayload(data));
        } catch {
          // ignore
        }
      }

      if (artist || title) {
        updateNowPlaying(artist, title);
      }
    } catch (e) {
      // Keep previous values
      // console.debug('[NP] refresh failed:', e);
    }
  }

  // ---- Recently Played -----------------------------------------------------
  function injectRecentHTML(html) {
    const el = document.getElementById(RECENT_CONTAINER_ID);
    if (!el) return;
    // Accept either raw HTML or JSON string containing HTML; we just inject the string.
    // If your endpoint returns JSON with a property (e.g., {html:"..."}), adapt here.
    el.innerHTML = html;
  }

  async function fetchRecentFromGitHub() {
    // Try HTML endpoint first
    try {
      const html = await fetchTEXT(`${RECENT_HTML_ENDPOINT}?ts=${Date.now()}`, { timeoutMs: 6000 });
      if (html && html.length) {
        injectRecentHTML(html);
        return;
      }
    } catch {
      // fall through
    }

    // Then try JSON (stringified HTML)
    try {
      const maybeJSON = await fetchJSON(`${RECENT_JSON_ENDPOINT}?ts=${Date.now()}`, { timeoutMs: 6000 });
      if (typeof maybeJSON === 'string') {
        injectRecentHTML(maybeJSON);
      } else if (maybeJSON && typeof maybeJSON.html === 'string') {
        injectRecentHTML(maybeJSON.html);
      }
    } catch (e) {
      // console.debug('[RECENT] refresh failed:', e);
    }
  }

  // ---- Interval Control ----------------------------------------------------
  function startIntervals() {
    if (started) return;
    started = true;

    // Immediate refresh
    fetchNowPlaying();
    fetchRecentFromGitHub();

    // Set up polling
    if (!nowPlayingInterval) {
      nowPlayingInterval = setInterval(fetchNowPlaying, REFRESH_MS);
    }
    if (!recentInterval) {
      recentInterval = setInterval(fetchRecentFromGitHub, REFRESH_MS);
    }
  }

  function stopIntervals() {
    started = false;
    if (nowPlayingInterval) {
      clearInterval(nowPlayingInterval);
      nowPlayingInterval = null;
    }
    if (recentInterval) {
      clearInterval(recentInterval);
      recentInterval = null;
    }
  }

  // ---- Visibility Handling -------------------------------------------------
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      // Refresh immediately when returning to tab
      fetchNowPlaying();
      fetchRecentFromGitHub();
      startIntervals();
    } else {
      // Pause while hidden to save battery/network
      stopIntervals();
    }
  });

  // ---- Auto-start when DOM is ready ---------------------------------------
  function onReady(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else {
      fn();
    }
  }

  onReady(() => {
    startIntervals();
  });

  // ---- Export public API ---------------------------------------------------
  window.fetchNowPlaying = fetchNowPlaying;
  window.fetchRecentFromGitHub = fetchRecentFromGitHub;
  window.startIntervals = startIntervals;
  window.stopIntervals = stopIntervals;
})();
