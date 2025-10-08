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

// 


// NP Refresh top-right icon + label placer (bold button)
(function() {
  function getWrap() {
    var wrap = document.getElementById('np-refresh-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'np-refresh-wrap';
      // absolute in top-right of the Now Playing card
      wrap.style.position = 'absolute';
      wrap.style.top = '6px';
      wrap.style.right = '6px';
      wrap.style.display = 'inline-flex';
      wrap.style.alignItems = 'center';
      wrap.style.gap = '6px';
      wrap.style.pointerEvents = 'auto';
      wrap.style.zIndex = '9999';
      // no background so it floats cleanly
    }
    return wrap;
  }

  function getBtn() {
    var btn = document.getElementById('np-refresh-btn');
    if (!btn) {
      btn = document.createElement('button');
      btn.id = 'np-refresh-btn';
      btn.type = 'button';
      btn.setAttribute('aria-label', 'Refresh now playing');
      btn.title = 'Refresh';
      // Bold visual
      btn.style.width = '32px';
      btn.style.height = '32px';
      btn.style.padding = '0';
      btn.style.display = 'inline-flex';
      btn.style.alignItems = 'center';
      btn.style.justifyContent = 'center';
      btn.style.border = '0';
      btn.style.borderRadius = '9999px';
      btn.style.background = 'var(--brand, #fed351)';
      btn.style.color = '#111';
      btn.style.cursor = 'pointer';
      btn.style.boxShadow = '0 1px 2px rgba(0,0,0,.45), 0 0 0 2px rgba(0,0,0,.55)';
      btn.style.touchAction = 'manipulation';
      btn.style.webkitTapHighlightColor = 'transparent';

      // Build SVG icon safely for iOS
      try {
        var svgNS = 'http://www.w3.org/2000/svg';
        var svg = document.createElementNS(svgNS, 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('width', '16');
        svg.setAttribute('height', '16');
        svg.setAttribute('aria-hidden', 'true');
        var path = document.createElementNS(svgNS, 'path');
        path.setAttribute('fill', 'currentColor');
        path.setAttribute('d', 'M12 6V3L8 7l4 4V8a5 5 0 1 1-3.54 8.54l-1.42 1.42A7 7 0 1 0 12 6z');
        svg.appendChild(path);
        btn.textContent = '';
        btn.appendChild(svg);
      } catch(e) {
        // Fallback emoji icon if SVG creation is blocked
        btn.textContent = '↻';
        btn.style.fontSize = '14px';
        btn.style.fontWeight = '700';
        btn.style.lineHeight = '1';
      }
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

  function getLabel() {
    var lab = document.getElementById('np-refresh-label');
    if (!lab) {
      lab = document.createElement('span');
      lab.id = 'np-refresh-label';
      lab.textContent = 'Refresh';
      lab.style.fontSize = '11px';
      lab.style.lineHeight = '1';
      lab.style.color = '#fff';
      lab.style.opacity = '0.95';
      lab.style.userSelect = 'none';
      // Slight text-shadow for legibility on light artwork headers
      lab.style.textShadow = '0 1px 2px rgba(0,0,0,.6)';
    }
    return lab;
  }

  function placeTopRight() {
    var host = document.getElementById('now-playing-card');
    if (!host) {
      // Try parent of 'now-playing' as a fallback
      var np = document.getElementById('now-playing');
      if (np && np.parentElement) host = np.parentElement;
    }
    if (!host) return false;

    // Ensure host is a positioning context
    var cs = window.getComputedStyle(host);
    if (!cs || (cs.position !== 'relative' && cs.position !== 'absolute' && cs.position !== 'fixed')) {
      try { host.style.position = 'relative'; } catch(e){}
    }

    var wrap = getWrap();
    var btn = getBtn();
    var lab = getLabel();

    // Compose wrap content
    if (wrap.firstChild !== btn) {
      wrap.innerHTML = '';
      wrap.appendChild(btn);
      wrap.appendChild(lab);
    }

    if (wrap.parentElement !== host) host.appendChild(wrap);
    return true;
  }


  // Variant control: mobile = text-only button ("Refresh"); desktop = icon + small label
  function isMobileish() {
    try {
      return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (window.innerWidth && window.innerWidth <= 640);
    } catch(e) { return true; }
  }

  function ensureSVGIcon(btn) {
    // Create SVG if missing
    if (!btn) return;
    if (btn.querySelector && btn.querySelector('svg')) return;
    try {
      var svgNS = 'http://www.w3.org/2000/svg';
      var svg = document.createElementNS(svgNS, 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('width', '16');
      svg.setAttribute('height', '16');
      svg.setAttribute('aria-hidden', 'true');
      var path = document.createElementNS(svgNS, 'path');
      path.setAttribute('fill', 'currentColor');
      path.setAttribute('d', 'M12 6V3L8 7l4 4V8a5 5 0 1 1-3.54 8.54l-1.42 1.42A7 7 0 1 0 12 6z');
      svg.appendChild(path);
      btn.textContent = '';
      btn.appendChild(svg);
    } catch(e) {
      btn.textContent = '↻';
      btn.style.fontSize = '14px';
      btn.style.fontWeight = '700';
    }
  }

  function applyVariant() {
    try {
      var wrap = document.getElementById('np-refresh-wrap');
      var btn = document.getElementById('np-refresh-btn');
      var lab = document.getElementById('np-refresh-label');

      if (!wrap || !btn) return;

      if (isMobileish()) {
        // Mobile: text-only button, hide the separate label
        if (lab) lab.style.display = 'none';
        btn.textContent = 'Refresh';
        // Remove any SVG children
        try {
          var svgs = btn.querySelectorAll ? btn.querySelectorAll('svg') : [];
          svgs.forEach(function(n){ n.remove(); });
        } catch(e) {}
        // Mobile sizing
        btn.style.width = 'auto';
        btn.style.height = '28px';
        btn.style.padding = '2px 8px';
        btn.style.fontSize = '12px';
        btn.style.fontWeight = '600';
        btn.style.background = 'var(--brand, #fed351)';
        btn.style.color = '#111';
      } else {
        // Desktop: icon + small label visible
        if (lab) lab.style.display = '';
        ensureSVGIcon(btn);
        btn.style.width = '32px';
        btn.style.height = '32px';
        btn.style.padding = '0';
        btn.style.fontSize = '';
        btn.style.fontWeight = '';
        btn.style.background = 'var(--brand, #fed351)';
        btn.style.color = '#111';
      }
    } catch(e) {}
  }
  function ensure() { placeTopRight(); applyVariant(); }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensure);
  } else {
    ensure();
  }

  try {
    var mo = new MutationObserver(function() { ensure(); });
    mo.observe(document.body, { childList: true, subtree: true });
  } catch(e){}

  // Update variant on viewport changes
  try {
    window.addEventListener('resize', applyVariant, { passive: true });
    window.addEventListener('orientationchange', applyVariant, { passive: true });
  } catch(e) {}
})();
