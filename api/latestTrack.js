// api/latestTrack.js
// GET the current now-playing object.
// Includes CORS for cross-origin reads from essential.radio

import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN, // RO or RW token is fine
});

function setCORS(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export default async function handler(req, res) {
  setCORS(res);
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    const val = await redis.get("nowplaying");
    let track = null;
    if (typeof val === "string") {
      try { track = JSON.parse(val); } catch { track = null; }
    } else if (val && typeof val === "object") {
      track = val;
    }
    const out = track || { artist: "", title: "", startTime: null, duration: 0 };
    return res.status(200).json(out);
  } catch (e) {
    console.error("LATEST error:", e);
    return res.status(200).json({ artist: "", title: "", startTime: null, duration: 0 });
  }
}
