
// nowplaying-refresh.mobile-hardened.js
// Stronger mobile auto-refresh for Now Playing + Recently Played
// Drop-in replacement for nowplaying-refresh.js

(() => {
  'use strict';

  // ---- Config --------------------------------------------------------------
  const NP_IDS = { artist: 'np-artist', title: 'np-title' };
  const RECENT_CONTAINER_ID = 'recently-played';

  // Base refresh cadence
  const FAST_MS = 12000;   // 12s when visible
  const SLOW_MS = 30000;   // 30s when hidden (don't *stop* on mobile)
  const HARD_TIMEOUT = 9000; // per-request timeout

  // Endpoints
  const NOWPLAYING_PRIMARY = '/api/latestTrack';
  const NOWPLAYING_FALLBACK = '/player/latestTrack.json';
  const RECENT_HTML_ENDPOINT = '/player/recently-played.html';
  const RECENT_JSON_ENDPOINT = '/player/recently-played.json';

  // ---- State ---------------------------------------------------------------
  let lastArtist = '';
  let lastTitle = '';
  let schedulerNP = null;
  let schedulerRECENT = null;
  let failNP = 0;
  let failRECENT = 0;

  // ---- Utils ---------------------------------------------------------------
  function nextDelay(fails) {
    // Basic backoff: FAST -> x2 -> cap at 60s
    const base = (document.visibilityState === 'visible') ? FAST_MS : SLOW_MS;
    const mult = Math.min(4, Math.max(1, fails + 1));
    return Math.min(60000, base * mult);
  }

  function abortableFetch(input, { timeout = HARD_TIMEOUT, ...init } = {}) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeout);
    const headers = new Headers(init.headers || {});
    // Extra cache busting
    headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    headers.set('Pragma', 'no-cache');
    headers.set('Expires', '0');
    const url = new URL(typeof input === 'string' ? input : input.url, location.origin);
    url.searchParams.set('ts', Date.now().toString());
    return fetch(url.toString(), {
      cache: 'no-store',
      ...init,
      headers,
      signal: ctrl.signal
    }).finally(() => clearTimeout(t));
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
    let artist = '', title = '';
    if (data && typeof data === 'object') {
      if (data.artist || data.title) {
        artist = String(data.artist || '').trim();
        title  = String(data.title  || '').trim();
      } else if (typeof data.nowPlaying === 'string') {
        const s = data.nowPlaying;
        const i = s.indexOf(' - ');
        if (i > 0) { artist = s.slice(0, i).trim(); title = s.slice(i + 3).trim(); }
      } else if (data.source && (data.artist || data.title)) {
        artist = String(data.artist || '').trim();
        title  = String(data.title  || '').trim();
      }
    }
    return { artist, title };
  }

  // ---- Fetchers ------------------------------------------------------------
    async function doNowPlaying() {
    try {
      // 1) Hit the API first
      let res = await abortableFetch(NOWPLAYING_PRIMARY);
      if (!res.ok) throw new Error('NP primary ' + res.status);
      let json = await res.json();

      // Detect ALT from API payload
      let srcRaw = '';
      if (json && typeof json === 'object') {
        srcRaw = String(
          (json.source ?? json.Source ?? json.mode ?? json.Mode ?? json.Src) || ''
        ).toUpperCase();
      }
      const apiIsALT = (json && json.indeterminate === true) || srcRaw === 'ALT';

      // 2) If API says ALT, use the fallback (Python-written latestTrack.json)
      if (apiIsALT) {
        try {
          const altRes = await abortableFetch(NOWPLAYING_FALLBACK, { timeout: 6000 });
          if (altRes.ok) {
            const altJson = await altRes.json();
            const normAlt = normaliseFromPayload(altJson);
            if (normAlt.artist || normAlt.title) {
              json = altJson; // switch payload to ALT file
            }
          }
        } catch (e) {
          // If ALT file fails, we fall back to whatever API gave us
        }
      }

      let { artist, title } = normaliseFromPayload(json);

      // 3) If still nothing, fall back to the usual secondary endpoint
      if (!artist && !title) {
        try {
          res = await abortableFetch(NOWPLAYING_FALLBACK, { timeout: 6000 });
          if (res.ok) {
            json = await res.json();
            ({ artist, title } = normaliseFromPayload(json));
          }
        } catch (e) {}
      }

      if (artist || title) {
        updateNowPlaying(artist, title);
      }
      failNP = 0;
    } catch (e) {
      failNP++;
      // console.debug('[NP] fail', e);
    } finally {
      clearTimeout(schedulerNP);
      schedulerNP = setTimeout(doNowPlaying, nextDelay(failNP));
    }
  }


  async function doRecent() {
    try {
      // Try HTML first
      let res = await abortableFetch(RECENT_HTML_ENDPOINT, { timeout: 8000 });
      if (res.ok) {
        const html = await res.text();
        if (html && html.length) {
          injectRecentHTML(html);
          failRECENT = 0;
        } else {
          throw new Error('RECENT empty html');
        }
      } else {
        throw new Error('RECENT html ' + res.status);
      }
    } catch {
      try {
        // Fallback to JSON
        const resJ = await abortableFetch(RECENT_JSON_ENDPOINT, { timeout: 8000 });
        if (resJ.ok) {
          const maybeJSON = await resJ.json();
          if (typeof maybeJSON === 'string') injectRecentHTML(maybeJSON);
          else if (maybeJSON && typeof maybeJSON.html === 'string') injectRecentHTML(maybeJSON.html);
        }
        failRECENT = 0;
      } catch (e2) {
        failRECENT++;
        // console.debug('[RECENT] fail', e2);
      }
    } finally {
      clearTimeout(schedulerRECENT);
      schedulerRECENT = setTimeout(doRecent, nextDelay(failRECENT));
    }
  }

  // ---- Lifecycle hooks -----------------------------------------------------
  function kick() {
    clearTimeout(schedulerNP); clearTimeout(schedulerRECENT);
    doNowPlaying();
    // stagger recent slightly to avoid same-moment fetches on constrained radios
    setTimeout(doRecent, 500);
  }

  // Kick on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', kick, { once: true });
  } else {
    kick();
  }

  // Fire again on pageshow (iOS bfcache), on focus, and when back online
  window.addEventListener('pageshow', kick);
  window.addEventListener('focus', kick);
  window.addEventListener('online', kick);

  // Expose minimal API
  window.erRefreshNow = kick;

})();
