(() => {
  const API_URL = '/api/metadata?debug=1';
  const LATEST_URL = 'https://essentialradio.github.io/player/latestTrack.json?_=' + Date.now();

  const el = (id) => document.getElementById(id);

  function fmtLine(a, t){
    a = (a || '').trim();
    t = (t || '').trim();
    return (a && t) ? `${a} - ${t}` : (a || t || '—');
  }

  function setBox(boxId, lineId, metaId, artist, title, extra){
    const line = fmtLine(artist, title);
    el(lineId).textContent = line;
    el(metaId).textContent = extra || '';
    const box = el(boxId);
    box.classList.remove('diff-bad');
    if (!artist && !title) box.classList.add('diff-bad');
  }

  function compare(a, b){
    const n = (s)=> String(s||'').toLowerCase().replace(/[’'"]/g,'').replace(/\s+/g,' ').trim();
    const np = (s)=> n(s).replace(/\s*\([^)]*\)\s*/g,'');
    return n(a) === n(b) || np(a) === np(b);
  }

  async function refresh(){
    try{
      const [apiRes, ltRes] = await Promise.all([
        fetch(API_URL, { cache:'no-store' }),
        fetch(LATEST_URL, { cache:'no-store' }),
      ]);

      const api = await apiRes.json();
      const lt  = ltRes.ok ? await ltRes.json() : {};

      console.info('[diag] /api/metadata:', api);
      console.info('[diag] latestTrack.json:', lt);

      // Paint /api/metadata
      const apiArtist = api.artist || '';
      const apiTitle  = api.title  || '';
      const apiSource = api.source || (api._debug?.decision?.source) || 'unknown';
      const apiExtra  = `source=${apiSource} • duration=${api.duration ?? 'n/a'} • start=${api.startTime ?? 'n/a'}`;
      setBox('apiBox', 'apiNow', 'apiMeta', apiArtist, apiTitle, apiExtra);

      // Paint latestTrack.json
      const ltArtist = lt.artist || '';
      const ltTitle  = lt.title  || '';
      const ltExtra  = `duration=${lt.duration ?? 'n/a'} • start=${lt.startTime ?? 'n/a'}`;
      setBox('latestBox', 'ltNow', 'ltMeta', ltArtist, ltTitle, ltExtra);

      // Decision / diff
      const decisionEl = el('decision');
      const reasonEl   = el('reason');
      let decisionText = apiSource;
      let reasonText   = '';

      // Highlight disagreement
      const disagree = !(compare(apiTitle, ltTitle) && (apiArtist && ltArtist ? ltArtist.toLowerCase().includes(apiArtist.toLowerCase()) || apiArtist.toLowerCase().includes(ltArtist.toLowerCase()) : true));
      if (disagree){
        el('apiBox').classList.add('diff-bad');
        reasonText = 'API and latestTrack disagree on artist/title';
      } else {
        el('apiBox').classList.remove('diff-bad');
      }

      // Idle detection
      if (!apiArtist && !apiTitle){
        decisionText = 'idle (empty from API)';
        reasonText = 'Server returned empty artist/title';
      }

      decisionEl.textContent = decisionText;
      reasonEl.textContent = reasonText;

    } catch (e){
      console.error(e);
      el('decision').textContent = 'error';
      el('reason').textContent = String(e.message || e);
    }
  }

  el('refreshBtn').addEventListener('click', refresh);
  refresh();
  setInterval(refresh, 10000);
})();
