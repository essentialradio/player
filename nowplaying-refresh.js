// Essential Radio — Now Playing (with persistent LIVE badge)
// Tailored to: {"nowPlaying":"Artist - Title","duration":175}

const NOWPLAYING_URL = 'https://www.essential.radio/api/metadata';
const REFRESH_MS = 30000; // 30s

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

async function fetchNowPlaying() {
  try {
    const res = await fetch(`${NOWPLAYING_URL}?ts=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const { artist, title } = parseNowPlaying(data.nowPlaying);

    updateNowPlayingUI({ artist, title });
    updateMediaSessionFromNP({ artist, title });

    document.dispatchEvent(new CustomEvent('nowplaying:update', { detail: { artist, title, meta: data } }));
  } catch (err) {
    console.warn('[NowPlaying] fetch error:', err);
  }
}

function updateNowPlayingUI({ artist, title }) {
  // Container that currently shows the Now Playing text
  const label = document.querySelector('#nowPlaying, #now-playing-label, .now-playing, .np-text, .np-title, #now-playing');
  if (!label) return;

  // Ensure a LIVE badge exists and persists
  let live = label.querySelector('.pulsing-label, .live-indicator, .live');
  if (!live) {
    live = document.createElement('span');
    live.className = 'pulsing-label';            // matches your existing CSS pulse
    live.textContent = 'NOW PLAYING LIVE';
    // Space after the badge for readability
    label.appendChild(document.createTextNode(' '));
    label.appendChild(live);
    label.appendChild(document.createTextNode(' '));
  } else {
    // Make sure the text is exactly as desired
    if (!/NOW PLAYING LIVE/i.test(live.textContent)) live.textContent = 'NOW PLAYING LIVE';
  }

  // Track text lives in its own span so we don't overwrite the badge
  let trackSpan = label.querySelector('.np-track');
  if (!trackSpan) {
    trackSpan = document.createElement('span');
    trackSpan.className = 'np-track';
    // If label had plain text before, clear it (but keep the badge)
    // Move the badge to the front then append the track span at the end
    // (We already appended badge above if it didn’t exist)
    label.appendChild(trackSpan);
  }

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
