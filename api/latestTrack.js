// pages/api/latestTrack.js

function isValidFixed(x = {}) {
  const start = x.startTime || x.start;
  const d = Number.isFinite(x.duration) ? x.duration : Number(x.duration ?? NaN);
  const src = String(x.source || "").toUpperCase();
  return !!start && Number.isFinite(d) && d > 0 && src === "FIXED";
}
function isValidTimed(x = {}) {
  const start = x.startTime || x.start;
  const d = Number.isFinite(x.duration) ? x.duration : Number(x.duration ?? NaN);
  const src = String(x.source || "").toUpperCase();
  return !!start && Number.isFinite(d) && d > 0 && (src === "PLAYIT" || src === "FIXED");
}
function normalize(x = {}) {
  const start = x.startTime || x.start || null;
  const d = Number.isFinite(x.duration) ? x.duration : Number(x.duration ?? NaN);
  const dur = Number.isFinite(d) ? d : null;
  const src = String(x.source || "").toUpperCase();
  return {
    artist: x.artist || "",
    title:  x.title  || "",
    startTime: start,
    duration: dur,
    source: src || "ALT",
    indeterminate: !(start && Number.isFinite(dur) && dur > 0 && (src === "PLAYIT" || src === "FIXED")),
  };
}
function fallbackALT() {
  return { artist:"", title:"", startTime:null, duration:null, source:"ALT", indeterminate:true };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");

  const debugMode =
    (req.query && (req.query.debug === "1" || req.query.debug === "true")) ||
    (typeof req.url === "string" && /\bdebug=(1|true)\b/i.test(req.url));

  const debug = { from: "fallback", steps: [], env: {
    LATEST_JSON_URL: process.env.LATEST_JSON_URL || null,
    KV_REST_API_URL: !!process.env.KV_REST_API_URL,
    KV_REST_API_TOKEN: !!process.env.KV_REST_API_TOKEN,
  } };

  try {
    // --- 1) FILE FIRST (with a safe default) ---
    const base =
      (process.env.LATEST_JSON_URL && process.env.LATEST_JSON_URL.trim()) ||
      "https://player-green.vercel.app/latestTrack.json"; // default so we can't fail on a missing env

    let fromFile = null;
    try {
      const bust = Math.floor(Date.now() / 10000);
      const url = `${base}${base.includes("?") ? "&" : "?"}v=${bust}`;
      const r = await fetch(url, { cache: "no-store" });
      debug.steps.push({ stage: "file-fetch", url, status: r.status });
      if (r.ok) fromFile = await r.json();
    } catch (e) {
      debug.steps.push({ stage: "file-fetch", error: String(e) });
    }

    if (fromFile && isValidFixed(fromFile)) {
      debug.from = "file(FIXED)";
      const out = normalize(fromFile);
      if (debugMode) out.debug = debug;
      return res.status(200).json(out);
    }

    // --- 2) REDIS (only if creds exist) ---
    let fromRedis = null;
    const url = process.env.KV_REST_API_URL?.trim();
    const token = process.env.KV_REST_API_TOKEN?.trim();
    if (url && token) {
      try {
        const { Redis } = await import("@upstash/redis");
        const redis = new Redis({ url, token });
        const val = await redis.get("nowPlaying");
        fromRedis = typeof val === "string" ? JSON.parse(val) : (val || null);
        debug.steps.push({ stage: "redis-get", ok: true, hasValue: !!fromRedis });
      } catch (e) {
        debug.steps.push({ stage: "redis-get", error: String(e) });
      }
    } else {
      debug.steps.push({ stage: "redis-get", error: "KV creds not set" });
    }

    if (fromRedis && isValidTimed(fromRedis)) {
      debug.from = "redis";
      const out = normalize(fromRedis);
      if (debugMode) out.debug = debug;
      return res.status(200).json(out);
    }

    // --- 3) Otherwise return the file (even if not FIXED), or fallback ---
    if (fromFile) {
      debug.from = "file";
      const out = normalize(fromFile);
      if (debugMode) out.debug = debug;
      return res.status(200).json(out);
    }

    const out = fallbackALT();
    if (debugMode) out.debug = debug;
    return res.status(200).json(out);
  } catch (e) {
    const out = fallbackALT();
    if (debugMode) out.debug = { ...debug, error: String(e) };
    return res.status(200).json(out);
  }
}
