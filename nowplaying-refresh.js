
// nowplaying-refresh.js — server-field-first (artist/title), robust fallback parsing, no timers
(function(){
  // Helper to find the Now Playing container (supports both ids)
  function $(id){ return document.getElementById(id); }
  function getRoot(){ return $('nowPlaying') || $('now-playing') || null; }

  // Clean + decode
  function decode(s){
    const t = document.createElement('textarea');
    t.innerHTML = String(s ?? '');
    return t.value;
  }
  function clean(s){
    return String(s ?? '')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/\s+/g, ' ')
      .replace(/\s*[–—-]\s*/g, ' – ')
      .trim();
  }

  // Fallback normaliser for combined strings
  function normalizeCombined(raw){
    const line = clean(decode(raw));
    if (!line) return { artist:'', title:'' };

    // 1) Artist – Title (any dash)
    let m = line.match(/^(.*?)\s+[–—-]\s+(.*)$/);
    if (m) return { artist: clean(m[1]), title: clean(m[2]) };

    // 2) Title by Artist
    m = line.match(/^(.*?)\s+by\s+(.*)$/i);
    if (m) return { artist: clean(m[2]), title: clean(m[1]) };

    // 3) Artist: Title
    m = line.match(/^(.*?)\s*:\s*(.*)$/);
    if (m) return { artist: clean(m[1]), title: clean(m[2]) };

    // 4) VERY conservative single-comma "Artist, Title"
    const count = (line.match(/,/g) || []).length;
    if (count === 1){
      const i = line.indexOf(',');
      const left  = clean(line.slice(0, i));
      const right = clean(line.slice(i + 1));
      const looksLikeArtist = left && left.split(/\s+/).length <= 6 && !/[!?]$/.test(left);
      if (looksLikeArtist && right) return { artist:left, title:right };
    }

    // 5) Give up: whole string is the title (preserves commas)
    return { artist:'', title: line };
  }

  function showIdle(){
    const root = getRoot();
    if (!root) return;
    root.innerHTML = '<span style="color:#fed351;">Now Playing:</span><br/>' +
                     '<span style="color:white;">More music soon on Essential Radio</span>';
    root.setAttribute('data-empty', '1');
    const ind = root.querySelector('.live-indicator');
    if (ind) ind.style.display = 'none';
  }

  function ensureLive(root){
    let ind = root.querySelector('.live-indicator');
    if (!ind){
      ind = document.createElement('span');
      ind.className = 'live-indicator';
      ind.innerHTML = '<span class="dot"></span>LIVE';
      root.appendChild(ind);
    }
    ind.style.display = 'inline-flex';
  }

  function paint(artist, title){
    const root = getRoot();
    if (!root) return;

    if (!artist || !title){
      showIdle();
      return;
    }

    ensureLive(root);

    const t = root.querySelector('.np-title');
    const a = root.querySelector('.np-artist');
    if (t || a){
      if (t) t.textContent = title;
      if (a) a.textContent = artist;
    } else {
      root.innerHTML = ''
        + '<span style="color:#fed351;">Now Playing:</span>'
        + '<span class="live-indicator"><span class="dot"></span>LIVE</span><br/>'
        + '<span class="np-title" style="color:white;font-weight:600;font-size:1.2em;">' + title + '</span><br/>'
        + '<span class="np-artist" style="color:white;">by ' + artist + '</span>';
    }
    root.removeAttribute('data-empty');

    try { document.title = 'Essential Radio: ' + artist + ' – ' + title; } catch {}
    try { if (typeof window.fetchArtwork === 'function') window.fetchArtwork(artist + ' - ' + title); } catch {}
    try { window.dispatchEvent(new CustomEvent('np:update', { detail: { artist, title } })); } catch {}
  }

  // Override the global function your page already calls (no timers here).
  window.fetchNowPlaying = async function(){
    try{
      const res = await fetch('/api/metadata?ts=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();

      // Prefer clean server fields
      let artist = clean(decode(data?.artist));
      let title  = clean(decode(data?.title));

      // Fallback to combined normaliser
      if (!artist || !title){
        const combined = data?.nowPlaying ?? data?.NowPlaying ?? '';
        const fallback = normalizeCombined(combined);
        if (!artist) artist = fallback.artist;
        if (!title)  title  = fallback.title;
      }

      // If we still can't split confidently, go idle immediately
      if (!artist || !title) { showIdle(); return; }

      // Optional: cross-check latestTrack.json to avoid showing stale/partial credits
      try{
        const lres = await fetch('https://essentialradio.github.io/player/latestTrack.json?_=' + Date.now());
        if (lres.ok){
          const latest = await lres.json();
          const la = clean(latest?.artist);
          const lt = clean(latest?.title);
          if (lt && la){
            // If title matches, and latest artist looks richer, prefer it
            if (lt.toLowerCase() === title.toLowerCase()){
              const richer = !artist || la.toLowerCase().includes(artist.toLowerCase()) || la.length > artist.length + 2;
              if (richer) artist = la;
            } else {
              // If titles don't match, assume we're idle/transition
              showIdle();
              return;
            }
          }
        }
      } catch(_) { /* ignore enrichment failure */ }

      paint(artist, title);
    } catch(e){
      console.error('fetchNowPlaying error:', e);
      showIdle();
    }
  };
})();
