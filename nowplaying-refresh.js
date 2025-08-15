// nowplaying-refresh.js — with LIVE blinker + idle scheduling
(function () {
  const POLL_MS = 10000; // refresh every 10s
  const IDS = ["nowPlaying", "now-playing"]; // try either id
  let currentId = null;
  let endTimer = null;

  const root = () => IDS.map(id => document.getElementById(id)).find(Boolean) || null;
  const clean = (s) => String(s ?? "").replace(/[\u200B-\u200D\uFEFF]/g, "").replace(/\s+/g, " ").trim();
  const decode = (s) => { const t = document.createElement("textarea"); t.innerHTML = String(s ?? ""); return t.value; };

  // inject styles for blinker once
  (function ensureStyles(){
    if (document.getElementById("np-live-style")) return;
    const s = document.createElement("style");
    s.id = "np-live-style";
    s.textContent = `
      .live-indicator{display:inline-flex;align-items:center;gap:.45rem;margin-left:.6rem;font-weight:700;color:#19ff9c;letter-spacing:.04em}
      .live-indicator .dot{width:.6rem;height:.6rem;border-radius:50%;background:#19ff9c;display:inline-block;box-shadow:0 0 0 .15rem rgba(25,255,156,.25);animation:np-pulse 1.2s infinite}
      @keyframes np-pulse{0%{transform:scale(1);opacity:1}70%{transform:scale(1.5);opacity:.3}100%{transform:scale(1);opacity:1}}
    `;
    document.head.appendChild(s);
  })();

  function ensureLiveIndicator(el){
    let ind = el.querySelector(".live-indicator");
    if (!ind) {
      ind = document.createElement("span");
      ind.className = "live-indicator";
      ind.innerHTML = '<span class="dot"></span>LIVE';
      // place next to "Now Playing:"
      const firstLine = el.firstChild;
      if (firstLine && firstLine.nodeType === Node.TEXT_NODE && /Now Playing/i.test(firstLine.textContent || "")) {
        el.insertBefore(ind, firstLine.nextSibling);
      } else {
        el.appendChild(ind);
      }
    }
    ind.style.display = "inline-flex";
  }

  function hideLiveIndicator(el){
    const ind = el.querySelector(".live-indicator");
    if (ind) ind.style.display = "none";
  }

  function showIdle(){
    const el = root(); if (!el) return;
    el.innerHTML =
      '<span style="color:#fed351;">Now Playing:</span><br/>' +
      '<span style="color:#fff;">More music soon on Essential Radio</span>';
    hideLiveIndicator(el);
    currentId = null;
  }

  function paint(artist, title, combinedIfNeeded){
    const el = root(); if (!el) return;

    // Build markup (keep simple and robust)
    el.innerHTML =
      '<span style="color:#fed351;">Now Playing:</span>' +
      '<span class="live-indicator"><span class="dot"></span>LIVE</span><br/>' +
      '<span class="np-title" style="color:#fff;font-weight:600;font-size:1.1em;"></span>' +
      '<span class="np-by" style="color:#9aa3ad;margin:0 .35em;">' + (artist ? 'by' : '') + '</span>' +
      '<span class="np-artist" style="color:#fff;"></span>';

    const t = el.querySelector(".np-title");
    const a = el.querySelector(".np-artist");

    if (artist && title) {
      t.textContent = title;
      a.textContent = artist;
    } else {
      // fallback: show combined line in the title slot
      t.textContent = combinedIfNeeded || '';
      a.textContent = '';
      el.querySelector(".np-by").textContent = '';
    }

    ensureLiveIndicator(el);

    try {
      if (artist && title) document.title = `Essential Radio: ${artist} – ${title}`;
      else if (combinedIfNeeded) document.title = `Essential Radio: ${combinedIfNeeded}`;
    } catch {}
  }

  function scheduleEnd(startTimeISO, durationSec){
    if (endTimer) clearTimeout(endTimer);
    if (!startTimeISO || !durationSec) return; // keep LIVE if we don't know timing

    const end = new Date(new Date(startTimeISO).getTime() + durationSec * 1000);
    let ms = end - Date.now();
    if (ms <= 0) ms = 3000;                    // slight grace if clocks skew
    ms = Math.max(1000, Math.min(ms, 20000));  // 1–20s: don't wait forever if bad data

    endTimer = setTimeout(showIdle, ms);
  }

  async function tick(){
    try {
      const res = await fetch('/api/metadata?_=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const j = await res.json();

      const artist = clean(decode(j.artist || ''));
      const title  = clean(decode(j.title  || ''));
      const combined = clean(decode(j.nowPlaying || ''));
      const startTime = j.startTime || null;
      const duration  = (typeof j.duration === 'number') ? j.duration : null;

      if (artist || title || combined) {
        const id = artist && title ? `${artist} – ${title}` : combined;
        if (id !== currentId) {
          currentId = id;
          paint(artist, title, combined); // keeps LIVE visible
        }
        scheduleEnd(startTime, duration);
      } else {
        showIdle();
      }
    } catch (e) {
      console.error('nowplaying-refresh:', e);
      showIdle();
    }
  }

  tick();
  setInterval(tick, POLL_MS);
  window.addEventListener('focus', tick);
})();
