// Essential Radio — Now Playing (flashing dot LIVE + clean text + MMS)
// API: {"nowPlaying":"Artist - Title","duration":175}

const NOWPLAYING_URL = 'https://www.essential.radio/api/metadata';
const REFRESH_MS = 30000;          // poll every 30s
const END_CUSHION_MS = 3000;       // small buffer after duration
const LABEL_SELECTOR = '#nowPlaying';

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
  return document.querySelector(LABEL_SELECTOR);
}

// Ensure structure: [LIVE badge with dot] [space] [track span] [suffix]
function ensureStructure(label) {
  // Remove stray text nodes (keep spans only)
  Array.from(label.childNodes).forEach(node => {
    const isSpan = node.nodeType === 1 && node.tagName === 'SPAN';
    if (!isSpan) label.removeChild(node);
  });

  // LIVE badge with flashing dot
  let live = label.querySelector('.live-indicator');
  if (!live) {
    live = document.createElement('span');
    live.className = 'live-indicator';
    const dot = document.createElement('span');
    dot.className = 'dot';
    live.appendChild(dot);
    live.appendChild(document.createTextNode(' LIVE'));
    label.appendChild(live);
  } else {
    // Make sure it contains a dot + " LIVE"
    if (!live.querySelector('.dot')) {
      const dot = document.createElement('span');
      dot.className = 'dot';
      live.insertBefore(dot, live.firstChild);
    }
    // Ensure text includes " LIVE"
    const hasLiveText = /LIVE/i.test(live.textContent || '');
    if (!hasLiveText) live.appendChild(document.createTextNode(' LIVE'));
  }

  // Spacer after badge
  let spacer = label.querySelector('.np-spacer');
  if (!spacer) {
    spacer = document.createElement('span');
    spacer.className = 'np-spacer';
    spacer.textContent = ' ';
    label.appendChild(spacer);
  } else {
    spacer.textContent = ' ';
  }

  // Track text span
  let trackSpan = label.querySelector('.np-track');
  if (!trackSpan) {
    trackSpan = document.createElement('span');
    trackSpan.className = 'np-track';
    label.appendChild(trackSpan);
  }

  // Optional suffix
  let suffix = label.querySelector('.np-suffix');
  if (!suffix) {
    suffix = document.createElement('span');
    suffix.className = 'np-suffix';
    suffix.textContent = ' on Essential Radio';
    label.appendChild(suffix);
  } else {
    suffix.textContent = ' on Essential Radio';
  }

  return { live, trackSpan, suffix };
}

function showMoreMusicSoon() {
  const label = getLabelEl();
  if (!label) return;
  const { trackSpan } = ensureStructure(label);
  trackSpan.textContent = 'More Music Soon';
}

function scheduleEndTimer(durationSec) {
  if (endTimer) clearTimeout(endTimer);
  const ms = (Number(durationSec) || 0) * 1000 + END_CUSHION_MS;
  if (ms > 0) {
    endTimer = setTimeout(() => {
      showMoreMusicSoon();
    }, ms);
  }
}

async function fetchNowPlaying() {
  try {
    const res = await fetch(`${NOWPLAYING_URL}?ts=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const { artist, title, raw } = parseNowPlaying(data.nowPlaying || '');
    const duration = data.duration; // seconds

    const label = getLabelEl();
    if (!label) return;
    const { trackSpan } = ensureStructure(label);

    const changed = raw && raw !== currentRaw;
    if (changed) {
      currentRaw = raw;
      if (artist && title) trackSpan.textContent = `${title} — ${artist}`;
      else if (title)      trackSpan.textContent = title;
      else                 trackSpan.textContent = 'Now Playing';

      updateMediaSessionFromNP({ artist, title });
      if (duration != null) scheduleEndTimer(duration);
    } else {
      if (duration != null && !endTimer) scheduleEndTimer(duration);
    }

    document.dispatchEvent(new CustomEvent('nowplaying:update', { detail: { artist, title, meta: data } }));
  } catch (err) {
    console.warn('[NowPlaying] fetch error:', err);
  }
}

// Lock-screen (text only)
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

// Manual trigger
if (typeof window !== 'undefined') {
  window.refreshNowPlaying = fetchNowPlaying;
}
