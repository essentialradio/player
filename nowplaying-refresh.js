// Essential Radio — Now Playing refresh helper
// Fetches with no-store + cache-busting and refreshes on resume events.

const NOWPLAYING_URL = 'https://www.essential.radio/api/metadata';

async function fetchNowPlaying() {
  try {
    const url = `${NOWPLAYING_URL}?ts=${Date.now()}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    updateNowPlayingUI(data);
    updateMediaSessionFromNP(data);
  } catch (err) {
    console.warn('[NowPlaying] fetch error:', err);
  }
}

function updateNowPlayingUI(data) {
  // Customize selectors based on your HTML structure
  const label = document.querySelector('#now-playing-label, .now-playing, .np-text, .np-title');
  if (label) label.textContent = data.title && data.artist ? `${data.title} — ${data.artist}` : 'Now Playing';
  const art = document.querySelector('#now-playing-art, .np-artwork, .artwork');
  if (art && data.artworkUrl) art.src = `${data.artworkUrl}?v=${Date.now()}`;
}

function updateMediaSessionFromNP(data) {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: data.title || 'Essential Radio',
      artist: data.artist || '',
      album: 'Essential Radio',
      artwork: data.artworkUrl
        ? [{ src: `${data.artworkUrl}?v=${Date.now()}`, sizes: '512x512', type: 'image/png' }]
        : []
    });
  } catch (e) {
    console.warn('Media Session update failed:', e);
  }
}

function kickRefresh() {
  fetchNowPlaying();
}

// Refresh when the app is resumed or re-shown
document.addEventListener('visibilitychange', () => { if (!document.hidden) kickRefresh(); });
window.addEventListener('focus', kickRefresh);
window.addEventListener('pageshow', (e) => { if (e.persisted) kickRefresh(); });

// Refresh immediately on first load when installed
if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) {
  kickRefresh();
}

// Poll every 30 seconds (tweak if needed)
setInterval(kickRefresh, 30000);
