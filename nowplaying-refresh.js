// Essential Radio — Now Playing (LIVE + clean suffix + MMS)
// API: {"nowPlaying":"Artist - Title","duration":175}

const NOWPLAYING_URL = 'https://www.essential.radio/api/metadata';
const REFRESH_MS = 30000;
const END_CUSHION_MS = 3000;

// Tweak these to match your HTML
const LABEL_SELECTOR = '#nowPlaying, #now-playing-label, .now-playing, .np-text, .np-title, #now-playing';
const KEEP_SUFFIX = true;                 // set false if you don't want the " on Essential Radio" tail
const SUFFIX_TEXT = ' on Essential Radio';

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

// Normalize structure to: [LIVE span][space][track span][optional suffix span]
function normalizeLabel(label) {
  // Remove stray text nodes (keep spans)
  Array.from(label.childNodes).forEach(node => {
    const isSpan = node.nodeType === 1 && node.tagName === 'SPAN';
    if (!isSpan) label.removeChild(node);
  });

  // LIVE badge
  let live = label.querySelector('.pulsing-label, .live-indicator, .live');
  if (!live) {
    live = document.createElement('span');
    live.className = 'pulsing-label';
    live.textContent = 'NOW PLAYING LIVE';
    label.appendChild(live);
  } else if (!/NOW PLAYING LIVE/i.test(live.textContent)) {
    live.textContent = 'NOW PLAYING LIVE';
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

  // Track span
  let trackSpan = label.querySelector('.np-track');
  if (!trackSpan) {
    trackSpan = document.createElement('span');
    trackSpan.className = 'np-track';
    label.appendChild(trackSpan);
  }

  // Optional suffix
  let suffix = label.querySelector('.np-suffix');
  if (KEEP_SUFFIX) {
    if (!suffix) {
      suffix = document.createElement('span');
      suffix.className = 'np-suffix';
      suffix.textContent = SUFFIX_TEXT;
      label.appendChild(suffix);
    } else {
      suffix.textContent = SUFFIX_TEXT;
    }
  } else if (suffix) {
    suffix.remove();
  }

  return { live, trackSpan, suffix };
}

function showMoreMusicSoon() {
  const label = getLabelEl();
  if (!label) return;
  const { trackSpan } = normalizeLabel(label);
  trackSpan.textContent = 'More Music Soon';
}

function scheduleEndTimer(durationSec) {
  if (endTimer) clearTimeout(endTimer);
  const ms = (Number(durationSec) || 0) * 1000 + END_CUSHION_MS;
  if (ms > 0) {
    endTimer = setTimeout(() => {
      // Only show MMS if track hasn't changed
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
    const { trackSpan } = normalizeLabel(label);

    // New track?
    const changed = raw && raw !== currentRaw;
    if (changed) {
      currentRaw = raw;
      // Update track text cleanly
      if (artist && title) trackSpan.textContent = `${title} — ${artist}`;
      else if (title)      trackSpan.textContent = title;
      else                 trackSpan.textContent = 'Now Playing';

      updateMediaSessionFromNP({ artist, title });

      if (duration != null) scheduleEndTimer(duration);
    } else {
      // Same track: ensure there is a timer
      if (duration != null && !endTimer) scheduleEndTimer(duration);
    }

    document.dispatchEvent(new CustomEvent('nowplaying:update', { detail: { artist, title, meta: data } }));
  } catch (err) {
    console.warn('[NowPlaying] fetch error:', err);
  }
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

// Manual trigger
if (typeof window !== 'undefined') {
  window.refreshNowPlaying = fetchNowPlaying;
}
