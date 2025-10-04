// pages/api/latestTrack.js
function normalize(x = {}) {
  const start = x.startTime || x.start || null;
  const d = Number.isFinite(x.duration) ? x.duration : Number(x.duration ?? NaN);
  const dur = Number.isFinite(d) ? d : null;
  const src = String(x.source || "").toUpperCase();
  const valid = !!start && Number.isFinite(dur) && dur > 0 && (src === "PLAYIT" || src === "FIXED");
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
  return { artist: "", title: "", startTime: null, duration: null, source: "ALT", indeterminate: true };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  try {
    // 1) Redis (only if creds exist)
    let track = null;
    const url = process.env.KV_REST_API_URL?.trim();
    const token = process.env.KV_REST_API_TOKEN?.trim();
    if (url && token) {
      try {
        const { Redis } = await import("@upstash/redis");
        const redis = new Redis({ url, token });
        const val = await redis.get("nowPlaying");
        track = typeof val === "string" ? JSON.parse(val) : (val || null);
      } catch (e) { console.error("Redis read failed:", e); }
    }

    // 2) File fallback
    if ((!track || track.duration == null) && process.env.LATEST_JSON_URL) {
      try {
        const base = process.env.LATEST_JSON_URL.trim();
        const bust = Math.floor(Date.now() / 10000);
        const r = await fetch(`${base}${base.includes("?") ? "&" : "?"}v=${bust}`, { cache: "no-store" });
        if (r.ok) return res.status(200).json(normalize(await r.json()));
      } catch (e) { console.error("File fallback failed:", e); }
    }

    // 3) Normalize or fallback
    return res.status(200).json(track ? normalize(track) : fallbackALT());
  } catch (e) {
    console.error("latestTrack API error:", e);
    return res.status(200).json(fallbackALT());
  }
}
