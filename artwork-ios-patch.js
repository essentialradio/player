
/*! Essential Radio: iOS-safe Artwork Patch (hysteresis) v1.1
   - Prevents "flash away" by keeping last good artwork until a new VALID one is found.
   - Skips updates when latestTrack is empty/indeterminate.
   - Avoids resetting src to blank or fallback unless we've never had art.
*/
(function () {
  const IMG_SEL = '#artwork';
  const POLL_MS = 12000;
  const QUIET_MS_AFTER_SUCCESS = 3000; // extra debounce after a successful swap

  let lastMeta = null;
  let lastURL = null;     // last successfully applied artwork URL
  let busy = false;
  let lastSwapAt = 0;

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

  function applyFallbackIfNeverHadArt(img) {
    if (!img) return;
    // Only use fallback if we've NEVER had artwork yet
    if (!lastURL) {
      img.removeAttribute('srcset');
      img.src = '/artwork-fallback-300.png';
    }
  }

  async function fetchJSON(url) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  function validMeta(latest) {
    const artist = String(latest.artist || '').trim();
    const title  = String(latest.title  || '').trim();
    const indeterminate = Boolean(latest.indeterminate);
    // Ignore blank or explicitly indeterminate states (common during segues / top-of-hour)
    if (!artist || !title || indeterminate) return null;
    return { artist, title, source: latest.source || '' };
  }

  function sameMeta(a, b) {
    if (!a || !b) return false;
    return a.artist === b.artist && a.title === b.title;
  }

  async function resolveArtworkURL(meta) {
    // 1) Try your server endpoint first
    try {
      const url = `/api/artwork.js?artist=${encodeURIComponent(meta.artist)}&title=${encodeURIComponent(meta.title)}&_=${Date.now()}`;
      const data = await fetchJSON(url);
      if (data && data.url) return data.url;
    } catch {}

    // 2) iTunes fallback
    try {
      const q = `${meta.title} ${meta.artist}`.trim();
      const u = `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&media=music&entity=musicTrack&country=GB&limit=5&_=${Date.now()}`;
      const js = await fetchJSON(u);
      const hit = (js.results || []).find(h => (h.kind === 'song' || h.wrapperType === 'track') && h.artworkUrl100);
      if (hit) return hit.artworkUrl100.replace('100x100','300x300');
    } catch {}

    return null;
  }

  async function tick() {
    if (busy) return;
    busy = true;
    try {
      // Respect a short quiet period after we just swapped art
      const now = Date.now();
      if (now - lastSwapAt < QUIET_MS_AFTER_SUCCESS) return;

      // Get latest track (cache-busted)
      const latest = await fetchJSON(`/api/latestTrack?_=${now}`);
      const meta = validMeta(latest);

      // If meta is invalid or shows an "in between" state, don't blank the image; keep current art
      if (!meta) return;

      // If the meta hasn't changed, do nothing
      if (sameMeta(meta, lastMeta)) return;

      const img = getImg();
      if (!img) return;

      // Wire handlers once (idempotent)
      if (!img.__iosHandlersBound) {
        img.addEventListener('load', () => img.classList.add('loaded'));
        img.addEventListener('error', () => applyFallbackIfNeverHadArt(img));
        img.__iosHandlersBound = true;
      }

      // Resolve a concrete artwork URL
      const artURL = await resolveArtworkURL(meta);

      if (artURL && artURL !== lastURL) {
        // rAF avoids subtle paint races in iOS
        requestAnimationFrame(() => { img.src = artURL; });
        lastURL = artURL;
        lastMeta = meta;
        lastSwapAt = Date.now();
      } else if (!artURL) {
        // No new art found — keep whatever is showing
        // Only show fallback if we truly have nothing yet
        applyFallbackIfNeverHadArt(img);
        // Don't update lastMeta so we retry next tick
      }
    } catch {
      // network error — keep whatever artwork is currently displayed
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
