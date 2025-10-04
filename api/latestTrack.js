// pages/api/latestTrack.js  (Next.js pages router)
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

function normalize(x = {}) {
  const start = x.startTime || x.start || null;
  const dur = Number.isFinite(x.duration) ? x.duration : Number(x.duration || 0) || null;
  const src = String(x.source || "").toUpperCase();
  const valid = Boolean(start) && Number.isFinite(dur) && dur > 0 && (src === "PLAYIT" || src === "FIXED");
  return {
    artist: x.artist || "",
    title: x.title || "",
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
    // 1) Redis first
    let track = null;
    try {
      const val = await redis.get("nowPlaying");
      track = typeof val === "string" ? JSON.parse(val) : (val || null);
    } catch {}

    // 2) File fallback if Redis empty/invalid
    if ((!track || track.duration == null) && process.env.LATEST_JSON_URL) {
      const bust = Math.floor(Date.now() / 10000); // ~10s cache-bust
      const r = await fetch(`${process.env.LATEST_JSON_URL}${process.env.LATEST_JSON_URL.includes("?") ? "&" : "?"}v=${bust}`, { cache: "no-store" });
      if (r.ok) {
        const fileJson = await r.json();
        return res.status(200).json(normalize(fileJson));
      }
    }

    // 3) Normalize whatever we have (or ALT fallback)
    return res.status(200).json(track ? normalize(track) : fallbackALT());
  } catch (e) {
    console.error("latestTrack API error:", e);
    return res.status(200).json(fallbackALT());
  }
}
