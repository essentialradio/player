// api/recent.js
// GET the most recent N items (default 5).
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
    const url = new URL(req.url, `http://${req.headers.host}`);
    const n = clamp(toInt(url.searchParams.get("limit")) ?? 5, 1, 50);

    // recentTracks is most-recent-first (LPUSH)
    const raw = await redis.lrange("recentTracks", 0, n - 1);
    const items = (raw || [])
      .map((v) => {
        if (typeof v === "object") return v;
        try { return JSON.parse(v); } catch { return null; }
      })
      .filter(Boolean);

    return res.status(200).json({ items });
  } catch (e) {
    console.error("RECENT error:", e);
    return res.status(200).json({ items: [] }); // safe fallback
  }
}

/* helpers */
function toInt(x) {
  const n = Number(x);
  return Number.isInteger(n) ? n : null;
}
function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}
