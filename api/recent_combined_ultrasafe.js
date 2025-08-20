/* Recently Played – Combined (UltraSafe) v5 (timestamps = START time)
   - Uses BOTH playout_log_rolling.json + /api/recent
   - Renders via your existing prependRecentFromTrack
   - Does NOT clear; only tops up to 5 if needed
   - Sets endedAt = startMs so your renderer shows the START time
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
      const base = new Date(it['Hour']); // date from Hour
      const [h,m] = String(it['Scheduled Time']).split(':').map(Number); // HH:MM
      const d = new Date(base.getFullYear(), base.getMonth(), base.getDate(), h||0, m||0, 0, 0);
      return d.getTime();
    } catch { return 0; }
  }

  async function fetchJSON(url, fallback=[]){
    const ctrl = new AbortController();
    const id = setTimeout(()=>ctrl.abort(), 7000);
    try {
      const r = await fetch(url + (url.includes('?') ? '&' : '?') + '_=' + Date.now(), { cache:'no-store', signal: ctrl.signal });
      clearTimeout(id);
      if (!r.ok) return fallback;
      return await r.json();
    } catch { clearTimeout(id); return fallback; }
  }

  // Map rolling log → {artist, title, startMs}
  async function getRolling(){
    const data = await fetchJSON(LOG_URL, []);
    if (!Array.isArray(data)) return [];
    return data.map(it => ({
      artist: norm(it.Artist),
      title:  norm(it.Title),
      startMs: toStartMsFromLog(it)
    })).filter(t => t.artist && t.title && t.startMs);
  }

  // Map /api/recent → {artist, title, startMs}
  async function getApiRecent(){
    const data = await fetchJSON(API_RECENT, []);
    if (!Array.isArray(data)) return [];
    return data.map(x => ({
      artist: norm(x.artist),
      title:  norm(x.title),
      startMs: x.startMs || (x.startTime ? Date.parse(x.startTime) : 0)
    })).filter(t => t.artist && t.title && t.startMs);
  }

  function mergeLatest5(a, b){
    const map = new Map();
    for (const src of [a,b]){
      for (const t of src){
        const bucket = Math.floor((t.startMs||0)/60000); // minute bucket by START time
        const key = lower(t.artist) + '||' + lower(t.title) + '||' + bucket;
        if (!map.has(key) || (t.startMs||0) > (map.get(key).startMs||0)) map.set(key, t);
      }
    }
    return Array.from(map.values())
      .sort((x,y)=> (y.startMs||0) - (x.startMs||0))
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

      let tries = 0;
      while (typeof window.prependRecentFromTrack !== 'function' && tries < 100){
        await new Promise(r => setTimeout(r, 50)); // up to ~5s
        tries++;
      }
      if (typeof window.prependRecentFromTrack !== 'function') return;

      if (countExisting() >= MAX) return;

      const [logList, apiList] = await Promise.all([getRolling(), getApiRecent()]);
      const merged = mergeLatest5(logList, apiList);

      if (merged.length){
        // Build set of existing (artist||title) to avoid duplicates
        const existingTexts = new Set(Array.from(document.querySelectorAll('#recent-list .recent-item')).map(r => {
          const a = r.querySelector('.artist')?.textContent || '';
          const t = r.querySelector('.title')?.textContent || '';
          return lower(a) + '||' + lower(t);
        }));

        // Insert oldest→newest; set endedAt = startMs so your renderer shows start time
        const needed = merged.slice().reverse().filter(t => !existingTexts.has(lower(t.artist)+'||'+lower(t.title)));
        for (const t of needed){
          if (countExisting() >= MAX) break;
          try {
            window.prependRecentFromTrack({
              artist:  t.artist,
              title:   t.title,
              startMs: t.startMs,
              startedAt: new Date(t.startMs).toISOString(), // extra hint if your code uses it
              endedAt: t.startMs, // <—— force display to START time
              endMs:   t.startMs  // <—— (backup) in case your code uses endMs
            });
          } catch {}
        }
      }
    } catch {}
  }

  try { seed(); } catch {}
})();
