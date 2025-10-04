// pages/api/latestTrack.js

function normalize(x = {}) {
  const start = x.startTime || x.start || null;
  const durNum =
    Number.isFinite(x.duration) ? x.duration :
    Number(x.duration ?? NaN);
  const dur = Number.isFinite(durNum) ? durNum : null;

  const src = String(x.source || "").toUpperCase();
  const valid = Boolean(start) && Number.isFinite(dur) && dur > 0 && (src === "PLAYIT" || src === "FIXED");

  return {
    artist: x.artist || "",
    title:  x.title  || "",
    startTime: start,
    duration: dur,
    source: valid ? src : (src || "ALT"),
    indeterminate: !valid,
  };
}

function fallbackALT() {
  return { artist:"", title:"", startTime:null, duration:null, source:"ALT", indeterminate:true };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");

  try {
    // --- 1) Try Redis ONLY if creds exist ---
    let track = null;
    const url = process.env.KV_REST_API_URL?.trim();
    const token = process.env.KV_REST_API_TOKEN?.trim();
    if (url && token) {
      try {
        const { Redis } = await import("@upstash/redis");
        const redis = new Redis({ url, token });
        const val = await redis.get("nowPlaying");
        if (typeof val === "string") track = JSON.parse(val);
        else if (val && typeof val === "object") track = val;
      } catch (e) {
        // Log but do not crash the function
        console.error("Redis read failed:", e);
      }
    }

    // --- 2) Fallback to file written by your Python script ---
    if ((!track || track.duration == null) && process.env.LATEST_JSON_URL) {
      try {
        const base = process.env.LATEST_JSON_URL.trim();
        const bust = Math.floor(Date.now() / 10000); // cache-bust ~10s
        const r = await fetch(`${base}${base.includes("?") ? "&" : "?"}v=${bust}`, { cache: "no-store" });
        if (r.ok) {
          const fileJson = await r.json();
          return res.status(200).json(normalize(fileJson));
        }
      } catch (e) {
        console.error("File fallback fetch failed:", e);
      }
    }

    // --- 3) Return normalized Redis (or ALT fallback) ---
    return res.status(200).json(track ? normalize(track) : fallbackALT());
  } catch (e) {
    console.error("latestTrack API error:", e);
    return res.status(200).json(fallbackALT());
  }
}
