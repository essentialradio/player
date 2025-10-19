
/*! nowplaying.js (unified: PLAYIT + ALT)
 * Exposes window.NowPlaying with:
 *  - updateFromPayload(payload)
 *  - filterRecentAgainstNowPlaying()
 *  - helpers to start/stop progress + countdown
 */
(function(){
  'use strict';

  var rafId = null;
  var tickTimer = null;
  var lastKey = null;

  function $(id){ return document.getElementById(id); }
  function norm(s){ return (s==null ? '' : String(s)).trim().replace(/\s+/g, ' '); }
  function upper(s){ return norm(s).toUpperCase(); }

  function detectALT(payload){
    try {
      var src = (payload && (payload.source ?? payload.Source ?? payload.mode ?? payload.Mode ?? payload.Src)) || '';
      var isAltSrc = String(src).toUpperCase() === 'ALT';
      var isInd = !!(payload && payload.indeterminate === true);
      return isAltSrc || isInd || !!(payload && payload.altMode === true);
    } catch(e){ return false; }
  }

  function hardHideProgressAndTime(){
    try {
      var prog = $('np-progress');
      if (prog){
        prog.style.display = 'none';
        var bar = prog.querySelector('.bar');
        if (bar) bar.style.width = '0%';
        prog.classList.remove('ending-soon');
      }
      var c = $('countdown');
      if (c){ c.textContent = ''; c.style.display = 'none'; }
    } catch(e){}
  }

  function stopTimers(){
    try { if (tickTimer){ clearInterval(tickTimer); tickTimer = null; } } catch(e){}
    try { if (rafId){ cancelAnimationFrame(rafId); rafId = null; } } catch(e){}
  }

  function startCountdown(endMs){
    var c = $('countdown');
    if (!c) return;
    function fmt(n){ return n < 10 ? '0'+n : ''+n; }
    function update(){
      var now = Date.now();
      var sec = Math.max(0, Math.floor((endMs - now)/1000));
      var m = Math.floor(sec/60);
      var s = sec % 60;
      c.textContent = m+':'+fmt(s);
      c.style.display = '';
    }
    update();
    tickTimer = setInterval(update, 1000);
  }

  function startBar(startMs, endMs){
    var prog = $('np-progress');
    if (!prog) return;
    var bar = prog.querySelector('.bar');
    if (!bar) return;
    prog.style.display = '';
    function step(){
      var now = Date.now();
      var pct = 0;
      if (endMs > startMs){
        pct = Math.min(100, Math.max(0, ((now - startMs) / (endMs - startMs))*100));
      }
      bar.style.width = pct.toFixed(3) + '%';
      if (pct >= 85) prog.classList.add('ending-soon'); else prog.classList.remove('ending-soon');
      if (pct < 100) { rafId = requestAnimationFrame(step); }
    }
    rafId = requestAnimationFrame(step);
  }

  function renderArtistTitle(payload){
    var a = $('np-artist') || $('mobileNpArtist');
    var t = $('np-title');
    var artist = norm(payload?.artist ?? payload?.Artist ?? '');
    var title  = norm(payload?.title ?? payload?.Title ?? '');
    if (a) a.textContent = artist;
    if (t) t.textContent = title;
    return { artist: artist, title: title };
  }

  function extractTimes(payload){
    // Accept ms or ISO; fall back gracefully
    var startMs = null, endMs = null;
    if (payload?.startMs || payload?.StartMs) startMs = Number(payload.startMs ?? payload.StartMs) || null;
    if (payload?.endMs || payload?.EndMs)     endMs   = Number(payload.endMs   ?? payload.EndMs)   || null;

    function isoToMs(iso){
      try { return Date.parse(iso); } catch(e){ return null; }
    }
    if (startMs == null && payload?.['Start ISO']) startMs = isoToMs(payload['Start ISO']);
    if (endMs   == null && payload?.['End ISO'])   endMs   = isoToMs(payload['End ISO']);

    // Some payloads only expose duration; compute end if start is present
    if (endMs == null && startMs != null){
      var dur = Number(payload?.durationMs ?? payload?.DurationMs ?? payload?.duration ?? 0);
      if (dur > 0) endMs = startMs + dur;
    }
    return { startMs: startMs, endMs: endMs };
  }

  function sameTrackKey(artist, title, startMs){
    return upper(artist) + '||' + upper(title) + '||' + (startMs || 0);
  }

  function filterRecentAgainstNowPlaying(){
    try{
      var aEl = $('np-artist') || $('mobileNpArtist');
      var tEl = $('np-title');
      var list = $('recent-list');
      if (!list) return;
      Array.from(list.children).forEach(function(el){ if (el && el.style) el.style.display = ''; });
      if (!aEl || !tEl) return;
      var a = upper(aEl.textContent);
      var t = upper(tEl.textContent);
      if (!a || !t) return;
      var kids = Array.from(list.children);
      for (var i=0;i<kids.length;i++){
        var row = kids[i];
        var txt = upper(row.textContent);
        if (txt.includes(a) && txt.includes(t)){
          row.style.display = 'none';
          break;
        }
      }
    }catch(e){}
  }

  function updateFromPayload(payload){
    var isALT = detectALT(payload);
    document.body.classList.toggle('alt-mode', isALT);

    // Basic text first so UI feels snappy
    var at = renderArtistTitle(payload);
    var times = extractTimes(payload);

    // If track changed, reset timers/progress
    var key = sameTrackKey(at.artist, at.title, times.startMs);
    if (key !== lastKey){
      stopTimers();
      lastKey = key;
    }

    if (isALT){
      // Same refresh loop as PLAYIT, but UI: hide progress + countdown
      stopTimers();
      hardHideProgressAndTime();
    } else {
      // PLAYIT: show progress + countdown if times are sensible
      var ok = (times.startMs != null && times.endMs != null && times.endMs > times.startMs && Date.now() <= (times.endMs + 6*60*1000));
      if (ok){
        startBar(times.startMs, times.endMs);
        startCountdown(times.endMs);
      } else {
        stopTimers();
        hardHideProgressAndTime();
      }
    }

    // Always run duplicate guard for Recently Played
    try { filterRecentAgainstNowPlaying(); } catch(e){}
  }

  // expose
  window.NowPlaying = {
    updateFromPayload: updateFromPayload,
    filterRecentAgainstNowPlaying: filterRecentAgainstNowPlaying
  };
})();
