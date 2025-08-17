// api/latestTrack.js
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN, // same vars as ingest.js
});

export default async function handler(req, res) {
  try {
    const val = await redis.get("nowplaying");

    let track = null;
    if (typeof val === "string") {
      try { track = JSON.parse(val); } catch { track = null; }
    } else if (val && typeof val === "object") {
      track = val;
    }

    // Always return a well-shaped object
    const out = track || { artist: "", title: "", startTime: null, duration: 0 };
    return res.status(200).json(out);
  } catch (err) {
    // Don’t 500 the player—return safe fallback
    return res.status(200).json({ artist: "", title: "", startTime: null, duration: 0 });
  }
}
