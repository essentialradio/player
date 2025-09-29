// api/latestTrack.js
// Prefer latestTrack.json (served from repo root or /public), fallback to Redis "nowPlaying".
// CORS + no-store headers kept for cross-origin + freshness.

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

async function fetchText(url) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`GET ${url} -> ${r.status}`);
  return r.text();
}

function normaliseTrack(obj) {
  const artist = typeof obj?.artist === "string" ? obj.artist : "";
  const title = typeof obj?.title === "string" ? obj.title : "";
  const duration = Number.isFinite(obj?.duration) ? obj.duration : 0;
  const startTime = typeof obj?.startTime === "string" ? obj.startTime : null;
  return { artist, title, duration, startTime };
}

async function fetchLatestFromFile(req) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host  = req.headers["x-forwarded-host"] || req.headers.host;
  const base  = `${proto}://${host}`;
  const tries = [
    `${base}/latestTrack.json?ts=${Date.now()}`,          // repo root
    `${base}/public/latestTrack.json?ts=${Date.now()}`,   // /public fallback
  ];

  let lastErr;
  for (const u of tries) {
    try {
      const txt = await fetchText(u);
      const obj = JSON.parse(txt);
      const norm = normaliseTrack(obj);
      if (norm.artist || norm.title) return norm;
      // If both are blank, keep trying fallbacks
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("latestTrack.json not available");
}

export default async function handler(req, res) {
  setCORS(res);
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    // 1) Prefer the file written by your Python updater
    try {
      const fileTrack = await fetchLatestFromFile(req);
      return res.status(200).json(fileTrack);
    } catch {
      // continue to Redis fallback
    }

    // 2) Fallback to Redis (legacy behaviour)
    try {
      const val = await redis.get("nowPlaying");
      let track = null;
      if (typeof val === "string") {
        try { track = JSON.parse(val); } catch { track = null; }
      } else if (val && typeof val === "object") {
        track = val;
      }
      if (track) {
        return res.status(200).json(normaliseTrack(track));
      }
    } catch (e) {
      console.warn("latestTrack Redis fallback failed:", e?.message || e);
    }

    // 3) Final empty default
    return res.status(200).json({ artist: "", title: "", startTime: null, duration: 0 });
  } catch (e) {
    console.error("LATEST error:", e);
    return res.status(200).json({ artist: "", title: "", startTime: null, duration: 0 });
  }
}
