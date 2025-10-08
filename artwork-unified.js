/*!
 * Essential Radio: Artwork Unified Helper
 * Provides a universal getArtworkURL and applyArtwork method to use the
 * same artwork source across desktop and mobile.
 */
(function () {
  // Track the last artwork applied so we don't repeatedly reload the same image
  window.__UNIFIED_LAST_KEY = window.__UNIFIED_LAST_KEY || null;
  /**
   * Fetch the artwork URL for a given artist and title using the server-side proxy.
   * @param {string} artist
   * @param {string} title
   * @returns {Promise<string>} a URL or empty string if none found
   */
  async function getArtworkURL(artist, title) {
    // build a single query string from artist and title
    const query = [title, artist].filter(Boolean).join(' ').trim();
    if (!query) return '';
    try {
      const res = await fetch(`/api/artwork?q=${encodeURIComponent(query)}&_=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) return '';
      const data = await res.json();
      return data && data.url ? data.url : '';
    } catch {
      return '';
    }
  }

  /**
   * Apply artwork to the #artwork image using getArtworkURL. Accepts an object
   * with `artist` and `title` properties. If a URL is found it sets the image
   * src and ensures the 'loaded' class is added when it finishes loading.
   * @param {{artist: string, title: string}} meta
   */
  
async function applyArtwork(meta) {
    if (!meta || !meta.artist || !meta.title) return;
    const img = document.getElementById('artwork');
    if (!img) return;

    // Compute a stable key for this *exact* play of the track.
    // Prefer a provided startMs, then anything the page tracks, then artist+title.
    const startMs =
      (meta.startMs != null ? Number(meta.startMs) : NaN);
    const timingStart = (window._npLastTiming && Number(window._npLastTiming.startMs)) || NaN;
    const keyParts = [meta.artist, meta.title];
    if (!Number.isNaN(startMs)) keyParts.push(String(startMs));
    else if (!Number.isNaN(timingStart)) keyParts.push(String(timingStart));
    const key = keyParts.join("||").toLowerCase();

    // If we've already applied artwork for this key, do nothing (prevents blinking).
    if (img.__unifiedKey === key) return;

    // Get the artwork URL once
    const url = await getArtworkURL(meta.artist, meta.title);
    if (!url) {
      try {
        if (typeof fetchArtwork === 'function') {
          fetchArtwork(`${meta.artist} - ${meta.title}`);
          return;
        }
        if (typeof applyFallbackImmediate === 'function') {
          applyFallbackImmediate();
          return;
        }
      } catch(e){}
      return;
    }

    // Prepare stable cache-buster token so the URL stays constant for the duration of *this play*
    let token = !Number.isNaN(startMs) ? startMs : (!Number.isNaN(timingStart) ? timingStart : 0);
    if (!token) {
      // Fallback: deterministic hash from "artist||title" so it stays stable during a poll cycle
      const raw = (meta.artist + '||' + meta.title).toLowerCase();
      let h=0; for (let i=0;i<raw.length;i++){ h=((h<<5)-h) + raw.charCodeAt(i); h|=0; }
      token = Math.abs(h);
    }
    const bust = url.includes('?') ? '&' : '?';
    const finalURL = `${url}${bust}v=${encodeURIComponent(token)}`;

    // Lazily bind once
    if (!img.__boundUnified) {
      img.addEventListener('load', () => {
        img.classList.add('loaded');
        img.classList.remove('fallback');
      });
      img.addEventListener('error', () => {
        img.classList.remove('loaded');
        img.classList.add('fallback');
        img.src = 'Essential Radio Logo.png';
      });
      img.__boundUnified = true;
    }

    // Preload first to avoid a flash, then swap
    await new Promise((resolve) => {
      const pre = new Image();
      try { pre.decoding = 'async'; } catch {}
      pre.onload = () => resolve(true);
      pre.onerror = () => resolve(false);
      pre.src = finalURL;
      if (pre.complete && pre.naturalWidth > 0) resolve(true);
    });

    // Only swap if key changed during async
    if (img.__unifiedKey !== key) {
      img.classList.remove('fallback');
      // Keep 'loaded' until the swap so we don't blink
      const on = () => { img.classList.add('loaded'); img.removeEventListener('load', on); };
      img.addEventListener('load', on);
      img.src = finalURL;
      img.__unifiedKey = key;
      window.__UNIFIED_LAST_KEY = key;
    }
}

  // Expose helpers globally
  window.getArtworkURL = getArtworkURL;
  window.applyArtwork = applyArtwork;
})();