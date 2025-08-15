
// nowplaying-refresh.js — clean-first, comma-safe, no timers, immediate idle on mismatch
(function(){
  // Helper to find the "Now Playing" container (supports both ids)
  function $(id){ return document.getElementById(id); }
  function getRoot(){ return $('nowPlaying') || $('now-playing') || null; }

  // HTML decode + cleaning
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

  // Normalise metadata to {artist, title} conservatively (preserve commas in titles)
  function normalize(data){
    // Prefer explicit fields if present
    let artist = clean(decode(data?.Artist ?? data?.artist ?? ''));
    let title  = clean(decode(data?.Title  ?? data?.title  ?? ''));
    if (artist && title) return { artist, title, source: 'fields' };

    // Combined string
    const raw = clean(decode(data?.nowPlaying ?? data?.NowPlaying ?? data?.np ?? ''));
    if (!raw) return { artist:'', title:'', source:'empty' };

    // a) Artist – Title (any dash)
    let m = raw.match(/^(.*?)\s+[–—-]\s+(.*)$/);
    if (m) return { artist: clean(m[1]), title: clean(m[2]), source:'dash' };

    // b) Title by Artist
    m = raw.match(/^(.*?)\s+by\s+(.*)$/i);
    if (m) return { artist: clean(m[2]), title: clean(m[1]), source:'by' };

    // c) Artist: Title
    m = raw.match(/^(.*?)\s*:\s*(.*)$/);
    if (m) return { artist: clean(m[1]), title: clean(m[2]), source:'colon' };

    // d) VERY conservative single-comma "Artist, Title"
    const count = (raw.match(/,/g) || []).length;
    if (count === 1){
      const i = raw.indexOf(',');
      const left  = clean(raw.slice(0, i));
      const right = clean(raw.slice(i + 1));
      const looksLikeArtist = left && left.split(/\s+/).length <= 6 && !/[!?]$/.test(left);
      if (looksLikeArtist && right) return { artist:left, title:right, source:'single-comma' };
    }

    // e) Give up guessing: keep full as title (preserves commas)
    return { artist:'', title: raw, source:'literal' };
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

    // Ensure LIVE indicator is visible
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

  // SAFELY override the global function your index already calls.
  window.fetchNowPlaying = async function(){
    try{
      // 1) Primary metadata
      const res = await fetch('/api/metadata?ts=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      const { artist, title } = normalize(data);

      // If we can't reliably split, go idle immediately
      if (!artist || !title){ showIdle(); return; }

      // 2) Cross-check latestTrack.json to decide live/idle state right now
      //    If it doesn't match, we show idle immediately (no 30s linger).
      try {
        const lres = await fetch('https://essentialradio.github.io/player/latestTrack.json?_=' + Date.now());
        if (lres.ok){
          const latest = await lres.json();
          if (latest && latest.artist && latest.title){
            const la = String(latest.artist || '').toLowerCase();
            const lt = String(latest.title  || '').toLowerCase();
            if (la !== artist.toLowerCase() || lt !== title.toLowerCase()){
              showIdle();
              return;
            }
          }
        }
      } catch(_) { /* ignore cross-check errors */ }

      // 3) Paint live track (with LIVE indicator)
      paint(artist, title);
    } catch (e){
      console.error('fetchNowPlaying failed:', e);
      showIdle();
    }
  };
})();
