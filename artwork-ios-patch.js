
/*! Essential Radio: iOS-safe Artwork Patch (drop-in) v1.0
   - Fixes Mobile Safari issues (lazy loading, cache, race conditions).
   - Polls /api/latestTrack and /api/artwork.js with cache-busters.
   - Requires an <img id="artwork"> somewhere in your markup.
*/

(function () {
  const IMG_SEL = '#artwork';
  const POLL_MS = 12000; // poll every 12s (safe for iOS background timers)

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
    // Avoid lazy bugs on iOS
    try { el.loading = 'eager'; } catch {}
    try { el.decoding = 'async'; } catch {}
    // If you later draw the image to canvas, uncomment the next line:
    // el.crossOrigin = 'anonymous';
    return el;
  }

  function applyFallback(img) {
    if (!img) return;
    img.removeAttribute('srcset');
    img.src = '/artwork-fallback-300.png';
  }

  async function fetchJSON(url) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function resolveArtworkURL(meta) {
    // 1) Try your server endpoint first
    try {
      const url = `/api/artwork.js?artist=${encodeURIComponent(meta.artist||'')}&title=${encodeURIComponent(meta.title||'')}&_=${Date.now()}`;
      const data = await fetchJSON(url);
      if (data && data.url) return data.url;
    } catch (e) {
      // continue to fallback
    }
    // 2) iTunes fallback
    try {
      const q = [meta.title, meta.artist].filter(Boolean).join(' ').trim();
      if (!q) throw new Error('No query');
      const u = `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&media=music&entity=musicTrack&country=GB&limit=5&_=${Date.now()}`;
      const js = await fetchJSON(u);
      const hit = (js.results || []).find(h => (h.kind === 'song' || h.wrapperType === 'track') && h.artworkUrl100);
      if (hit) return hit.artworkUrl100.replace('100x100','300x300');
    } catch (e) {
      // ignore
    }
    return null;
  }

  function sameMeta(a, b) {
    if (!a || !b) return false;
    return String(a.artist||'').trim() === String(b.artist||'').trim()
        && String(a.title||'').trim()  === String(b.title||'').trim();
  }

  let lastMeta = null;
  let busy = false;

  async function tick() {
    if (busy) return;
    busy = true;
    try {
      // 1) Get latest track (cache-busted)
      const latest = await fetchJSON(`/api/latestTrack?_=${Date.now()}`);
      const meta = { artist: (latest.artist||'').trim(), title: (latest.title||'').trim() };

      // If nothing new, bail early
      if (sameMeta(meta, lastMeta)) return;

      const img = getImg();
      if (!img) return;

      // Wire handlers BEFORE setting src (race fix in Safari)
      let loaded = false;
      img.onload = () => { loaded = true; img.classList.add('loaded'); };
      img.onerror = () => applyFallback(img);

      // 2) Resolve artwork URL (server first, then iTunes)
      const artURL = await resolveArtworkURL(meta);

      if (artURL) {
        // rAF avoids subtle paint races in iOS
        requestAnimationFrame(() => { img.src = artURL; });
      } else {
        applyFallback(img);
      }
      lastMeta = meta;
    } catch (e) {
      // network issue — keep previous art
    } finally {
      busy = false;
    }
  }

  // Kick off
  function start() {
    ensureStyleOnce();
    // First tick asap once DOM is ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', tick, { once: true });
    } else {
      tick();
    }
    // Regular polling
    setInterval(tick, POLL_MS);
    // Also refresh on page visibility regain (iOS tab switching)
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) tick();
    });
  }

  try { start(); } catch (e) { /* swallow */ }
})();
