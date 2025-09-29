
/*! Essential Radio: iOS-safe Artwork Patch (end-of-song clear) v1.2
   - Keeps artwork stable during playback.
   - Hides artwork once the song ends (using startTime + duration), with a grace window.
   - Skips indeterminate/blank states without premature clears.
*/
(function () {
  const IMG_SEL = '#artwork';
  const POLL_MS = 12000;
  const QUIET_MS_AFTER_SUCCESS = 3000;   // debounce after swap
  const CLEAR_GRACE_MS = 5000;           // wait this long after expected end before hiding
  const TRANSPARENT_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=';

  let lastMeta = null;     // {artist,title,source,startTime,duration}
  let lastURL  = null;     // last applied art URL
  let busy = false;
  let lastSwapAt = 0;
  let lastEndAt = 0;       // ms epoch when the last track is expected to end

  function ensureStyleOnce() {
    if (document.getElementById('ios-artwork-style')) return;
    const css = `
      ${IMG_SEL} {
        aspect-ratio: 1 / 1;
        min-width: 150px;
        min-height: 150px;
        border-radius: 10px;
        object-fit: cover;
        background: #111;
        opacity: 0;
        filter: blur(10px) brightness(.9);
        transition: opacity .35s ease, filter .35s ease;
      }
      ${IMG_SEL}.loaded { opacity: 1; filter: blur(0) brightness(1); }
      ${IMG_SEL}.hidden-art { opacity: 0 !important; filter: blur(0) brightness(1) !important; }
      @supports not (aspect-ratio: 1 / 1) {
        ${IMG_SEL} { width: 150px; height: 150px; }
      }
    `;
    const style = document.createElement('style');
    style.id = 'ios-artwork-style';
    style.textContent = css;
    document.head.appendChild(style);
  }

  function getImg() {
    const el = document.querySelector(IMG_SEL);
    if (!el) return null;
    try { el.loading = 'eager'; } catch {}
    try { el.decoding = 'async'; } catch {}
    return el;
  }

  function showArt(img, url) {
    if (!img) return;
    // Unhide
    img.classList.remove('hidden-art');
    // iOS paint race guard
    requestAnimationFrame(() => { img.src = url; });
  }

  function hideArt(img) {
    if (!img) return;
    // Visually hide, and replace with a transparent pixel to release memory
    img.classList.remove('loaded');
    img.classList.add('hidden-art');
    // Don't set empty src (iOS quirk) — use 1x1 transparent PNG
    requestAnimationFrame(() => { img.src = TRANSPARENT_PNG; });
    lastURL = null;
  }

  function applyFallbackIfNeverHadArt(img) {
    if (!img) return;
    if (!lastURL) {
      img.removeAttribute('srcset');
      showArt(img, '/artwork-fallback-300.png');
    }
  }

  async function fetchJSON(url) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  function parseEndAtISO(iso, durSec) {
    try {
      const t = Date.parse(iso);
      if (isFinite(t) && isFinite(durSec) && durSec > 0) {
        return t + Math.floor(Number(durSec) * 1000);
      }
    } catch {}
    return 0;
  }

  function validMeta(latest) {
    const artist = String(latest.artist || '').trim();
    const title  = String(latest.title  || '').trim();
    const source = String(latest.source || '').trim();
    const indeterminate = Boolean(latest.indeterminate);
    const startTime = latest.startTime || latest.started || null;
    const duration  = latest.duration;

    // Ignore explicitly indeterminate/blank states (these often occur during segues)
    if (!artist || !title || indeterminate) return null;

    return { artist, title, source, startTime, duration };
  }

  function sameMeta(a, b) {
    if (!a || !b) return false;
    return a.artist === b.artist && a.title === b.title;
  }

  async function resolveArtworkURL(meta) {
    // Prefer your server endpoint
    try {
      const url = `/api/artwork.js?artist=${encodeURIComponent(meta.artist)}&title=${encodeURIComponent(meta.title)}&_=${Date.now()}`;
      const data = await fetchJSON(url);
      if (data && data.url) return data.url;
    } catch {}

    // Fallback: iTunes
    try {
      const q = `${meta.title} ${meta.artist}`.trim();
      const u = `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&media=music&entity=musicTrack&country=GB&limit=5&_=${Date.now()}`;
      const js = await fetchJSON(u);
      const hit = (js.results || []).find(h => (h.kind === 'song' || h.wrapperType === 'track') && h.artworkUrl100);
      if (hit) return hit.artworkUrl100.replace('100x100','300x300');
    } catch {}

    return null;
  }

  function maybeClearWhenEnded() {
    const img = getImg();
    if (!img) return;
    if (!lastURL) return; // nothing visible anyway
    if (!lastEndAt) return;

    const now = Date.now();
    if (now >= lastEndAt + CLEAR_GRACE_MS) {
      hideArt(img);
    }
  }

  async function tick() {
    if (busy) return;
    busy = true;
    try {
      const now = Date.now();
      if (now - lastSwapAt < QUIET_MS_AFTER_SUCCESS) return;

      const latest = await fetchJSON(`/api/latestTrack?_=${now}`);
      const meta = validMeta(latest);

      // If we don't have a valid meta (blank/indeterminate), decide whether to clear AFTER the last track ends
      if (!meta) {
        maybeClearWhenEnded();
        return;
      }

      // If meta unchanged, keep current artwork and refresh our end time
      if (sameMeta(meta, lastMeta)) {
        lastEndAt = parseEndAtISO(meta.startTime, meta.duration) || lastEndAt;
        // Also check whether we passed end
        maybeClearWhenEnded();
        return;
      }

      // New track: resolve URL
      const img = getImg();
      if (!img) return;

      if (!img.__iosHandlersBound) {
        img.addEventListener('load', () => img.classList.add('loaded'));
        img.addEventListener('error', () => applyFallbackIfNeverHadArt(img));
        img.__iosHandlersBound = true;
      }

      const artURL = await resolveArtworkURL(meta);

      // Update end-time for new track
      lastEndAt = parseEndAtISO(meta.startTime, meta.duration);

      if (artURL) {
        showArt(img, artURL);
        lastURL = artURL;
        lastMeta = meta;
        lastSwapAt = Date.now();
      } else {
        // Can't find art yet — don't clear current art during the track; only clear after end
        applyFallbackIfNeverHadArt(img);
        lastMeta = meta; // keep meta so we can compute end time on next ticks
      }
    } catch {
      // On error, keep current art and possibly clear after end
      maybeClearWhenEnded();
    } finally {
      busy = false;
    }
  }

  function start() {
    ensureStyleOnce();
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', tick, { once: true });
    } else {
      tick();
    }
    setInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
  }

  try { start(); } catch {}
})();
