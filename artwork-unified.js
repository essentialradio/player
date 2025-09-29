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
    // Attempt to fetch the unified artwork URL
    const url = await getArtworkURL(meta.artist, meta.title);
    if (!url) return;
    // attach load/error handlers if not already present
    if (!img.__boundUnified) {
      img.addEventListener('load', () => img.classList.add('loaded'));
      img.addEventListener('error', () => {
        img.classList.remove('loaded');
        img.src = 'Essential Radio Logo.png';
      });
      img.__boundUnified = true;
    }
    // cache-bust the URL so Mobile Safari and other browsers repaint the image
    const bust = url.includes('?') ? '&' : '?';
    img.classList.remove('loaded');
    img.src = `${url}${bust}ts=${Date.now()}`;
  }

  // Expose helpers globally
  window.getArtworkURL = getArtworkURL;
  window.applyArtwork = applyArtwork;
})();