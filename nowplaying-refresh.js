// nowplaying-refresh.js — trust server, schedule by startTime+duration, 10s polling
(function(){
  const ROOT_ID = "nowPlaying";
  let currentTrackID = null;
  let trackEndTimeout = null;

  function $(id){ return document.getElementById(id); }
  function getRoot(){ return $(ROOT_ID) || document.getElementById('now-playing') || null; }

  const clean = (s) => String(s ?? '').replace(/[\u200B-\u200D\uFEFF]/g,'').replace(/\s+/g,' ').trim();
  const decode = (s) => { const t=document.createElement('textarea'); t.innerHTML=String(s??''); return t.value; };

  function showIdle(){
    const root = getRoot();
    if (!root) return;
    root.innerHTML = '<span style="color:#fed351;">Now Playing:</span><br/>' +
                     '<span style="color:white;">More music soon on Essential Radio</span>';
    root.setAttribute('data-empty','1');
    const ind = root.querySelector('.live-indicator');
    if (ind) ind.style.display = 'none';
    currentTrackID = null;
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

  function scheduleEnd(startTimeISO, durationSec){
    if (trackEndTimeout) { clearTimeout(trackEndTimeout); trackEndTimeout = null; }
    if (!startTimeISO || !durationSec) return; // no scheduling if missing

    const start = new Date(startTimeISO);
    const end = new Date(start.getTime() + durationSec * 1000);
    const now = new Date();
    let ms = end - now;

    // If already past, give a tiny grace to avoid flicker
    if (ms <= 0) ms = 3000;
    ms = Math.min(ms, 15000); // cap any wait to 15s

    trackEndTimeout = setTimeout(() => {
      showIdle();
    }, ms);
  }

  // Expose fetchNowPlaying; also call it on a 10s interval + focus
  window.fetchNowPlaying = async function(){
    try{
      const res = await fetch('/api/metadata?ts=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();

      const artist = clean(decode(data?.artist));
      const title  = clean(decode(data?.title));
      const startTime = data?.startTime || null;
      const duration  = (typeof data?.duration === 'number') ? data.duration : null;

      if (!artist || !title){
        showIdle();
        return;
      }

      const id = artist + ' – ' + title;
      if (id !== currentTrackID){
        currentTrackID = id;
        paint(artist, title);
        scheduleEnd(startTime, duration);
      } else {
        scheduleEnd(startTime, duration);
      }
    } catch (e){
      console.error('fetchNowPlaying failed:', e);
      showIdle();
    }
  };

  window.fetchNowPlaying();
  setInterval(window.fetchNowPlaying, 10000);
  window.addEventListener('focus', window.fetchNowPlaying);
})();
