
/*! Essential Radio: iOS-safe Artwork Patch v1.6 (2025-09-29)
   * Mobile Safari fixes for #artwork and, if available, recent thumbnails.
   * - Keeps art during a track; clears only after (startTime + duration + grace) when feed is blank/indeterminate.
   * - Avoids broken-image flashes; pre-binds handlers; cache-busts fetches and image URLs.
   * - Does nothing on non‑iOS.
   */
(function () {
  // --- iOS detection (real devices + iPadOS on Mac) ---
  var UA = navigator.userAgent || "";
  var IS_IOS = /iPhone|iPad|iPod/.test(UA) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (!IS_IOS) return;
  try { window.__IOS_ARTWORK_PATCH_ACTIVE = true; } catch(e) {}

  // --- Config ---
  var IMG_SEL = "#artwork";
  var POLL_MS = 12000;
  var QUIET_MS_AFTER_SUCCESS = 3000;
  var CLEAR_GRACE_MS = 5000;
  // 1x1 transparent PNG
  var CLEAR_PIXEL = 'Essential Radio Logo.png';

  var lastMeta = null;   // {artist,title}
  var lastURL  = null;
  var lastSwapAt = 0;
  var lastEndAt = 0;
  var busy = false;

  function $(sel){ return document.querySelector(sel); }
  function $all(sel){ return Array.prototype.slice.call(document.querySelectorAll(sel)); }

  function bindImg(img) {
    if (!img || img.__ios_art_bound) return;
    try { img.loading = "eager"; } catch {}
    try { img.decoding = "async"; } catch {}
    img.addEventListener("load", function(){ img.classList.add("loaded"); }, {passive:true});
    img.addEventListener("error", function(){
      // If we don't have a valid URL yet, show a neutral pixel instead of a broken icon
      if (!lastURL) requestAnimationFrame(function(){ img.src = CLEAR_PIXEL; });
    }, {passive:true});
    img.__ios_art_bound = true;
  }

  function parseEnd(startISO, durSec) {
    try {
      var t = Date.parse(startISO);
      if (isFinite(t) && isFinite(durSec) && Number(durSec) > 0) return t + Math.floor(Number(durSec) * 1000);
    } catch(e){}
    return 0;
  }

  function qs(obj) {
    var s = [];
    for (var k in obj) if (Object.prototype.hasOwnProperty.call(obj,k)) {
      s.push(encodeURIComponent(k) + "=" + encodeURIComponent(String(obj[k])));
    }
    return s.join("&");
  }

  function api(path, params) {
    // support either /api/artwork or /api/artwork.js depending on deploy
    var base = path;
    if (base === "/api/artwork") {
      base = (window.__ARTWORK_ROUTE_SUFFIX_JS ? "/api/artwork.js" : "/api/artwork");
    }
    var url = base + (params ? ("?" + qs(params)) : "");
    // cache-bust all network requests for iOS
    url += (url.indexOf("?") === -1 ? "?" : "&") + "_=" + Date.now();
    return url;
  }

  function cleanTerm(s) {
    return String(s||"")
      .replace(/[\u2013\u2014]/g, "-")
      .replace(/\s*-\s*/g, " ")
      .replace(/\s*\([^)]*\)/g, " ")
      .replace(/\s*\[[^\]]*\]/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  function validMeta(meta) {
    var a = String(meta.artist||"").trim();
    var t = String(meta.title||"").trim();
    if (!a || !t) return false;
    if (meta.indeterminate === true) return false;
    return true;
  }

  function sameMeta(a,b){
    if (!a || !b) return false;
    return a.artist === b.artist && a.title === b.title;
  }

  function shouldClear(latestRaw) {
    if (!lastEndAt) return false;
    var now = Date.now();
    if (now < lastEndAt + CLEAR_GRACE_MS) return false;
    var artist = String(latestRaw.artist || "").trim();
    var title  = String(latestRaw.title  || "").trim();
    var inde   = !!latestRaw.indeterminate;
    return inde || !artist || !title;
  }

  function getJSON(url) {
    return fetch(url, { cache: "no-store" }).then(function(r){
      if (!r.ok) throw new Error("HTTP "+r.status);
      return r.json();
    });
  }

  function resolveArtworkURL(meta) {
    // Query our proxy first (better CORS + scaling), fallback to iTunes via the same proxy.
    var term = cleanTerm(meta.title + " " + meta.artist);
    // Prefer /api/artwork(.js)?q=
    var primary = api("/api/artwork", { q: term, country: "GB", limit: "5" });
    // If site expects .js in path, set a hint
    if (String(location.pathname).endsWith(".html")) { try { window.__ARTWORK_ROUTE_SUFFIX_JS = true; } catch(e){} }
    return getJSON(primary).then(function(d){
      if (d && d.url) return d.url;
      return "";
    }).catch(function(){
      return "";
    });
  }

  function setImgSrc(img, url) {
  if (!img) return;
  bindImg(img);
  if (url) {
    img.classList.remove('fallback');
    const _on = () => { img.classList.add('loaded'); img.removeEventListener('load', _on); };
    img.addEventListener('load', _on);
    var busted = url + (url.indexOf('?') === -1 ? '?' : '&') + '_=' + Date.now();
    requestAnimationFrame(function(){ img.src = busted; });
    if (img.complete && img.naturalWidth > 0) { img.classList.add('loaded'); }
  } else {
    img.classList.remove('loaded');
    img.classList.add('fallback');
    requestAnimationFrame(function(){ img.src = CLEAR_PIXEL; });
  }
}

  function updateRecentThumbs() {
    // Optional enhancement: look for recent list images that include data-artist/title
    var nodes = $all("ul#recent-list img[data-artist][data-title]");
    if (!nodes.length) return; // no compatible markup; skip
    nodes.forEach(function(img){
      if (img.__ios_recent_done) return;
      var art = img.getAttribute("data-artist") || "";
      var tit = img.getAttribute("data-title") || "";
      var meta = { artist: art, title: tit };
      if (!validMeta(meta)) return;
      img.__ios_recent_done = true;
      bindImg(img);
      resolveArtworkURL(meta).then(function(url){
        if (url) setImgSrc(img, url);
      });
    });
  }

  function tick() {
    if (busy) return;
    busy = true;
    var img = $(IMG_SEL);
    if (img) bindImg(img);

    Promise.resolve().then(function(){
      var now = Date.now();
      if (now - lastSwapAt < QUIET_MS_AFTER_SUCCESS) return null;
      // Pull latest track
      return getJSON(api("/api/latestTrack")).then(function(latest){
        if (!latest) return null;

        // Compute clearing logic first
        if (img && shouldClear(latest)) { img.classList.remove('loaded'); img.classList.add('fallback'); setImgSrc(img, CLEAR_PIXEL); lastURL = null; return null; }

        // Build meta
        var meta = {
          artist: String(latest.artist || "").trim(),
          title:  String(latest.title  || "").trim(),
          source: latest.source || "",
          startTime: latest.startTime || latest.started || null,
          duration: latest.duration,
          indeterminate: !!latest.indeterminate
        };

        if (!validMeta(meta)) return null;

        // Refresh end time
        var end = parseEnd(meta.startTime, meta.duration);
        if (end) lastEndAt = end;

        // Same track? nothing to do
        if (sameMeta(meta, lastMeta)) return null;

        // Resolve and swap
        return resolveArtworkURL(meta).then(function(url){
          if (img) setImgSrc(img, url || CLEAR_PIXEL);
          if (url) lastURL = url;
          lastMeta = { artist: meta.artist, title: meta.title };
          lastSwapAt = Date.now();
          return null;
        });
      });
    }).catch(function(){ /* keep current art on error */ })
      .finally(function(){
        // Try to hydrate recent thumbnails opportunistically
        try { updateRecentThumbs(); } catch(e){}
        busy = false;
      });
  }

  // Kick off
  try {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", tick, { once: true });
    } else {
      tick();
    }
    setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", function(){ if (!document.hidden) tick(); }, {passive:true});
  } catch(e){}
})();
