// Ensure Recently Played uses actual track start times and persists across refresh
(function(){
  const LIST_ID = 'recent-list';
  const SEED_ATTR = 'data-seeded-starttime';
  const API_RECENT = '/api/recent';

  async function ensureStartMs(item){
    let startMs = item.startMs
      || (item.startTime ? Date.parse(item.startTime) : 0)
      || (item.startedAt ? Date.parse(item.startedAt) : 0);

    if (!startMs && item.artist && item.title && typeof fetchDurationAndStartTime === 'function'){
      try {
        const info = await fetchDurationAndStartTime(item.artist, item.title);
        if (info && info.startTime) startMs = new Date(info.startTime).getTime();
      } catch {}
    }
    return startMs || 0;
  }

  async function seedRecentFromStartTime(){
    const list = document.getElementById(LIST_ID);
    if (!list || list.getAttribute(SEED_ATTR) === '1') return;
    list.setAttribute(SEED_ATTR, '1');

    let tries = 0;
    while (typeof window.prependRecentFromTrack !== 'function' && tries < 120){
      await new Promise(r => setTimeout(r, 50));
      tries++;
    }
    if (typeof window.prependRecentFromTrack !== 'function') return;

    try {
      const r = await fetch(API_RECENT + '?_=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) return;
      const items = await r.json();
      if (!Array.isArray(items) || items.length === 0) return;

      const enriched = await Promise.all(items.map(async it => {
        const startMs = await ensureStartMs(it);
        const startIso = startMs ? new Date(startMs).toISOString() : undefined;
        return Object.assign({}, it, {
          startMs,
          startedAt: startIso,
          startTime: startIso,
          endedAt:  startIso, // trick renderer to display start
          endMs:    startMs
        });
      }));

      list.innerHTML = '';
      enriched.forEach(window.prependRecentFromTrack);
    } catch {}
  }

  window.addEventListener('load', () => { seedRecentFromStartTime(); }, { once: true });
})();
