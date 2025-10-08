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

// NP Refresh beside LIVE placer
(function() {
  // Create (or reuse) the refresh button and attach handler
  function getOrMakeBtn() {
    var btn = document.getElementById('np-refresh-btn');
    if (!btn) {
      btn = document.createElement('button');
      btn.id = 'np-refresh-btn';
      btn.type = 'button';
      btn.textContent = 'Refresh';
      // Minimal inline style to ensure visibility even under strict CSP
      btn.style.padding = '0.35rem 0.6rem';
      btn.style.marginLeft = '0.4rem';
      btn.style.borderRadius = '9999px';
      btn.style.border = '0';
      btn.style.background = 'rgba(0,0,0,0.75)';
      btn.style.color = '#fff';
      btn.style.cursor = 'pointer';
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

  function placeBesideLive() {
    try {
      var host = document.getElementById('now-playing');
      if (!host) return false;
      var live = host.querySelector('.live-indicator');
      if (!live) return false;
      var btn = getOrMakeBtn();
      if (btn.previousSibling !== live && btn !== live.nextSibling) {
        // Insert right after the LIVE span
        if (live.parentNode) live.parentNode.insertBefore(btn, live.nextSibling);
      }
      return true;
    } catch(e) { return false; }
  }

  function fallbackPlace() {
    var art = document.getElementById('artwork');
    if (art && art.parentElement) {
      art.parentElement.appendChild(getOrMakeBtn());
      return true;
    }
    return false;
  }

  function ensurePlaced() {
    if (!placeBesideLive()) {
      fallbackPlace();
    }
  }

  // Run once on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensurePlaced);
  } else {
    ensurePlaced();
  }

  // Observe Now Playing box for changes and re-place button when it updates
  var obsTarget = document.getElementById('now-playing') || document.body;
  try {
    var pending = false;
    var mo = new MutationObserver(function() {
      if (pending) return;
      pending = true;
      requestAnimationFrame(function(){ pending = false; ensurePlaced(); });
    });
    mo.observe(obsTarget, { childList: true, subtree: true });
  } catch(e) {}
})();
