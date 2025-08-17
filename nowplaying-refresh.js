// nowplaying-refresh.js
const NP_IDS = {
  artist: 'np-artist',
  title:  'np-title'
};

const REFRESH_MS = 15000;   // 15s
const TIMEOUT_MS  = 8000;   // 8s per request

let lastArtist = '';
let lastTitle  = '';

async function fetchJSON(url, { timeoutMs = TIMEOUT_MS } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

function updateNowPlaying(artist, title) {
  // only touch DOM if changed
  if (artist !== lastArtist) {
    const el = document.getElementById(NP_IDS.artist);
    if (el) el.textContent = artist || '';
    lastArtist = artist;
  }
  if (title !== lastTitle) {
    const el = document.getElementById(NP_IDS.title);
    if (el) el.textContent = title || '';
    lastTitle = title;
  }
}

function normaliseFromPayload(data) {
  // Accepts shapes like:
  // { artist, title }, or { nowPlaying: "Artist - Title" }
  let artist = '';
  let title  = '';

  if (data && typeof data === 'object') {
    if (data.artist || data.title) {
      artist = String(data.artist || '').trim();
      title  = String(data.title  || '').trim();
    } else if (typeof data.nowPlaying === 'string') {
      const s = data.nowPlaying;
      const i = s.indexOf(' - ');
      if (i > 0) {
        artist = s.slice(0, i).trim();
        title  = s.slice(i + 3).trim();
      }
    }
  }
  return { artist, title };
}

async function refreshNowPlaying() {
  try {
    // 1) Primary: dynamic API
    let data = await fetchJSON('/api/latestTrack');
    let { artist, title } = normaliseFromPayload(data);

    // 2) Fallback: static JSON in /player
    if (!artist && !title) {
      try {
        data = await fetchJSON(`/player/latestTrack.json?ts=${Date.now()}`, { timeoutMs: 5000 });
        ({ artist, title } = normaliseFromPayload(data));
      } catch {
        // ignore, we’ll just keep previous values
      }
    }

    // 3) Update DOM (only if we have *something*; else keep last shown)
    if (artist || title) {
      updateNowPlaying(artist, title);
    }
  } catch (err) {
    // Network/API error — keep showing the last successfully set values
    // Optionally log for debugging:
    // console.debug('NowPlaying refresh failed:', err);
  }
}

// Kick off and poll
refreshNowPlaying();
setInterval(refreshNowPlaying, REFRESH_MS);
