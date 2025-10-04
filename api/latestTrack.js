// pages/api/latestTrack.js
function isValidFixed(x = {}) {
  const start = x.startTime || x.start;
  const dur = Number.isFinite(x.duration) ? x.duration : Number(x.duration ?? NaN);
  const src = String(x.source || "").toUpperCase();
  return Boolean(start) && Number.isFinite(dur) && dur > 0 && src === "FIXED";
}
function isValidTimed(x = {}) {
  const start = x.startTime || x.start;
  const dur = Number.isFinite(x.duration) ? x.duration : Number(x.duration ?? NaN);
  const src = String(x.source || "").toUpperCase();
  return Boolean(start) && Number.isFinite(dur) && dur > 0 && (src === "PLAYIT" || src === "FIXED");
}
function normalize(x = {}) {
  const start = x.startTime || x.start || null;
  const durNum = Number.isFinite(x.duration) ? x.duration : Number(x.duration ?? NaN);
  const dur = Number.isFinite(durNum) ? durNum : null;
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

  try {
    const base = process.env.LATEST_JSON_URL?.trim();
    const hasFile = Boolean(base);
    const bust = Math.floor(Date.now() / 10000);

    // 1) Read FILE first (cheap and deterministic)
    let fromFile = null;
    if (hasFile) {
      try {
        const r = await fetch(`${base}${base.includes("?") ? "&" : "?"}v=${bust}`, { cache: "no-store" });
        if (r.ok) fromFile = await r.json();
      } catch (e) {
        console.error("File fetch failed:", e);
      }
    }

    // If the file says FIXED (valid timing), trust it immediately.
    if (fromFile && isValidFixed(fromFile)) {
      return res.status(200).json(normalize(fromFile));
    }

    // 2) Try REDIS (only if creds exist)
    let fromRedis = null;
    const url = process.env.KV_REST_API_URL?.trim();
    const token = process.env.KV_REST_API_TOKEN?.trim();
    if (url && token) {
      try {
        const { Redis } = await import("@upstash/redis");
        const redis = new Redis({ url, token });
        const val = await redis.get("nowPlaying");
        fromRedis = typeof val === "string" ? JSON.parse(val) : (val || null);
      } catch (e) {
        console.error("Redis read failed:", e);
      }
    }

    // 3) Prefer any valid timed item from Redis; otherwise fall back to the file (even if not FIXED)
    if (fromRedis && isValidTimed(fromRedis)) {
      return res.status(200).json(normalize(fromRedis));
    }
    if (fromFile) {
      return res.status(200).json(normalize(fromFile));
    }

    // 4) Last-resort fallback
    return res.status(200).json(fallbackALT());
  } catch (e) {
    console.error("latestTrack API error:", e);
    return res.status(200).json(fallbackALT());
  }
}
