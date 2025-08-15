
// nowplaying-refresh.js — clean-first, comma-safe, with fast-end behaviour
(function(){
  const ROOT_ID = "now-playing";
  let currentTrackID = null;
  let songHasEnded = false;
  let trackEndTime = null;
  let trackEndTimeout = null;

  function $(id){ return document.getElementById(id); }

  function decode(s){
    const t = document.createElement("textarea");
    t.innerHTML = String(s ?? "");
    return t.value;
  }
  function clean(s){
    return String(s ?? "")
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .replace(/\s+/g, " ")
      .replace(/\s*[–—-]\s*/g, " – ")
      .trim();
  }

  function normalizeFromData(data){
    // Prefer explicit fields if present
    const fieldArtist = clean(decode(data?.Artist ?? data?.artist ?? ""));
    const fieldTitle  = clean(decode(data?.Title  ?? data?.title  ?? ""));
    if (fieldArtist && fieldTitle){
      return { artist: fieldArtist, title: fieldTitle, source: "fields" };
    }

    // Fallback to combined line
    const raw = clean(decode(data?.nowPlaying ?? data?.NowPlaying ?? data?.np ?? ""));
    if (!raw) return { artist: "", title: "", source: "empty" };

    // 1) Artist – Title (any dash)
    let m = raw.match(/^(.*?)\s+[–—-]\s+(.*)$/);
    if (m) return { artist: clean(m[1]), title: clean(m[2]), source: "dash" };

    // 2) Title by Artist
    m = raw.match(/^(.*?)\s+by\s+(.*)$/i);
    if (m) return { artist: clean(m[2]), title: clean(m[1]), source: "by" };

    // 3) Artist: Title
    m = raw.match(/^(.*?)\s*:\s*(.*)$/);
    if (m) return { artist: clean(m[1]), title: clean(m[2]), source: "colon" };

    // 4) VERY conservative single-comma "Artist, Title"
    const count = (raw.match(/,/g) || []).length;
    if (count === 1){
      const i = raw.indexOf(",");
      const left  = clean(raw.slice(0, i));
      const right = clean(raw.slice(i + 1));
      const looksLikeArtist = left && left.split(/\s+/).length <= 6 && !/[!?]$/.test(left);
      if (looksLikeArtist && right){
        return { artist: left, title: right, source: "single-comma" };
      }
    }

    // 5) Give up guessing: keep full as title (preserves commas)
    return { artist: "", title: raw, source: "literal" };
  }

  function showMoreMusicSoon(){
    const root = $(ROOT_ID);
    if (!root) return;
    root.innerHTML = '<span style="color:#fed351;">Now Playing:</span><br/>' +
                     '<span style="color:white;">More music soon on Essential Radio</span>';
    root.setAttribute("data-empty", "1");
  }

  function paint({artist, title}){
    const root = $(ROOT_ID);
    if (!root) return;

    if (!artist || !title){
      showMoreMusicSoon();
      return;
    }

    const titleEl = root.querySelector(".np-title");
    const artistEl = root.querySelector(".np-artist");
    if (titleEl || artistEl){
      if (titleEl)  titleEl.textContent  = title;
      if (artistEl) artistEl.textContent = artist;
    } else {
      root.innerHTML = ''
        + '<span style="color:#fed351;">Now Playing:</span>'
        + '<span class="live-indicator"><span class="dot"></span>LIVE</span><br/>'
        + '<span class="np-title" style="color:white;font-weight:600;font-size:1.2em;">' + title + '</span><br/>'
        + '<span class="np-artist" style="color:white;">by ' + artist + '</span>';
    }
    root.removeAttribute("data-empty");

    try { document.title = 'Essential Radio: ' + artist + ' – ' + title; } catch {}

    // Artwork + notify
    try { if (typeof window.fetchArtwork === 'function') window.fetchArtwork(artist + ' - ' + title); } catch {}
    try { window.dispatchEvent(new CustomEvent('np:update', { detail: { artist, title } })); } catch {}
  }

  async function refreshNowPlaying(){
    try{
      // Primary metadata
      const res = await fetch('/api/metadata?ts=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      const { artist, title } = normalizeFromData(data);

      if (!artist || !title){
        // No usable split — end immediately
        if (trackEndTimeout) clearTimeout(trackEndTimeout);
        showMoreMusicSoon();
        songHasEnded = true;
        currentTrackID = null;
        trackEndTime = null;
        return;
      }

      const newID = artist + ' – ' + title;
      const changed = (currentTrackID !== newID);

      if (changed){
        songHasEnded = false;
        currentTrackID = newID;
        paint({ artist, title });
      }

      // Cross-check against latestTrack.json for reliable end-time and mismatch detection
      try {
        const latestRes = await fetch('https://essentialradio.github.io/player/latestTrack.json?_=' + Date.now());
        if (latestRes.ok){
          const latest = await latestRes.json();
          if (latest && latest.artist && latest.title && latest.duration && latest.startTime){
            const la = String(latest.artist || '').toLowerCase();
            const lt = String(latest.title  || '').toLowerCase();
            const ca = artist.toLowerCase();
            const ct = title.toLowerCase();

            if (la !== ca || lt !== ct){
              // Mismatch => end immediately
              if (trackEndTimeout) clearTimeout(trackEndTimeout);
              showMoreMusicSoon();
              songHasEnded = true;
              currentTrackID = null;
              trackEndTime = null;
              return;
            }

            // Compute end time and schedule a capped timeout
            const startTime = new Date(latest.startTime);
            const durationMs = latest.duration * 1000;
            const endTime = new Date(startTime.getTime() + durationMs);
            const now = new Date();
            const timeRemaining = endTime - now;

            // Prevent stale overlap re-trigger
            if (trackEndTime && now < trackEndTime && startTime < trackEndTime){
              // stale; ignore
              return;
            }

            trackEndTime = endTime;
            if (trackEndTimeout) clearTimeout(trackEndTimeout);

            if (timeRemaining <= 2000){
              // Finish right away if within 2s
              showMoreMusicSoon();
              songHasEnded = true;
              currentTrackID = null;
              trackEndTime = null;
            } else {
              trackEndTimeout = setTimeout(() => {
                showMoreMusicSoon();
                songHasEnded = true;
                currentTrackID = null;
                trackEndTime = null;
              }, Math.min(timeRemaining, 10000)); // cap to 10s
            }
          }
        }
      } catch(_) { /* ignore cross-check errors */ }
    } catch (err){
      console.error('Error refreshing now playing:', err);
      if (trackEndTimeout) clearTimeout(trackEndTimeout);
      showMoreMusicSoon();
      songHasEnded = true;
      currentTrackID = null;
      trackEndTime = null;
    }
  }

  // Initial load + polling + focus refresh
  refreshNowPlaying();
  setInterval(refreshNowPlaying, 30000);
  window.addEventListener('focus', refreshNowPlaying);
})();
