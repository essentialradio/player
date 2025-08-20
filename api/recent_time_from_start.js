/* Recent Time Patcher (Start-time) — ultra-safe
   - After the page renders (and on any new recent rows),
     replace the timestamp with the track's START time.
   - Source of truth: playout_log_rolling.json + /api/recent
   - No overrides; only sets text on a time element if found.
*/
(function () {
  const LOG_URL    = 'https://essentialradio.github.io/player/playout_log_rolling.json';
  const API_RECENT = '/api/recent';
  const SELECTORS_TIME = ['.recent-time', '.time', '.timestamp', 'time']; // try in order
  const LIST_SEL = '#recent-list';
  const ROW_SEL  = '.recent-item';
  const MAX_LOOKUPS = 60; // how many items from sources to index
  const LOCALE = 'en-GB'; // 24h UK style

  const norm = s => (s || '').toString().trim();
  const key  = (a,t) => (norm(a).toLowerCase() + '||' + norm(t).toLowerCase());

  function toStartMsFromLog(it){
    try {
      if (!it || !it['Hour'] || !it['Scheduled Time']) return 0;
      const base = new Date(it['Hour']);
      const [h,m] = String(it['Scheduled Time']).split(':').map(Number);
      const d = new Date(base.getFullYear(), base.getMonth(), base.getDate(), h||0, m||0, 0, 0);
      return d.getTime();
    } catch { return 0; }
  }

  async function fetchJSON(url, fallback=[]) {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), 7000);
    try {
      const sep = url.includes('?') ? '&' : '?';
      const r = await fetch(url + sep + '_=' + Date.now(), { cache: 'no-store', signal: ctrl.signal });
      clearTimeout(id);
      if (!r.ok) return fallback;
      return await r.json();
    } catch {
      clearTimeout(id);
      return fallback;
    }
  }

  async function buildStartIndex(){
    // Get recent slices from both sources
    const [log, api] = await Promise.all([
      fetchJSON(LOG_URL, []),
      fetchJSON(API_RECENT, [])
    ]);

    const map = new Map();

    // From rolling log
    if (Array.isArray(log)) {
      for (const it of log.slice(-MAX_LOOKUPS)) {
        const artist  = norm(it?.Artist);
        const title   = norm(it?.Title);
        const startMs = toStartMsFromLog(it);
        if (artist && title && startMs) {
          const k = key(artist, title);
          // keep the most recent start
          if (!map.has(k) || startMs > map.get(k)) map.set(k, startMs);
        }
      }
    }

    // From /api/recent
    if (Array.isArray(api)) {
      for (const x of api.slice(-MAX_LOOKUPS)) {
        const artist  = norm(x?.artist);
        const title   = norm(x?.title);
        const startMs = x?.startMs
          || (x?.startTime ? Date.parse(x.startTime) : 0)
          || (x?.startedAt ? Date.parse(x.startedAt) : 0);
        if (artist && title && startMs) {
          const k = key(artist, title);
          if (!map.has(k) || startMs > map.get(k)) map.set(k, startMs);
        }
      }
    }

    return map; // key -> startMs
  }

  function formatHHMM(ms){
    try {
      return new Date(ms).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  }

  function findTimeEl(row){
    for (const sel of SELECTORS_TIME) {
      const el = row.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function patchRow(row, startMsIndex){
    const artist = row.querySelector('.artist')?.textContent || '';
    const title  = row.querySelector('.title')?.textContent || '';
    const tEl    = findTimeEl(row);
    if (!tEl) return;

    // Prefer a data attribute if your renderer set one
    const ds = row.getAttribute('data-startms');
    const startMsData = ds ? Number(ds) : 0;

    const k = key(artist, title);
    const startMs = startMsData || startMsIndex.get(k) || 0;
    if (!startMs) return;

    tEl.textContent = formatHHMM(startMs);
  }

  async function patchAllOnce(){
    try {
      // wait until the page has finished its own rendering
      await new Promise(res => {
        if (document.readyState === 'complete') return res();
        window.addEventListener('load', res, { once: true });
      });

      const list = document.querySelector(LIST_SEL);
      if (!list) return;

      // Build the lookup index (rolling log + api)
      const index = await buildStartIndex();

      // Patch current rows
      list.querySelectorAll(ROW_SEL).forEach(row => patchRow(row, index));

      // Also patch rows that appear shortly after (e.g., seeding finishes)
      // short, bounded retry: 3 passes over ~1s
      let passes = 0;
      const iv = setInterval(() => {
        passes += 1;
        list.querySelectorAll(ROW_SEL).forEach(row => patchRow(row, index));
        if (passes >= 3) clearInterval(iv);
      }, 350);
    } catch {}
  }

  try { patchAllOnce(); } catch {}
})();
