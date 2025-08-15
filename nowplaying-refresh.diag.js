// nowplaying-refresh.js — single source of truth: /api/metadata
(function () {
  const ROOT_ID = "nowPlaying";           // your existing container id
  let currentTrackID = null;
  let endTimer = null;

  // helpers
  const $ = (id) => document.getElementById(id);
  const getRoot = () => $(ROOT_ID) || document.getElementById("now-playing") || null;
  const clean = (s) => String(s ?? "").replace(/[\u200B-\u200D\uFEFF]/g, "").replace(/\s+/g, " ").trim();
  const decode = (s) => { const t = document.createElement("textarea"); t.innerHTML = String(s ?? ""); return t.value; };

  function showIdle() {
    const root = getRoot();
    if (!root) return;
    root.innerHTML =
      '<span style="color:#fed351;">Now Playing:</span><br/>' +
      '<span style="color:white;">More music soon on Essential Radio</span>';
    root.setAttribute("data-empty", "1");
    const ind = root.querySelector(".live-indicator");
    if (ind) ind.style.display = "none";
    currentTrackID = null;
  }

  function ensureLiveIndicator(root) {
    let ind = root.querySelector(".live-indicator");
    if (!ind) {
      const styleId = "np-live-style";
      if (!document.getElementById(styleId)) {
        const s = document.createElement("style");
        s.id = styleId;
        s.textContent = `
          .live-indicator{display:inline-flex;align-items:center;gap:.45rem;margin-left:.6rem;font-weight:700;color:#19ff9c;letter-spacing:.04em}
          .live-indicator .dot{width:.6rem;height:.6rem;border-radius:50%;background:#19ff9c;display:inline-block;box-shadow:0 0 0 .15rem rgba(25,255,156,.25);animation:np-pulse 1.2s infinite}
          @keyframes np-pulse{0%{transform:scale(1);opacity:1}70%{transform:scale(1.5);opacity:.3}100%{transform:scale(1);opacity:1}}
        `;
        document.head.appendChild(s);
      }
      ind = document.createElement("span");
      ind.className = "live-indicator";
      ind.innerHTML = '<span class="dot"></span>LIVE';
      root.appendChild(ind);
    }
    ind.style.display = "inline-flex";
  }

  function paint(artist, title) {
    const root = getRoot();
    if (!root) return;
    ensureLiveIndicator(root);
    const t = root.querySelector(".np-title");
    const a = root.querySelector(".np-artist");
    if (t || a) {
      if (t) t.textContent = title;
      if (a) a.textContent = artist;
    } else {
      root.innerHTML =
        '<span style="color:#fed351;">Now Playing:</span>' +
        '<span class="live-indicator"><span class="dot"></span>LIVE</span><br/>' +
        '<span class="np-title" style="color:white;font-weight:600;font-size:1.2em;"></span><br/>' +
        '<span class="np-artist" style="color:white;"></span>';
      root.querySelector(".np-title").textContent = title;
      root.querySelector(".np-artist").textContent = "by " + artist;
    }
    root.removeAttribute("data-empty");
    try { document.title = "Essential Radio: " + artist + " – " + title; } catch {}
    try { if (typeof window.fetchArtwork === "function") window.fetchArtwork(artist + " - " + title); } catch {}
    try { window.dispatchEvent(new CustomEvent("np:update", { detail: { artist, title } })); } catch {}
  }

  function scheduleEnd(startTimeISO, durationSec) {
    if (endTimer) { clearTimeout(endTimer); endTimer = null; }
    if (!startTimeISO || !durationSec) return; // no schedule if we don't know

    const start = new Date(startTimeISO);
    const end = new Date(start.getTime() + durationSec * 1000);
    let ms = end - new Date();

    // Grace: if end time has passed due to clock skew, give a short delay
    if (ms <= 0) ms = 3000;
    // Cap any long wait to avoid stale UI if timing is wrong
    ms = Math.max(1000, Math.min(ms, 15000));

    endTimer = setTimeout(() => {
      showIdle();
    }, ms);
  }

  async function updateNowPlaying() {
    try {
      const res = await fetch("/api/metadata?ts=" + Date.now(), { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();

      const artist = clean(decode(data?.artist));
      const title  = clean(decode(data?.title));
      const startTime = data?.startTime || null;
      const duration  = (typeof data?.duration === "number") ? data.duration : null;

      if (!artist || !title) {
        showIdle();
        return;
      }

      const id = artist + " – " + title;
      if (id !== currentTrackID) {
        currentTrackID = id;
        paint(artist, title);
      }
      scheduleEnd(startTime, duration);
    } catch (err) {
      console.error("nowplaying-refresh error:", err);
      showIdle();
    }
  }

  // Kickoff + polling + focus refresh
  updateNowPlaying();
  setInterval(updateNowPlaying, 10000);  // every 10s
  window.addEventListener("focus", updateNowPlaying);
})();
