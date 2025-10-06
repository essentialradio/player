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

export default async function handler(req, res) {
  setCORS(res);
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    const val = await redis.get("nowPlaying");
    let track = null;
    if (typeof val === "string") {
      try { track = JSON.parse(val); } catch { track = null; }
    } else if (val && typeof val === "object") {
      track = val;
    }
    const out = track || { artist: "", title: "", startTime: null, duration: null };

    // Enrich: if duration is null/0, treat as open-ended (ALT semantics)
    const open = out.duration == null || Number(out.duration) === 0;
    if (open) {
      out.source = out.source || "ALT";
      out.indeterminate = true;
      out.duration = null;
    } else {
      out.indeterminate = false;
    }

    return res.status(200).json(out);
  } catch (e) {
    console.error("LATEST error:", e);
    return res.status(200).json({ artist: "", title: "", startTime: null, duration: null, indeterminate: true, source: "ALT" });
  }
}
