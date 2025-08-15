
// nowplaying-refresh (comma-safe patched)
(function(){
  const NP_SEL = "now-playing"; // element id

  function $(id){ return document.getElementById(id); }

  function decodeHTML(s){
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

  function normalizeNowPlaying(raw){
    const srcArtist = clean(decodeHTML(raw?.Artist ?? raw?.artist ?? ""));
    const srcTitle  = clean(decodeHTML(raw?.Title  ?? raw?.title  ?? ""));
    const combined  = clean(decodeHTML(raw?.NowPlaying ?? raw?.nowPlaying ?? raw?.np ?? ""));

    // If separate fields are present, trust them.
    if (srcArtist && srcTitle){
      return { artist: srcArtist, title: srcTitle, source: "fields" };
    }

    const s = combined;
    if (!s) return { artist: "", title: "", source: "empty" };

    // Prefer "Artist – Title"
    let m = s.match(/^(.*?)\s+–\s+(.*)$/);
    if (m) return { artist: clean(m[1]), title: clean(m[2]), source: "dash" };

    // "Title by Artist"
    m = s.match(/^(.*?)\s+by\s+(.*)$/i);
    if (m) return { artist: clean(m[2]), title: clean(m[1]), source: "by" };

    // "Artist: Title"
    m = s.match(/^(.*?)\s*:\s*(.*)$/);
    if (m) return { artist: clean(m[1]), title: clean(m[2]), source: "colon" };

    // Conservative single-comma heuristic for "Artist, Title"
    const count = (s.match(/,/g) || []).length;
    if (count === 1){
      const i = s.indexOf(",");
      const left  = clean(s.slice(0, i));
      const right = clean(s.slice(i+1));
      const looksLikeArtist = left && left.split(/\s+/).length <= 6 && !/[!?]$/.test(left);
      if (looksLikeArtist && right){
        return { artist: left, title: right, source: "single-comma" };
      }
    }

    // Give up guessing: treat full string as title (preserves commas)
    return { artist: "", title: s, source: "literal" };
  }

  function render({artist, title}){
    const root = $(NP_SEL);
    if (!root) return;

    const safeArtist = artist || "";
    const safeTitle  = title  || "";

    // Keep markup simple and consistent. The share toolbar is a sibling, so we only change this div.
    root.innerHTML = `
      <div class="np-line">
        <span class="np-label" aria-hidden="true">Now Playing:</span>
        <span class="np-artist" aria-label="Artist">${safeArtist}</span>
        ${safeArtist && safeTitle ? " – " : ""}
        <span class="np-title" aria-label="Title">${safeTitle}</span>
      </div>
    `;
    root.removeAttribute("data-empty");
  }

  async function refresh(){
    try{
      const res = await fetch(`/api/metadata?ts=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const { artist, title } = normalizeNowPlaying(data);
      render({ artist, title });
    }catch(err){
      console.error("Error refreshing now playing:", err);
      const root = $(NP_SEL);
      if (root){
        root.setAttribute("data-empty","");
        root.textContent = "More music soon on Essential Radio";
      }
    }
  }

  // Initial load & polling
  refresh();
  setInterval(refresh, 30000);
  window.addEventListener("focus", refresh);
})();
