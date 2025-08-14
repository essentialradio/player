
async function refreshNowPlaying() {
  try {
    const res = await fetch(`/api/metadata?ts=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const root = document.getElementById("nowPlaying");
    if (!root) return;

    // Decode HTML entities safely
    const decode = (s) => {
      const t = document.createElement("textarea");
      t.innerHTML = String(s || "");
      return t.value;
    };

    const raw = decode(data.nowPlaying || "").trim();
    // Fallback if feed is empty
    if (!raw) {
      // Try to show a friendly placeholder
      const t = root.querySelector(".np-title");
      const a = root.querySelector(".np-artist");
      if (t) t.textContent = "";
      if (a) a.textContent = "";
      root.setAttribute("data-empty", "1");
      return;
    }

    // Robust parse that tolerates commas inside titles
    let artist = "", title = "";
    (function parseNowPlaying() {
      const s = raw.replace(/\s+/g, " ").trim();

      // 1) Artist – Title / Artist — Title / Artist - Title
      let m = s.match(/^(.*?)\s+[–—-]\s+(.*)$/);
      if (m) { artist = m[1].trim(); title = m[2].trim(); return; }

      // 2) Title by Artist
      m = s.match(/^(.*?)\s+by\s+(.*)$/i);
      if (m) { artist = m[2].trim(); title = m[1].trim(); return; }

      // 3) Artist: Title
      m = s.match(/^(.*?)\s*:\s*(.*)$/);
      if (m) { artist = m[1].trim(); title = m[2].trim(); return; }

      // 4) Artist, Title  (only split on the FIRST comma)
      const commas = (s.match(/,/g) || []).length;
      if (commas === 1) {
        const c = s.indexOf(",");
        artist = s.slice(0, c).trim();
        title = s.slice(c + 1).trim();
        return;
      }

      // 5) If nothing matches, leave raw as single string title
      title = s;
    })();

    // Update DOM — support both structured and simple containers
    const titleEl = root.querySelector(".np-title");
    const artistEl = root.querySelector(".np-artist");

    if (titleEl || artistEl) {
      if (titleEl) titleEl.textContent = title || "";
      if (artistEl) artistEl.textContent = artist || "";
    } else {
      // Simple fallback: inject as text
      root.textContent = artist && title ? `${artist} – ${title}` : title || raw;
    }

    root.removeAttribute("data-empty");
  } catch (err) {
    console.error("Error refreshing now playing:", err);
  }
}

// Initial load
refreshNowPlaying();

// Poll every 30 seconds
setInterval(refreshNowPlaying, 30000);

// Refresh when window regains focus
window.addEventListener("focus", refreshNowPlaying);
