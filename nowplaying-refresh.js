
// nowplaying-refresh.js — patched to preserve multi-artist names and titles with commas
// - Prefers structured fields: artist1..artist6, artists[], { artist, title }
// - Raw parsing only splits on a dash (– — -). Comma split is used *only* if there's NO dash.
// - Uses textContent (no HTML entity mangling).
// - Same behavior on load + 15s polling + refresh on focus.

async function refreshNowPlaying() {
  try {
    const res = await fetch(`/api/metadata?ts=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const root = document.getElementById("nowPlaying");
    if (!root) return;

    const decode = (s) => {
      const t = document.createElement("textarea");
      t.innerHTML = String(s || "");
      return t.value;
    };

    // --- 1) Structured extraction first ------------------------------------
    function extractStructured(d) {
      if (!d || typeof d !== "object") return { artist: "", title: "" };

      // Collect artist components
      const parts = [];
      for (let i = 1; i <= 6; i++) {
        const k1 = d[`artist${i}`], k2 = d[`Artist${i}`];
        if (k1) parts.push(String(k1).trim());
        if (k2) parts.push(String(k2).trim());
      }
      if (Array.isArray(d.artists)) parts.push(...d.artists.map(x => String(x || "").trim()));
      if (Array.isArray(d.Artists)) parts.push(...d.Artists.map(x => String(x || "").trim()));

      // If no multi-parts, check single artist fields
      let artist = "";
      if (!parts.length) {
        const singleArtistKeys = ["artist","Artist","artistName","artist_name","performer","Performer"];
        for (const k of singleArtistKeys) {
          if (d[k]) { artist = String(d[k]).trim(); break; }
        }
      } else {
        const seen = new Set();
        const dedup = [];
        for (const p of parts) {
          const key = p.toLowerCase();
          if (!p || seen.has(key)) continue;
          seen.add(key);
          dedup.push(p);
        }
        artist = dedup.join(", ");
      }

      // Title fields
      let title = "";
      const titleKeys = ["title","Title","track","Track","trackTitle","track_title","song","Song"];
      for (const k of titleKeys) {
        if (d[k]) { title = String(d[k]).trim(); break; }
      }
      return { artist, title };
    }

    // --- 2) Raw parsing (dash-first, comma fallback only if no dash) ---------
    function parseRaw(rawInput) {
      let artist = "", title = "";
      const raw = decode(rawInput).replace(/\s+/g, " ").trim();
      if (!raw) return { artist, title };

      // a) "Artist – Title" / "Artist — Title" / "Artist - Title"
      let m = raw.match(/^(.*?)\s+[–—-]\s+(.*)$/);
      if (m) return { artist: m[1].trim(), title: m[2].trim() };

      // b) "Title by Artist"
      m = raw.match(/^(.*?)\s+by\s+(.*)$/i);
      if (m) return { artist: m[2].trim(), title: m[1].trim() };

      // c) "Artist: Title"
      m = raw.match(/^(.*?)\s*:\s*(.*)$/);
      if (m) return { artist: m[1].trim(), title: m[2].trim() };

      // d) If *no dash pattern matched*, try ONE first-comma split (to support "Artist, Title" feeds)
      const commas = (raw.match(/,/g) || []).length;
      if (commas === 1) {
        const c = raw.indexOf(",");
        const a = raw.slice(0, c).trim();
        const t = raw.slice(c + 1).trim();
        if (a || t) return { artist: a, title: t };
      }

      // e) Otherwise, treat entire string as title
      return { artist: "", title: raw };
    }

    // Prefer structured; if empty, parse raw fields
    let { artist, title } = extractStructured(data);
    if (!artist && !title) {
      const rawCandidate = data.nowPlaying || data.track || data.title || data.raw || data;
      const rawString = typeof rawCandidate === "object"
        ? (rawCandidate.title || rawCandidate.nowPlaying || "")
        : String(rawCandidate || "");
      ({ artist, title } = parseRaw(rawString));
    }

    // --- 3) Update DOM (textContent preserves commas & ampersands) -----------
    const titleEl = root.querySelector(".np-title") || document.getElementById("np-title");
    const artistEl = root.querySelector(".np-artist") || document.getElementById("np-artist");

    if (titleEl) {
      titleEl.textContent = title || "More music soon";
      titleEl.dataset.titleRaw = title || "";
    }
    if (artistEl) {
      artistEl.textContent = artist || "";
      artistEl.dataset.artistRaw = artist || "";
    }

    // Optional: update tab title
    try {
      if (title) document.title = `${title} – ${artist || ""}`.trim();
    } catch (e) {}

    if (!artist && !title) {
      root.setAttribute("data-empty", "true");
    } else {
      root.removeAttribute("data-empty");
    }
  } catch (err) {
    console.error("Error refreshing now playing:", err);
  }
}

// Initial load
refreshNowPlaying();

// Poll every 15 seconds
setInterval(refreshNowPlaying, 15000);

// Refresh when window regains focus
window.addEventListener("focus", refreshNowPlaying);
