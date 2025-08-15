
// nowplaying-refresh.js — comma-safe & field-aware (updated)
(function(){
  const ROOT_ID = "now-playing";

  function $(id){ return document.getElementById(id); }

  function decode(s){
    const t = document.createElement("textarea");
    t.innerHTML = String(s ?? "");
    return t.value;
  }
  function clean(s){
    return String(s ?? "")
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .replace(/\s+/g, " ")
      .replace(/\s*[–—-]\s*/g, " – ")
      .trim();
  }

  function normalizeFromData(data){
    // Prefer explicit fields if the API ever provides them
    const fieldArtist = clean(decode(data?.Artist ?? data?.artist));
    const fieldTitle  = clean(decode(data?.Title  ?? data?.title));
    if (fieldArtist && fieldTitle){
      return { artist: fieldArtist, title: fieldTitle, source: "fields" };
    }

    // Fallback to combined line
    const raw = clean(decode(data?.nowPlaying || data?.NowPlaying || data?.np || ""));
    if (!raw) return { artist: "", title: "", source: "empty" };

    // 1) Artist – Title / Artist — Title / Artist - Title
    let m = raw.match(/^(.*?)\s+[–—-]\s+(.*)$/);
    if (m) return { artist: clean(m[1]), title: clean(m[2]), source: "dash" };

    // 2) Title by Artist
    m = raw.match(/^(.*?)\s+by\s+(.*)$/i);
    if (m) return { artist: clean(m[2]), title: clean(m[1]), source: "by" };

    // 3) Artist: Title
    m = raw.match(/^(.*?)\s*:\s*(.*)$/);
    if (m) return { artist: clean(m[1]), title: clean(m[2]), source: "colon" };

    // 4) VERY conservative single-comma "Artist, Title"
    const count = (raw.match(/,/g) || []).length;
    if (count === 1){
      const i = raw.indexOf(",");
      const left  = clean(raw.slice(0, i));
      const right = clean(raw.slice(i + 1));
      const looksLikeArtist = left && left.split(/\s+/).length <= 6 && !/[!?]$/.test(left);
      if (looksLikeArtist && right){
        return { artist: left, title: right, source: "single-comma" };
      }
    }

    // 5) Give up guessing: keep full as title (preserves commas)
    return { artist: "", title: raw, source: "literal" };
  }

  function paint({artist, title, rawForFallback}){
    const root = $(ROOT_ID);
    if (!root) return;

    if (!artist || !title){
      // Friendly placeholder (don’t crash / don’t re-parse)
      const t = root.querySelector(".np-title");
      const a = root.querySelector(".np-artist");
      if (t) t.textContent = "";
      if (a) a.textContent = "";
      root.setAttribute("data-empty", "1");
      root.innerHTML = '<span style="color:#fed351;">Now Playing:</span><br/>' +
                       '<span style="color:white;">More music soon on Essential Radio</span>';
      return;
    }

    // Structured if possible
    const titleEl = root.querySelector(".np-title");
    const artistEl = root.querySelector(".np-artist");
    if (titleEl || artistEl){
      if (titleEl)  titleEl.textContent  = title;
      if (artistEl) artistEl.textContent = artist;
    } else {
      root.innerHTML = ''
        + '<span style="color:#fed351;">Now Playing:</span>'
        + '<span class="live-indicator"><span class="dot"></span>LIVE</span><br/>'
        + '<span class="np-title" style="color:white;font-weight:600;font-size:1.2em;">' + title + '</span><br/>'
        + '<span class="np-artist" style="color:white;">by ' + artist + '</span>';
    }
    root.removeAttribute("data-empty");

    // Page title
    try { document.title = 'Essential Radio: ' + artist + ' – ' + title; } catch {}

    // Artwork if host provides helper
    try { if (typeof window.fetchArtwork === 'function') window.fetchArtwork(artist + ' - ' + title); } catch {}

    // Notify listeners (mobile mini bar, marquee, etc.)
    try { window.dispatchEvent(new CustomEvent('np:update', { detail: { artist, title } })); } catch {}
  }

  async function refreshNowPlaying(){
    try{
      const res = await fetch('/api/metadata?ts=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();

      const { artist, title } = normalizeFromData(data);

      // Avoid repaint if no change
      const id = artist && title ? (artist + ' – ' + title) : '';
      if (id && window._npCurrentTrackID === id) return;
      if (id) window._npCurrentTrackID = id;

      paint({ artist, title });
    } catch (err){
      console.error('Error refreshing now playing:', err);
      paint({ artist: "", title: "", rawForFallback: "" });
    }
  }

  // Initial load + polling + focus refresh (kept for backwards-compat)
  refreshNowPlaying();
  setInterval(refreshNowPlaying, 30000);
  window.addEventListener('focus', refreshNowPlaying);
})();
