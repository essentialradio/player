// Essential Radio — Now Playing (LIVE badge + "More Music Soon")
// API: {"nowPlaying":"Artist - Title","duration":175}

const NOWPLAYING_URL = 'https://www.essential.radio/api/metadata';
const REFRESH_MS = 30000; // poll every 30s
const END_CUSHION_MS = 3000; // small buffer after duration

let currentRaw = '';
let endTimer = null;

function htmlDecode(input) {
  const t = document.createElement('textarea');
  t.innerHTML = input || '';
  return t.value;
}

function parseNowPlaying(rawStr) {
  const raw = htmlDecode((rawStr || '').trim());
  let artist = '', title = '';
  const idx = raw.indexOf(' - ');
  if (idx !== -1) {
    artist = raw.slice(0, idx).trim();
    title  = raw.slice(idx + 3).trim();
  } else {
    title = raw;
  }
  return { artist, title, raw };
}

function getLabelEl() {
  return document.querySelector('#nowPlaying, #now-playing-label, .now-playing, .np-text, .np-title, #now-playing');
}

function ensureLiveBadge(label) {
  let live = label.querySelector('.pulsing-label, .live-indicator, .live');
  if (!live) {
    live = document.createElement('span');
    live.className = 'pulsing-label';
    live.textContent = 'NOW PLAYING LIVE';
    label.appendChild(document.createTextNode(' '));
    label.appendChild(live);
    label.appendChild(document.createTextNode(' '));
  } else if (!/NOW PLAYING LIVE/i.test(live.textContent)) {
    live.textContent = 'NOW PLAYING LIVE';
  }
  return live;
}

function ensureTrackSpan(label) {
  let trackSpan = label.querySelector('.np-track');
  if (!trackSpan) {
    trackSpan = document.createElement('span');
    trackSpan.className = 'np-track';
    label.appendChild(trackSpan);
  }
  return trackSpan;
}

function showMoreMusicSoon() {
  const label = getLabelEl();
  if (!label) return;
  ensureLiveBadge(label);
  const trackSpan = ensureTrackSpan(label);
  trackSpan.textContent = 'More Music Soon';
}

function scheduleEndTimer(durationSec) {
  // Clear any previous timer
  if (endTimer) {
    clearTimeout(endTimer);
    endTimer = null;
  }
  const ms = (Number(durationSec) || 0) * 1000 + END_CUSHION_MS;
  if (ms > 0) {
    endTimer = setTimeout(() => {
      // Only show MMS if the track hasn't changed since we scheduled it
      showMoreMusicSoon();
    }, ms);
  }
}

async function fetchNowPlaying() {
  try {
    const res = await fetch(`${NOWPLAYING_URL}?ts=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const { artist, title, raw } = parseNowPlaying(data.nowPlaying);
    const duration = data.duration; // seconds (per your API)

    // If the track changed, update UI and re-schedule end timer
    if (raw !== currentRaw) {
      currentRaw = raw;
      updateNowPlayingUI({ artist, title });
      updateMediaSessionFromNP({ artist, title });
      if (duration != null) scheduleEndTimer(duration);
    } else {
      // Same track still playing — no UI change, but if we didn't have a timer, add one
      if (duration != null && !endTimer) scheduleEndTimer(duration);
    }

    // Let other code hook in if needed
    document.dispatchEvent(new CustomEvent('nowplaying:update', { detail: { artist, title, meta: data } }));
  } catch (err) {
    console.warn('[NowPlaying] fetch error:', err);
  }
}

function updateNowPlayingUI({ artist, title }) {
  const label = getLabelEl();
  if (!label) return;

  ensureLiveBadge(label);
  const trackSpan = ensureTrackSpan(label);

  if (artist && title) trackSpan.textContent = `${title} — ${artist}`;
  else if (title)      trackSpan.textContent = title;
  else                 trackSpan.textContent = 'Now Playing';
}

// Lock-screen text (no artwork from this API)
function updateMediaSessionFromNP({ artist, title }) {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: title || 'Essential Radio',
      artist: artist || '',
      album: 'Essential Radio',
      artwork: []
    });
  } catch {}
}

// Refresh on resume + poll
function kickRefresh() { fetchNowPlaying(); }
document.addEventListener('visibilitychange', () => { if (!document.hidden) kickRefresh(); });
window.addEventListener('focus', kickRefresh);
window.addEventListener('pageshow', (e) => { if (e.persisted) kickRefresh(); });

kickRefresh();
setInterval(kickRefresh, REFRESH_MS);

// Manual trigger if needed elsewhere
if (typeof window !== 'undefined') {
  window.refreshNowPlaying = fetchNowPlaying;
}
