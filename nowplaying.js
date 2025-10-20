
/*! nowplaying.js (unified: PLAYIT + ALT) — 2025-10-20b */
(function(){
  'use strict';

  var rafId = null;
  var tickTimer = null;
  var lastKey = null;
  var moreSoonTimer = null;

  var RECENT_LIST_SELECTOR = (function(){
    try { if (window.NP_RECENT_SELECTOR) return String(window.NP_RECENT_SELECTOR); } catch(e){}
    return '#recent-list';
  })();
  var MORE_SOON_MS = (function(){
    try { if (window.NP_MORE_SOON_MS != null) return Number(window.NP_MORE_SOON_MS) || 30000; } catch(e){}
    return 30000;
  })();

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
    try { if (typeof window.__np_countdown_cleanup === 'function'){ window.__np_countdown_cleanup(); window.__np_countdown_cleanup = null; } } catch(e){}
  }

  function startCountdown(endMs){
    var c = $('countdown');
    if (!c) return;
    var lastTxt = '';
    var mo = null;
    function attachObserver(){
      if (!window.MutationObserver) return;
      if (mo) mo.disconnect();
      mo = new MutationObserver(function(){
        if (c.getAttribute('data-np-active') === '1' && c.textContent !== lastTxt) {
          c.textContent = lastTxt;
        }
      });
      mo.observe(c, {childList:true, characterData:true, subtree:true});
    }
    function detachObserver(){ try { if (mo) mo.disconnect(); } catch(e){} mo = null; }

    function fmt(n){ return n < 10 ? '0'+n : ''+n; }
    function update(){
      var now = Date.now();
      var sec = Math.max(0, Math.floor((endMs - now)/1000));
      var m = Math.floor(sec/60);
      var s = sec % 60;
      lastTxt = m+':'+fmt(s);
      c.textContent = lastTxt;
      c.style.display = '';
    }
    c.setAttribute('data-np-active','1');
    attachObserver();
    update();
    tickTimer = setInterval(update, 1000);
    window.__np_countdown_cleanup = function(){
      try { c.removeAttribute('data-np-active'); } catch(e){}
      detachObserver();
    };
  }

  function startBar(startMs, endMs){
    var prog = $('np-progress');
    if (!prog) return;
    var bar = prog.querySelector('.bar');
    if (!bar) return;
    prog.style.removeProperty('display');
    prog.hidden = false;
    try { prog.style.display = 'block'; } catch(e){}
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
    var artistId = (window.NP_ARTIST_ID || 'np-artist');
    var titleId  = (window.NP_TITLE_ID  || 'np-title');
    var a = $(artistId);
    var t = $(titleId);
    var artist = norm(payload?.artist ?? payload?.Artist ?? '');
    var title  = norm(payload?.title ?? payload?.Title ?? '');
    if (a) a.textContent = artist;
    if (t) t.textContent = title;
    return { artist: artist, title: title };
  }

  function toMs(x){
    if (x == null) return null;
    if (typeof x === 'number' && isFinite(x)) {
      if (x > 1e12) return Math.floor(x);
      if (x > 1e9)  return Math.floor(x);
      if (x > 1e6)  return Math.floor(x);
      return Math.floor(x * 1000);
    }
    var s = String(x).trim();
    if (/^\\d+$/.test(s)) {
      var n = Number(s);
      if (n > 1e12) return Math.floor(n);
      if (n > 1e9)  return Math.floor(n);
      if (n > 1e6)  return Math.floor(n);
      return Math.floor(n * 1000);
    }
    var t = Date.parse(s);
    return isFinite(t) ? t : null;
  }

  function extractTimes(payload){
    var startMs = null, endMs = null;

    if (payload?.startMs != null || payload?.StartMs != null)
      startMs = Number(payload.startMs ?? payload.StartMs);
    if (payload?.endMs != null || payload?.EndMs != null)
      endMs   = Number(payload.endMs   ?? payload.EndMs);

    if (startMs == null) {
      startMs = toMs(payload?.['Start ISO'] ?? payload?.startTime ?? payload?.StartTime ?? payload?.startedAt ?? payload?.['Start Time'] ?? payload?.Start);
    }
    if (endMs == null) {
      endMs = toMs(payload?.['End ISO'] ?? payload?.endTime ?? payload?.EndTime ?? payload?.['End Time'] ?? payload?.End);
    }

    var durationMs = null;
    if (payload?.durationMs != null || payload?.DurationMs != null) {
      durationMs = Number(payload.durationMs ?? payload.DurationMs);
    } else if (payload?.duration != null || payload?.Duration != null) {
      var d = payload.duration ?? payload.Duration;
      if (typeof d === 'string' && /^(\\d+):(\\d{2})(?::(\\d{2}))?$/.test(d)) {
        var parts = d.split(':');
        var sec = 0;
        if (parts.length === 2) { sec = Number(parts[0])*60 + Number(parts[1]); }
        else if (parts.length === 3) { sec = Number(parts[0])*3600 + Number(parts[1])*60 + Number(parts[2]); }
        durationMs = sec * 1000;
      } else {
        var sec = Number(d);
        if (isFinite(sec)) durationMs = sec * 1000;
      }
    }

    var positionMs = null;
    if (payload?.positionMs != null || payload?.elapsedMs != null || payload?.progressMs != null) {
      positionMs = Number(payload.positionMs ?? payload.elapsedMs ?? payload.progressMs);
    } else if (payload?.position != null || payload?.elapsed != null || payload?.progress != null) {
      var ps = Number(payload.position ?? payload.elapsed ?? payload.progress);
      if (isFinite(ps)) positionMs = ps * 1000;
    }

    var remainingMs = null;
    if (payload?.remainingMs != null) remainingMs = Number(payload.remainingMs);
    else if (payload?.remaining != null) {
      var r = Number(payload.remaining);
      if (isFinite(r)) remainingMs = r * 1000;
    }

    var now = Date.now();
    if (startMs == null && endMs != null && durationMs != null) {
      startMs = endMs - durationMs;
    }
    if (endMs == null && startMs != null && durationMs != null) {
      endMs = startMs + durationMs;
    }
    if (endMs == null && positionMs != null && durationMs != null) {
      endMs = now + Math.max(0, durationMs - positionMs);
      if (startMs == null) startMs = now - positionMs;
    }
    if (endMs == null && remainingMs != null) {
      endMs = now + Math.max(0, remainingMs);
      if (startMs == null && durationMs != null) startMs = endMs - durationMs;
    }

    if (endMs != null && startMs != null && startMs >= endMs) {
      startMs = endMs - (durationMs || 0);
      if (startMs <= 0) startMs = null;
    }

    return { startMs: (isFinite(startMs) ? startMs : null),
             endMs:   (isFinite(endMs)   ? endMs   : null) };
  }

  function sameTrackKey(artist, title, startMs){
    return upper(artist) + '||' + upper(title) + '||' + (startMs || 0);
  }

  function filterRecentAgainstNowPlaying(){
    try{
      var aId = (window.NP_ARTIST_ID || 'np-artist');
      var tId = (window.NP_TITLE_ID  || 'np-title');
      var aEl = $(aId);
      var tEl = $(tId);
      var list = document.querySelector(RECENT_LIST_SELECTOR);
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

  function setMoreSoonVisible(vis){
    try {
      var el = $('np-more-soon');
      if (!el) return;
      el.style.display = vis ? '' : 'none';
    } catch(e){}
  }

  function scheduleMoreSoon(show){
    try { if (moreSoonTimer){ clearTimeout(moreSoonTimer); moreSoonTimer = null; } } catch(e){}
    if (!show) { setMoreSoonVisible(false); return; }
    moreSoonTimer = setTimeout(function(){ setMoreSoonVisible(true); }, MORE_SOON_MS);
  }

  function updateFromPayload(payload){
    var isALT = detectALT(payload);
    document.body.classList.toggle('alt-mode', isALT);

    var at = renderArtistTitle(payload);
    var times = extractTimes(payload);

    var key = sameTrackKey(at.artist, at.title, times.startMs);
    if (key !== lastKey){
      stopTimers();
      lastKey = key;
      scheduleMoreSoon(false);
    }

    if (isALT){
      stopTimers();
      hardHideProgressAndTime();
      if (!at.artist && !at.title) { scheduleMoreSoon(true); } else { scheduleMoreSoon(false); }
    } else {
      var ok = (times.startMs != null && times.endMs != null && times.endMs > times.startMs && Date.now() >= (times.startMs - 15000) && Date.now() <= (times.endMs + 6*60*1000));
      if (ok){
        startBar(times.startMs, times.endMs);
        startCountdown(times.endMs);
        scheduleMoreSoon(false);
      } else {
        stopTimers();
        hardHideProgressAndTime();
        if (!at.artist && !at.title){ scheduleMoreSoon(true); } else { scheduleMoreSoon(false); }
      }
    }

    try { filterRecentAgainstNowPlaying(); } catch(e){}
  }

  window.NowPlaying = { updateFromPayload: updateFromPayload, filterRecentAgainstNowPlaying: filterRecentAgainstNowPlaying };
})();
