// api/latestTrack.js
// Unified "Now Playing" endpoint.
// Prefer the file written by Python (latestTrack.json), fallback to Redis if absent.

import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

function setCORS(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  // prevent caches from serving stale NP
  res.setHeader("Cache-Control", "no-store, no-cache, max-age=0, s-maxage=0, must-revalidate");
}

async function fetchText(url) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`GET ${url} -> ${r.status}`);
  return r.text();
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
      // normalise + validate
      const artist = typeof obj.artist === "string" ? obj.artist : "";
      const title  = typeof obj.title  === "string" ? obj.title  : "";
      const duration = Number.isFinite(obj.duration) ? obj.duration : 0;
      const startTime = typeof obj.startTime === "string" ? obj.startTime : null;

      if (!artist && !title) continue; // skip empty
      return { artist, title, duration, startTime };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("latestTrack.json not found");
}

export default async function handler(req, res) {
  setCORS(res);
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    // 1) Prefer the file written by the Python updater
    try {
      const fileTrack = await fetchLatestFromFile(req);
      return res.status(200).json(fileTrack);
    } catch {
      // fall through to Redis
    }

    // 2) Fallback to Redis key "nowPlaying" (legacy)
    try {
      const val = await redis.get("nowPlaying");
      let track = null;
      if (typeof val === "string") {
        try { track = JSON.parse(val); } catch { track = null; }
      } else if (val && typeof val === "object") {
        track = val;
      }
      if (track && (track.artist || track.title)) {
        const out = {
          artist: track.artist || "",
          title: track.title || "",
          duration: Number.isFinite(track.duration) ? track.duration : 0,
          startTime: typeof track.startTime === "string" ? track.startTime : null
        };
        return res.status(200).json(out);
      }
    } catch (e) {
      console.warn("latestTrack Redis fallback failed:", e?.message || e);
    }

    // 3) Final empty default
    return res.status(200).json({ artist: "", title: "", duration: 0, startTime: null });
  } catch (e) {
    console.error("LATEST error:", e);
    return res.status(200).json({ artist: "", title: "", duration: 0, startTime: null });
  }
}
