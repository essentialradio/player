/*!
 * Essential Radio: Artwork Unified Helper
 * Provides a universal getArtworkURL and applyArtwork method to use the
 * same artwork source across desktop and mobile.
 */
(function () {
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

    // Ensure any fallback blur is dropped immediately
    img.classList.remove('fallback');
    // Clear fallback immediately so blur doesn't persist into next track
    img.classList.remove('fallback');

    // Build URL
    const url = await getArtworkURL(meta.artist, meta.title);

    // If unified lookup failed, fall back to page helper if present
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

    // Bind handlers once
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

    // Trigger load with cache-bust
    const bust = url.includes('?') ? '&' : '?';
    img.classList.remove('loaded');
    img.src = `${url}${bust}ts=${Date.now()}`;

    
    // Safety: if the load event is missed (race/cached), force 'loaded' shortly after
    setTimeout(() => { if (img.complete && img.naturalWidth > 0) { img.classList.add('loaded'); img.classList.remove('fallback'); } }, 500);
// If image was instantly available from cache, 'load' may not fire
    if (img.complete && img.naturalWidth > 0) {
      img.classList.add('loaded');
      img.classList.remove('fallback');
    }
}

  // Expose helpers globally
  window.getArtworkURL = getArtworkURL;
  window.applyArtwork = applyArtwork;
})();

// NP Refresh top-right icon-only placer
(function() {
  function getBtn() {
    var btn = document.getElementById('np-refresh-btn');
    if (!btn) {
      btn = document.createElement('button');
      btn.id = 'np-refresh-btn';
      btn.type = 'button';
      btn.setAttribute('aria-label', 'Refresh now playing');
      btn.title = 'Refresh';
      // Base style – keep minimal for CSP
      btn.style.position = 'absolute';
      btn.style.top = '6px';
      btn.style.right = '6px';
      btn.style.width = '28px';
      btn.style.height = '28px';
      btn.style.padding = '0';
      btn.style.display = 'inline-flex';
      btn.style.alignItems = 'center';
      btn.style.justifyContent = 'center';
      btn.style.border = '0';
      btn.style.borderRadius = '9999px';
      btn.style.background = 'rgba(0,0,0,0.75)';
      btn.style.color = '#fff';
      btn.style.cursor = 'pointer';
    }
    // Make it icon-only
    if (!btn.__iconized) {
      btn.__iconized = true;
      btn.textContent = '';
      btn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M12 6V3L8 7l4 4V8a5 5 0 1 1-3.54 8.54l-1.42 1.42A7 7 0 1 0 12 6z"/></svg>';
    }
    if (!btn.__bound) {
      btn.__bound = true;
      btn.addEventListener('click', async function() {
        try {
          var img = document.getElementById('artwork');
          if (img) img.__unifiedKey = null;
          window.__UNIFIED_LAST_KEY = null;
          window._npLastTiming = null;
        } catch(e){}
        if (typeof window.fetchNowPlaying === 'function') {
          await window.fetchNowPlaying();
        }
        if (typeof window.fetchRecentlyPlayed === 'function') {
          try { await window.fetchRecentlyPlayed(); } catch(e){}
        }
      });
    }
    return btn;
  }

  function placeTopRight() {
    var host = document.getElementById('now-playing-card');
    if (!host) {
      // Try parent of now-playing as a fallback
      var np = document.getElementById('now-playing');
      if (np && np.parentElement) host = np.parentElement;
    }
    if (!host) return false;
    // Ensure host is positioning context
    var cs = window.getComputedStyle(host);
    if (!cs || (cs.position !== 'relative' && cs.position !== 'absolute' && cs.position !== 'fixed')) {
      try { host.style.position = 'relative'; } catch(e){}
    }
    var btn = getBtn();
    if (btn.parentElement !== host) host.appendChild(btn);
    return true;
  }

  function ensure() { placeTopRight(); }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensure);
  } else {
    ensure();
  }

  // Observe for changes and re-place
  try {
    var mo = new MutationObserver(function() { ensure(); });
    mo.observe(document.body, { childList: true, subtree: true });
  } catch(e){}
})();
