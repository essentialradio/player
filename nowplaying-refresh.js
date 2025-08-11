// Essential Radio — Now Playing refresh helper (tailored to /api/metadata)
// API shape example: {"nowPlaying":"Artist - Title with HTML &apos;entities&apos;","duration":175}

const NOWPLAYING_URL = 'https://www.essential.radio/api/metadata';
const REFRESH_MS = 30000; // poll every 30s

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
    // Fallback if no separator found
    title = raw;
  }
  return { artist, title, raw };
}

async function fetchNowPlaying() {
  try {
    const res = await fetch(`${NOWPLAYING_URL}?ts=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    // Expect: data.nowPlaying and (optionally) data.duration
    const { artist, title } = parseNowPlaying(data.nowPlaying);

    updateNowPlayingUI({ artist, title });
    updateMediaSessionFromNP({ artist, title });

    // Fire a custom event so other scripts can react (e.g., recent list logic)
    document.dispatchEvent(new CustomEvent('nowplaying:update', { detail: { artist, title, meta: data } }));
  } catch (err) {
    console.warn('[NowPlaying] fetch error:', err);
  }
}

function updateNowPlayingUI({ artist, title }) {
  // Try a set of common selectors from your page. Adjust if needed.
  const label = document.querySelector('#nowPlaying, #now-playing-label, .now-playing, .np-text, .np-title, #now-playing');
  if (label) {
    if (artist && title) label.textContent = `${title} — ${artist}`;
    else if (title) label.textContent = title;
    else label.textContent = 'Now Playing';
  }
  // No artwork URL provided by the API; leave current image as-is.
}

// Optional: Media Session for lock-screen info (text only)
function updateMediaSessionFromNP({ artist, title }) {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: title || 'Essential Radio',
      artist: artist || '',
      album: 'Essential Radio',
      artwork: [] // No artwork in API
    });
  } catch {}
}

// Lifecycle hooks to refresh on resume
function kickRefresh() { fetchNowPlaying(); }

document.addEventListener('visibilitychange', () => { if (!document.hidden) kickRefresh(); });
window.addEventListener('focus', kickRefresh);
window.addEventListener('pageshow', (e) => { if (e.persisted) kickRefresh(); });

// First run + polling
kickRefresh();
setInterval(kickRefresh, REFRESH_MS);

// Expose manual trigger
if (typeof window !== 'undefined') {
  window.refreshNowPlaying = fetchNowPlaying;
}
