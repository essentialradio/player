/* Recently Played – Combined (UltraSafe) v4 (fix timestamps)
   - One-shot after window 'load'
   - Uses BOTH playout_log_rolling.json + /api/recent
   - Renders via your existing prependRecentFromTrack (no overrides)
   - Does NOT clear; only tops up to 5 if needed
   - Correctly sets endedAt/endMs so times are accurate
*/
(function(){
  const MAX = 5;
  const LOG_URL   = 'https://essentialradio.github.io/player/playout_log_rolling.json';
  const API_RECENT= '/api/recent';
  const SEED_ATTR = 'data-seeded-combined';

  const norm  = s => (s||'').toString().trim();
  const lower = s => norm(s).toLowerCase();

  function toStartMsFromLog(it){
    try {
      if (!it || !it['Hour'] || !it['Scheduled Time']) return 0;
      const base = new Date(it['Hour']);                       // date (YYYY-MM-DD) from Hour
      const [h, m] = String(it['Scheduled Time']).split(':').map(Number); // HH:MM
      const d = new Date(base.getFullYear(), base.getMonth(), base.getDate(), h||0, m||0, 0, 0);
      return d.getTime();
    } catch { return 0; }
  }

  async function fetchJSON(url, fallback=[]) {
    const ctrl = new AbortController();
    const id = setTimeout(()=>ctrl.abort(), 7000);
    try {
      const r = await fetch(url + (url.includes('?') ? '&' : '?') + '_=' + Date.now(), { cache:'no-store', signal: ctrl.signal });
      clearTimeout(id);
      if (!r.ok) return fallback;
      return await r.json();
    } catch { clearTimeout(id); return fallback; }
  }

  // Map rolling log → {artist, title, startMs, endedAt}
  async function getRolling(){
    const data = await fetchJSON(LOG_URL, []);
    if (!Array.isArray(data)) return [];
    return data.map(it => {
      const artist = norm(it.Artist);
      const title  = norm(it.Title);
      const startMs = toStartMsFromLog(it);
      const durS = Number(it['Duration (s)']) || 0;           // <-- use Duration (s) from the log
      const endedAt = startMs ? (startMs + durS * 1000) : 0;  // end time in ms
      return { artist, title, startMs, endedAt };
    }).filter(t => t.artist && t.title);
  }

  // Map /api/recent → {artist, title, startMs, endedAt}
  async function getApiRecent(){
    const data = await fetchJSON(API_RECENT, []);
    if (!Array.isArray(data)) return [];
    return data.map(x => {
      const artist = norm(x.artist);
      const title  = norm(x.title);
      const startMs = x.startMs || (x.startTime ? Date.parse(x.startTime) : 0);
      // Prefer server-provided end fields; else compute if duration present
      let endedAt = x.endedAt || x.endMs || 0;
      if (!endedAt && startMs && (x.duration || x.durationSec)) {
        const durS = Number(x.duration || x.durationSec) || 0;
        endedAt = startMs + durS * 1000;
      }
      return { artist, title, startMs, endedAt };
    }).filter(t => t.artist && t.title);
  }

  function mergeLatest5(a, b){
    const map = new Map();
    for (const src of [a,b]){
      for (const t of src){
        const bucket = Math.floor(((t.endedAt || t.startMs || 0))/60000); // minute bucket using end when possible
        const key = lower(t.artist) + '||' + lower(t.title) + '||' + bucket;
        const cur = map.get(key);
        if (!cur || (t.endedAt||t.startMs||0) > (cur.endedAt||cur.startMs||0)) {
          map.set(key, t);
        }
      }
    }
    return Array.from(map.values())
      .sort((x,y)=> (y.endedAt||y.startMs||0) - (x.endedAt||x.startMs||0))
      .slice(0, MAX);
  }

  function countExisting(){
    try {
      const list = document.getElementById('recent-list');
      if (!list) return 0;
      return list.querySelectorAll('.recent-item').length;
    } catch { return 0; }
  }

  async function seed(){
    try {
      await new Promise(res => window.addEventListener('load', res, {once:true}));

      const list = document.getElementById('recent-list');
      if (!list || list.getAttribute(SEED_ATTR) === '1') return;
      list.setAttribute(SEED_ATTR, '1');

      // Ensure renderer exists
      let tries = 0;
      while (typeof window.prependRecentFromTrack !== 'function' && tries < 100) {
        await new Promise(r => setTimeout(r, 50)); // up to ~5s
        tries++;
      }
      if (typeof window.prependRecentFromTrack !== 'function') return;

      // If already full (>=5), nothing to do
      if (countExisting() >= MAX) return;

      const [logList, apiList] = await Promise.all([getRolling(), getApiRecent()]);
      const merged = mergeLatest5(logList, apiList);

      if (merged.length){
        // Build a set of what's already in DOM (artist||title)
        const existingTexts = new Set(Array.from(document.querySelectorAll('#recent-list .recent-item')).map(r => {
          const a = r.querySelector('.artist')?.textContent || '';
          const t = r.querySelector('.title')?.textContent || '';
          return lower(a) + '||' + lower(t);
        }));

        // Insert oldest→newest so newest ends up on top with prepend
        const needed = merged.slice().reverse().filter(t => !existingTexts.has(lower(t.artist)+'||'+lower(t.title)));
        for (const t of needed){
          if (countExisting() >= MAX) break;
          try {
            window.prependRecentFromTrack({
              artist: t.artist,
              title:  t.title,
              startMs: t.startMs || 0,
              endedAt: t.endedAt || t.startMs || Date.now() // <-- supply endedAt so your HH:MM is correct
            });
          } catch {}
        }
      }
    } catch {}
  }

  try { seed(); } catch {}
})();
