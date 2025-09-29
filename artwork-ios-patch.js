
/*! Essential Radio: iOS-safe Artwork Patch (end-of-song clear) v1.3
   - Never clears during the same track.
   - Clears only after (startTime + duration + grace) AND feed is blank/indeterminate.
*/
(function () {
  const IMG_SEL = '#artwork';
  const POLL_MS = 12000;
  const QUIET_MS_AFTER_SUCCESS = 3000;   // debounce after swap
  const CLEAR_GRACE_MS = 5000;           // wait after expected end before hiding
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
    img.classList.remove('hidden-art');
    requestAnimationFrame(() => { img.src = url; });
  }

  function hideArt(img) {
    if (!img) return;
    img.classList.remove('loaded');
    img.classList.add('hidden-art');
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

  function getMetaOrNull(latest) {
    const artist = String(latest.artist || '').trim();
    const title  = String(latest.title  || '').trim();
    const source = String(latest.source || '').trim();
    const indeterminate = Boolean(latest.indeterminate);
    const startTime = latest.startTime || latest.started || null;
    const duration  = latest.duration;
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

  function shouldClear(latestRaw) {
    // Clear only if: we know the previous track end time is in the past + grace,
    // AND the feed is blank/indeterminate now (no new valid track yet).
    if (!lastEndAt) return false;
    const now = Date.now();
    if (now < lastEndAt + CLEAR_GRACE_MS) return false;

    const artist = String(latestRaw.artist || '').trim();
    const title  = String(latestRaw.title  || '').trim();
    const indeterminate = Boolean(latestRaw.indeterminate);
    if (indeterminate || !artist || !title) return true;
    return false;
  }

  async function tick() {
    if (busy) return;
    busy = true;
    try {
      const now = Date.now();
      if (now - lastSwapAt < QUIET_MS_AFTER_SUCCESS) return;

      const latest = await fetchJSON(`/api/latestTrack?_=${now}`);

      // Decide if we should clear because the previous track ended and nothing new is valid yet
      if (shouldClear(latest)) {
        const img = getImg();
        hideArt(img);
        // Do not reset lastMeta; we may still need it if the same song info reappears
        return;
      }

      const meta = getMetaOrNull(latest);

      // If still no valid meta, keep whatever is shown (don't clear prematurely)
      if (!meta) return;

      // If the meta hasn't changed, NEVER clear; just refresh the end time
      if (sameMeta(meta, lastMeta)) {
        lastEndAt = parseEndAtISO(meta.startTime, meta.duration) || lastEndAt;
        return;
      }

      // New track
      const img = getImg();
      if (!img) return;

      if (!img.__iosHandlersBound) {
        img.addEventListener('load', () => img.classList.add('loaded'));
        img.addEventListener('error', () => applyFallbackIfNeverHadArt(img));
        img.__iosHandlersBound = true;
      }

      const artURL = await resolveArtworkURL(meta);

      lastEndAt = parseEndAtISO(meta.startTime, meta.duration);

      if (artURL) {
        showArt(img, artURL);
        lastURL = artURL;
        lastMeta = meta;
        lastSwapAt = Date.now();
      } else {
        // No art found yet; leave the old art during the track if present; otherwise fallback once
        applyFallbackIfNeverHadArt(img);
        lastMeta = meta;
      }
    } catch {
      // keep current art on error
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
