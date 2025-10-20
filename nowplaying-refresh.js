
/*! nowplaying-refresh.js (unified polling)
 * Uses the same polling cadence for PLAYIT and ALT.
 * Configure endpoint via:
 *   window.NP_ENDPOINT = '/api/latestTrack' (preferred)
 * Fallbacks to '/latestTrack.json' if not set.
 */
(function(){
  'use strict';

  var ENDPOINT = (function(){
    try {
      if (window.NP_ENDPOINT) return String(window.NP_ENDPOINT);
      var meta = document.querySelector('meta[name="np-endpoint"]');
      if (meta && meta.content) return String(meta.content);
    } catch(e){}
    // sensible fallbacks
    return '/api/latestTrack';
  })();

  var POLL_MS = (function(){
    try { if (window.NP_POLL_MS) return Number(window.NP_POLL_MS) || 5000; } catch(e){}
    return 5000; // 5s default
  })();

  var timer = null;
  var inFlight = false;

  async function fetchJSON(url){
    var res = await fetch(url, {cache:'no-store', headers:{'pragma':'no-cache','cache-control':'no-cache'}});
    if (!res.ok) throw new Error('HTTP '+res.status);
    return await res.json();
  }

  async function tick(){
    if (inFlight) return;
    inFlight = true;
    try{
      var payload = await fetchJSON(ENDPOINT);
      if (window.NowPlaying && typeof window.NowPlaying.updateFromPayload === 'function'){
        window.NowPlaying.updateFromPayload(payload);
      }
    } catch(e){
      // keep silent; next tick will retry
      // console.warn('[NowPlaying] tick failed', e);
    } finally {
      inFlight = false;
    }
  }

  function start(){
    stop();
    tick(); // fire immediately
    timer = setInterval(tick, POLL_MS);
  }

  function stop(){
    if (timer){ clearInterval(timer); timer = null; }
  }

  // auto start when DOM ready
  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  // expose controls if needed
  window.NowPlayingRefresh = { start: start, stop: stop, _tick: tick };
})();
