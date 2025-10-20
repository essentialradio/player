
/*! nowplaying.js (unified: PLAYIT + ALT) — 2025-10-20c */
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
  var NP_DEBUG = (function(){
    try { return !!window.NP_DEBUG; } catch(e){ return false; }
  })();

  function log(){ if (NP_DEBUG && console && console.log) try { console.log.apply(console, arguments); } catch(e){} }

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
      c.style.removeProperty('display');
      c.hidden = false;
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
      if (x > 1e11) return Math.floor(x);   // definitely ms
      if (x > 3.6e6) return Math.floor(x);  // >1h, almost certainly ms
      if (x > 1e6)   return Math.floor(x);  // conservative
      return Math.floor(x * 1000);          // seconds -> ms
    }
    var s = String(x).trim();
    if (/^\d+$/.test(s)) {
      var n = Number(s);
      if (n > 1e11) return Math.floor(n);
      if (n > 3.6e6) return Math.floor(n);  // >1h => ms
      if (n > 1e6)   return Math.floor(n);
      return Math.floor(n * 1000);          // treat as seconds
    }
    var t = Date.parse(s);
    return isFinite(t) ? t : null;
  }

  function parseDurationMs(d){
    var ms = null;
    if (d == null) return null;
    if (typeof d === 'number' && isFinite(d)) {
      // Heuristic: if > 3.6e6 it's ms, else seconds
      ms = (d > 3.6e6) ? Math.floor(d) : Math.floor(d * 1000);
    } else {
      var s = String(d).trim();
      if (/^(\d+):(\d{2})(?::(\d{2}))?$/.test(s)) {
        var parts = s.split(':');
        var sec = 0;
        if (parts.length === 2) { sec = Number(parts[0])*60 + Number(parts[1]); }
        else if (parts.length === 3) { sec = Number(parts[0])*3600 + Number(parts[1])*60 + Number(parts[2]); }
        ms = sec * 1000;
      } else if (/^\d+$/.test(s)) {
        var n = Number(s);
        // If it's already >= 10 minutes expressed as a number, assume ms
        ms = (n >= 600000) ? n : n * 1000;
      }
    }
    return isFinite(ms) ? ms : null;
  }

  function parsePositionMs(p){
    if (p == null) return null;
    if (typeof p === 'number' && isFinite(p)) {
      return (p > 1e6 ? Math.floor(p) : Math.floor(p * 1000));
    }
    var s = String(p).trim();
    if (/^\d+$/.test(s)) {
      var n = Number(s);
      return (n > 1e6 ? n : n * 1000);
    }
    return null;
  }

  function extractTimes(payload){
    var startMs = null, endMs = null;
    var now = Date.now();

    // candidates
    var cStart = [];
    var cEnd = [];

    // explicit ms numbers
    if (payload?.startMs != null || payload?.StartMs != null) cStart.push(Number(payload.startMs ?? payload.StartMs));
    if (payload?.endMs   != null || payload?.EndMs   != null) cEnd.push(Number(payload.endMs   ?? payload.EndMs));

    // ISO strings
    var startIso = payload?.['Start ISO'] ?? payload?.startTime ?? payload?.StartTime ?? payload?.startedAt ?? payload?.['Start Time'] ?? payload?.Start;
    var endIso   = payload?.['End ISO']   ?? payload?.endTime   ?? payload?.EndTime   ?? payload?.['End Time']   ?? payload?.End;
    if (startIso != null) cStart.push(toMs(startIso));
    if (endIso   != null) cEnd.push(toMs(endIso));

    // duration/position/remaining
    var durationMs = parseDurationMs(payload?.durationMs ?? payload?.DurationMs ?? payload?.duration ?? payload?.Duration);
    var positionMs = parsePositionMs(payload?.positionMs ?? payload?.elapsedMs ?? payload?.progressMs ?? payload?.position ?? payload?.elapsed ?? payload?.progress);
    var remainingMs = parsePositionMs(payload?.remainingMs ?? payload?.remaining);

    // reduce starts / ends to first valid
    for (var i=0;i<cStart.length;i++){ if (isFinite(cStart[i])) { startMs = cStart[i]; break; } }
    for (var j=0;j<cEnd.length;j++){   if (isFinite(cEnd[j]))   { endMs   = cEnd[j];   break; } }

    // derive
    var e1 = (startMs!=null && durationMs!=null) ? (startMs + durationMs) : null;
    var e2 = (durationMs!=null && positionMs!=null) ? (now + Math.max(0, durationMs - positionMs)) : null;
    var e3 = (remainingMs!=null && remainingMs>0) ? (now + remainingMs) : null;

    // choose best end: prefer explicit end, else nearest future among derived
    var candidates = [];
    if (isFinite(endMs)) candidates.push(endMs);
    if (isFinite(e1)) candidates.push(e1);
    if (isFinite(e2)) candidates.push(e2);
    if (isFinite(e3)) candidates.push(e3);

    // filter: > now-15s and < now+8h
    candidates = candidates.filter(function(x){ return x && (x > now - 15000) && (x < now + 8*3600*1000); });
    if (candidates.length){
      // pick the smallest > now-15s (soonest finishing)
      candidates.sort(function(a,b){ return a-b; });
      endMs = candidates[0];
      // if we still don't have start, and have duration, back-compute
      if (startMs == null && durationMs != null) startMs = endMs - durationMs;
    }

    // sanity
    if (endMs != null && startMs != null && endMs <= startMs){ startMs = null; }
    log('[NP times]', {startMs:startMs, endMs:endMs, durationMs:durationMs, positionMs:positionMs, remainingMs:remainingMs});

    return { startMs: (isFinite(startMs) ? startMs : null), endMs: (isFinite(endMs) ? endMs : null) };
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
