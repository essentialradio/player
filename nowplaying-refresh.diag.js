// nowplaying-refresh.js — single source of truth: /api/metadata
(function () {
  const ROOT_ID = "nowPlaying";
  let currentId = null, timer = null;

  const $ = (id) => document.getElementById(id);
  const root = () => $(ROOT_ID) || document.getElementById("now-playing");
  const clean = (s) => String(s ?? "").replace(/[\u200B-\u200D\uFEFF]/g, "").replace(/\s+/g, " ").trim();
  const decode = (s) => { const t = document.createElement("textarea"); t.innerHTML = String(s ?? ""); return t.value; };

  function ensureLive() {
    const el = root(); if (!el) return;
    if (!el.querySelector(".live-indicator")) {
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
      const span = document.createElement("span");
      span.className = "live-indicator";
      span.innerHTML = '<span class="dot"></span>LIVE';
      el.appendChild(span);
    }
  }

  function showIdle() {
    const el = root(); if (!el) return;
    el.innerHTML = '<span style="color:#fed351;">Now Playing:</span><br/><span style="color:#fff;">More music soon on Essential Radio</span>';
    currentId = null;
  }

  function paint(artist, title) {
    const el = root(); if (!el) return;
    ensureLive();
    const t = el.querySelector(".np-title");
    const a = el.querySelector(".np-artist");
    if (t && a) {
      t.textContent = title; a.textContent = artist;
    } else {
      el.innerHTML =
        '<span style="color:#fed351;">Now Playing:</span>' +
        '<span class="live-indicator"><span class="dot"></span>LIVE</span><br/>' +
        '<span class="np-title" style="color:#fff;font-weight:600;font-size:1.2em;"></span><br/>' +
        '<span class="np-artist" style="color:#fff;"></span>';
      el.querySelector(".np-title").textContent = title;
      el.querySelector(".np-artist").textContent = "by " + artist;
    }
    try { document.title = `Essential Radio: ${artist} – ${title}`; } catch {}
  }

  function scheduleEnd(startTimeISO, durationSec) {
    if (timer) clearTimeout(timer);
    if (!startTimeISO || !durationSec) return;
    const end = new Date(new Date(startTimeISO).getTime() + durationSec * 1000);
    let ms = end - Date.now();
    if (ms <= 0) ms = 3000;
    ms = Math.max(1000, Math.min(ms, 15000));
    timer = setTimeout(showIdle, ms);
  }

  async function tick() {
    try {
      const res = await fetch('/api/metadata?ts=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();

      const artist = clean(decode(data.artist || ''));
      const title  = clean(decode(data.title  || ''));

      if (!artist || !title) return showIdle();

      const id = `${artist} – ${title}`;
      if (id !== currentId) { currentId = id; paint(artist, title); }
      scheduleEnd(data.startTime || null, typeof data.duration === 'number' ? data.duration : null);
    } catch (e) {
      console.error('nowplaying-refresh:', e);
      showIdle();
    }
  }

  tick();
  setInterval(tick, 10000);
  window.addEventListener('focus', tick);
})();
