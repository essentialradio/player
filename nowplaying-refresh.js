
/*! nowplaying-refresh.js (unified for PLAYIT + ALT)
 * Endpoint auto-detect, cache-busting, backoff, visibility handling.
 * Config (set before load or via <meta name="np-endpoint" content="/path">):
 *   window.NP_ENDPOINT = '/latestTrack.json'
 *   window.NP_POLL_MS  = 5000
 */
(function(){
  'use strict';

  function metaEndpoint(){
    try {
      var m = document.querySelector('meta[name="np-endpoint"]');
      return m && m.content ? String(m.content) : null;
    } catch(e){ return null; }
  }
  var CANDIDATES = [];
  try { if (window.NP_ENDPOINT) CANDIDATES.push(String(window.NP_ENDPOINT)); } catch(e){}
  var meta = metaEndpoint(); if (meta) CANDIDATES.push(meta);
  CANDIDATES.push('/latestTrack.json', '/api/latestTrack', '/latest.json', '/api/nowplaying');

  var POLL_MS = (function(){
    try { if (window.NP_POLL_MS) return Number(window.NP_POLL_MS) || 5000; } catch(e){}
    return 5000;
  })();
  var MAX_BACKOFF = 30000;

  var endpoint = null;
  var timer = null;
  var controller = null;
  var failing = 0;
  var stoppedForHidden = false;

  function cacheBust(url){
    var sep = url.indexOf('?') >= 0 ? '&' : '?';
    return url + sep + '_ts=' + Date.now();
  }

  async function fetchJSON(url){
    controller = new AbortController();
    var res = await fetch(cacheBust(url), {
      cache: 'no-store',
      headers: {'pragma':'no-cache', 'cache-control':'no-cache'},
      signal: controller.signal
    });
    if (!res.ok) throw new Error('HTTP '+res.status+' on '+url);
    return await res.json();
  }

  function unwrapPayload(data){
    if (!data || typeof data !== 'object') return data;
    return (data.latest || data.nowplaying || data.item || data.payload || data);
  }

  async function detectEndpoint(){
    for (var i=0;i<CANDIDATES.length;i++){
      var url = CANDIDATES[i];
      try {
        var data = await fetchJSON(url);
        var payload = unwrapPayload(data);
        var ok = payload && typeof payload === 'object' &&
                 (payload.artist || payload.Artist || payload.title || payload.Title || payload.source || payload.Source);
        if (ok){
          endpoint = url;
          return endpoint;
        }
      } catch(e){ /* keep trying */ }
    }
    throw new Error('No working NP endpoint found: tried '+CANDIDATES.join(', '));
  }

  function deliver(payload){
    try {
      if (window.NowPlaying && typeof window.NowPlaying.updateFromPayload === 'function'){
        window.NowPlaying.updateFromPayload(payload);
        return;
      }
      if (typeof window.fetchNowPlaying === 'function'){
        window.fetchNowPlaying(payload);
        return;
      }
    } catch(e){ /* swallow */ }
  }

  async function tick(){
    try{
      if (!endpoint){
        await detectEndpoint();
      }
      var data = await fetchJSON(endpoint);
      var payload = unwrapPayload(data);
      deliver(payload);
      failing = 0;
    } catch(e){
      failing++;
    } finally {
      scheduleNext();
    }
  }

  function scheduleNext(){
    clearInterval(timer);
    var delay = Math.min(POLL_MS * Math.pow(2, Math.max(0, failing-1)), MAX_BACKOFF);
    timer = setTimeout(tick, delay);
  }

  function start(){
    stop();
    failing = 0;
    tick(); // immediate
  }

  function stop(){
    if (timer){ clearTimeout(timer); timer = null; }
    try { if (controller) controller.abort(); } catch(e){}
    controller = null;
  }

  document.addEventListener('visibilitychange', function(){
    if (document.hidden){
      stoppedForHidden = true;
      stop();
    } else {
      if (stoppedForHidden){
        start();
        stoppedForHidden = false;
      }
    }
  });

  window.addEventListener('online', start);

  // Boot
  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  window.NowPlayingRefresh = { start:start, stop:stop, _tick:tick, _detectEndpoint:detectEndpoint };
})();
