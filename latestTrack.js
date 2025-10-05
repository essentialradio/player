/* latestTrack.js — CLIENT-SIDE file (place in repo base)
   Purpose:
   - Hide timer + progress bar automatically in ALT mode (or when 'indeterminate' is true)
   - Run/stop progress bar + countdown in non-ALT modes
   - Fetch from './latestTrack.json' by default (works when you serve from base dir)
   - Compatible with both field styles:
       { Source, 'Start ISO', 'Duration (s)' }  OR  { source, startTime, duration }
   Usage:
     1) Put this file in your repo base (same place as latestTrack.json)
     2) Add to your HTML:  <script src="./latestTrack.js" defer></script>
     3) Ensure your markup has:
          <div id="nowplaying" data-np-src="./latestTrack.json">
            <div class="np-progress" id="progressBar"></div>
            <div class="np-timer" id="timeLeft"></div>
          </div>
*/

(function(){
  // Inject minimal CSS so ALT mode hides the timer + progress elements.
  if (!document.getElementById('np-alt-css')) {
    const style = document.createElement('style');
    style.id = 'np-alt-css';
    style.textContent = `[data-mode="alt"] .np-progress,
[data-mode="alt"] .np-timer { display: none !important; }`;
    document.head.appendChild(style);
  }

  // --- Utilities
  const toNum = (x) => {
    const n = Number(x);
    return Number.isFinite(n) ? n : null;
  };

  const isAltSource = (track) => {
    const src = (track.Source ?? track.source ?? '').toString().toUpperCase();
    const ind = track.indeterminate === true || track.undetermined === true;
    return src === 'ALT' || ind;
  };

  const getStartMs = (track) => {
    const cands = [track.startTime, track.start, track['Start ISO']];
    for (const s of cands) {
      const t = Date.parse(s);
      if (!Number.isNaN(t)) return t;
    }
    return null;
  };

  const effectiveDurationSeconds = (row) =>
    toNum(row['Actual Duration (s)']) ?? toNum(row.duration ?? row['Duration (s)']) ?? toNum(row['Full Duration (s)']) ?? 0;

  const fmtTimeLeft = (secs) => {
    const s = Math.max(0, Math.floor(secs));
    const m = Math.floor(s/60);
    const r = s % 60;
    return `${m}:${r.toString().padStart(2,'0')}`;
  };

  // --- DOM references
  const root = document.getElementById('nowplaying') || document.body;
  const elBar = document.getElementById('progressBar') || document.querySelector('.np-progress');
  const elTimer = document.getElementById('timeLeft') || document.querySelector('.np-timer');

  // --- Progress/timer tick
  let tickHandle = null;

  function stopTick(){
    if (tickHandle) { clearInterval(tickHandle); tickHandle = null; }
    if (elBar) elBar.style.width = '0%';
    if (elTimer) elTimer.textContent = '';
  }

  function startTick(track){
    stopTick();
    const startMs = getStartMs(track);
    const durMs = effectiveDurationSeconds(track) * 1000;
    if (!startMs || !durMs) return;
    tickHandle = setInterval(() => {
      const now = Date.now();
      const elapsed = now - startMs;
      const pct = Math.max(0, Math.min(100, (elapsed / durMs) * 100));
      if (elBar) elBar.style.width = pct + '%';
      if (elTimer) elTimer.textContent = fmtTimeLeft((durMs - elapsed)/1000);
      if (pct >= 100) stopTick();
    }, 250);
  }

  function renderLatest(track){
    const alt = isAltSource(track);
    root.dataset.mode = alt ? 'alt' : 'normal';
    if (alt) {
      stopTick();
    } else {
      startTick(track);
    }
    // Optional: if you have artist/title elements, update them here
    // document.getElementById('np-artist')?.textContent = track.artist ?? track.Artist ?? '';
    // document.getElementById('np-title')?.textContent  = track.title  ?? track.Title  ?? '';
  }

  // --- Fetch/poll
  async function fetchLatest(url){
    const u = url || './latestTrack.json';
    const res = await fetch(u + (u.includes('?') ? '&' : '?') + 'ts=' + Date.now(), { cache: 'no-store' });
    return res.json();
  }

  async function poll(){
    try {
      const url = root?.dataset?.npSrc || './latestTrack.json';
      const data = await fetchLatest(url);
      renderLatest(data);
    } catch(e){
      // swallow; try next time
    }
  }

  // Keep bars in sync when tab regains focus
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') poll();
  });

  // First run + interval
  poll();
  setInterval(poll, 5000);
})();