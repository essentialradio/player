// pages/api/latestTrack.js
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

function setCORS(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store, no-cache, max-age=0, s-maxage=0, must-revalidate");
}

function normalize(input) {
  const x = input || {};
  const start = x.startTime || x.start || null;
  const dur = Number.isFinite(x.duration) ? x.duration : Number(x.duration || 0) || null;
  const source = String(x.source || "").toUpperCase();
  const artist = x.artist || "";
  const title = x.title || "";

  // Valid “now playing” when we know start + duration and it’s PLAYIT or FIXED.
  const valid = Boolean(start) && Number.isFinite(dur) && dur > 0 && (source === "PLAYIT" || source === "FIXED");

  return {
    artist,
    title,
    startTime: start,
    duration: dur,
    source: valid ? source : (source || "ALT"),
    indeterminate: !valid,
  };
}

function fallbackALT() {
  return { artist: "", title: "", startTime: null, duration: null, source: "ALT", indeterminate: true };
}

export default async function handler(req, res) {
  setCORS(res);
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    // 1) Try Redis
    let track = null;
    try {
      const val = await redis.get("nowPlaying");
      if (typeof val === "string") track = JSON.parse(val);
      else if (val && typeof val === "object") track = val;
    } catch {}

    // 2) If Redis empty/invalid, fetch latestTrack.json from your “depository”
    if (!track || track.duration == null) {
      const url = (process.env.LATEST_JSON_URL || "").trim();
      if (url) {
        const bust = Math.floor(Date.now() / 10000); // ~10s cache-bust
        const r = await fetch(`${url}${url.includes("?") ? "&" : "?"}v=${bust}`, { cache: "no-store" });
        if (r.ok) {
          const fileJson = await r.json();
          const norm = normalize(fileJson);
          return res.status(200).json(norm);
        }
      }
    }

    // 3) Return normalised Redis (or ALT fallback if still nothing)
    const out = track ? normalize(track) : fallbackALT();
    return res.status(200).json(out);
  } catch (e) {
    console.error("LATEST error:", e);
    return res.status(200).json(fallbackALT());
  }
}
