
/*! Essential Radio: iOS-safe Artwork Patch v1.4
   - Keeps artwork during the same track.
   - Clears only after (startTime + duration + grace) when feed is blank/indeterminate.
   - No blobs, handlers first, eager load, cache-busted fetches.
*/
(function () {
  try {
    var ua = navigator.userAgent || '';
    var isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (!isIOS) { return; }
    window.__IOS_ARTWORK_PATCH_ACTIVE = true;
  } catch(e) { /* if anything fails, keep running but do not claim ownership */ }

  const IMG_SEL = '#artwork';
  const POLL_MS = 12000;
  const QUIET_MS_AFTER_SUCCESS = 3000;
  const CLEAR_GRACE_MS = 5000;
  const CLEAR_PIXEL = 'Essential Radio Logo.png';

  let lastMeta = null;   // {artist,title,startTime,duration,source}
  let lastURL  = null;
  let lastSwapAt = 0;
  let lastEndAt = 0;
  let busy = false;

  function getImg() {
    let el = document.querySelector(IMG_SEL);
    if (!el) return null;
    try { el.loading = 'eager'; } catch {}
    try { el.decoding = 'async'; } catch {}
    return el;
  }

  function bindOnce(img) {
    if (!img || img.__bound) return;
    img.addEventListener('load', () => img.classList.add('loaded'));
    img.addEventListener('error', () => { if (!lastURL) { img.src = CLEAR_PIXEL; img.classList.add('loaded'); } });
    img.__bound = true;
  }

  function applyStylesOnce() {
    if (document.getElementById('artwork-ios-style')) return;
    const css = `
      ${IMG_SEL}{
        aspect-ratio:1/1;
        min-width:150px;min-height:150px;
        display:block;max-width:300px;width:100%;
        border-radius:12px;object-fit:cover;background:#111;
        opacity:0;filter:blur(10px) brightness(.9);
        transition:opacity .3s ease, filter .3s ease;
      }
      ${IMG_SEL}.loaded{opacity:1;filter:blur(0) brightness(1);}
      @supports not (aspect-ratio:1/1){ ${IMG_SEL}{ width:150px;height:150px; } }
    `;
    const s = document.createElement('style');
    s.id = 'artwork-ios-style';
    s.textContent = css;
    document.head.appendChild(s);
  }

  function parseEnd(startISO, durSec) {
    try {
      const t = Date.parse(startISO);
      if (isFinite(t) && isFinite(durSec) && durSec > 0) return t + Math.floor(Number(durSec) * 1000);
    } catch {}
    return 0;
  }

  async function j(url) {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }

  function isValid(meta) {
    const a = String(meta.artist || '').trim();
    const t = String(meta.title  || '').trim();
    if (!a || !t) return false;
    if (meta.indeterminate === true) return false;
    return true;
  }

  function same(a, b) {
    if (!a || !b) return false;
    return a.artist === b.artist && a.title === b.title;
  }

  async function resolveURL(meta) {
    // 1) own endpoint
    try {
      const u = `/api/artwork.js?artist=${encodeURIComponent(meta.artist)}&title=${encodeURIComponent(meta.title)}&_=${Date.now()}`;
      const d = await j(u);
      if (d && d.url) return d.url;
    } catch {}
    // 2) iTunes fallback
    try {
      const q = `${meta.title} ${meta.artist}`.trim();
      const u = `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&media=music&entity=musicTrack&country=GB&limit=5&_=${Date.now()}`;
      const d = await j(u);
      const hit = (d.results || []).find(h => (h.kind === 'song' || h.wrapperType === 'track') && h.artworkUrl100);
      if (hit) return hit.artworkUrl100.replace('100x100', '300x300');
    } catch {}
    return null;
  }

  function shouldClear(latestRaw) {
    if (!lastEndAt) return false;
    const now = Date.now();
    if (now < lastEndAt + CLEAR_GRACE_MS) return false;
    const artist = String(latestRaw.artist || '').trim();
    const title  = String(latestRaw.title  || '').trim();
    const inde   = !!latestRaw.indeterminate;
    return inde || !artist || !title;
  }

  async function tick() {
    if (busy) return;
    busy = true;
    try {
      applyStylesOnce();
      const img = getImg();
      if (!img) return;
      bindOnce(img);

      const now = Date.now();
      if (now - lastSwapAt < QUIET_MS_AFTER_SUCCESS) return;

      const latest = await j(`/api/latestTrack?_=${now}`);

      // Clear if last song finished and feed is blank/indeterminate
      if (shouldClear(latest)) {
        requestAnimationFrame(() => { img.classList.remove('loaded'); img.src = CLEAR_PIXEL; img.classList.add('loaded'); });
        lastURL = null;
        return;
      }

      // Build meta
      const meta = {
        artist: String(latest.artist || '').trim(),
        title:  String(latest.title  || '').trim(),
        source: latest.source || '',
        startTime: latest.startTime || latest.started || null,
        duration: latest.duration,
        indeterminate: !!latest.indeterminate
      };

      if (!isValid(meta)) return;

      // Refresh end time even if same song
      const end = parseEnd(meta.startTime, meta.duration);
      if (end) lastEndAt = end;

      if (same(meta, lastMeta)) return;

      // New track - resolve art
      const url = await resolveURL(meta);
      if (url) {
        requestAnimationFrame(() => { img.src = url; });
        lastURL = url;
        lastMeta = { artist: meta.artist, title: meta.title };
        lastSwapAt = Date.now();
      } else {
        // No URL yet - keep whatever is currently displayed
        if (!lastURL) {
          // show a neutral pixel rather than broken image
          requestAnimationFrame(() => { img.src = CLEAR_PIXEL; img.classList.add('loaded'); });
        }
      }
    } catch {
      // keep current on error
    } finally {
      busy = false;
    }
  }

  function start() {
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
