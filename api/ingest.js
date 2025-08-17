// api/ingest.js
// Accepts POSTs from your playout system (JSON or form-encoded).
// Adds CORS so you can post from any origin if needed.
// Stores "now playing" and appends to a rolling recent list in Upstash (KV/Redis).

import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN, // RW token
});

function setCORS(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export default async function handler(req, res) {
  setCORS(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Only POST allowed" });

  // Optional token check (recommended)
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const token = url.searchParams.get("token") || "";
    const expected = process.env.INGEST_TOKEN || "";
    if (expected && token !== expected) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  } catch {
    // ignore URL parse issues; continue
  }

  try {
    const body = await readBody(req); // JSON or form
    const artist = (body.artist ?? body.Artist ?? "").trim();
    const title  = (body.title  ?? body.Title  ?? "").trim();
    const duration = toNumber(body.duration ?? body["Duration (s)"]) ?? 0;
    const rawStart = body.startTime ?? body.start ?? body.Hour ?? null;
    const startTime = toISO(rawStart) ?? new Date().toISOString();

    if (!artist || !title) {
      return res.status(400).json({ error: "artist and title are required" });
    }

    const payload = { artist, title, duration, startTime };

    // 1) set now playing
    await redis.set("nowplaying", JSON.stringify(payload));

    // 2) push to recent (avoid consecutive dupes)
    const last = await redis.lindex("recentTracks", 0);
    const lastObj = safeParse(last);
    const isDupe = lastObj && lastObj.artist === artist && lastObj.title === title;

    if (!isDupe) {
      await redis.lpush("recentTracks", JSON.stringify({ ...payload, ts: Date.now() }));
      await redis.ltrim("recentTracks", 0, 49); // keep last 50
    }

    return res.status(200).json({ ok: true, stored: payload, pushedToRecent: !isDupe });
  } catch (e) {
    console.error("INGEST error:", e);
    return res.status(500).json({ error: "Failed to ingest data" });
  }
}

/* ---------- helpers ---------- */
function toNumber(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function toISO(x) {
  if (!x) return null;
  const d = new Date(x);
  return isNaN(d) ? null : d.toISOString();
}

function safeParse(x) {
  if (!x) return null;
  if (typeof x === "object") return x;
  try { return JSON.parse(x); } catch { return null; }
}

// Read JSON or application/x-www-form-urlencoded (PlayIt Live friendly)
function readBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const ct = (req.headers["content-type"] || "").toLowerCase();
      if (ct.includes("application/json")) {
        try { resolve(JSON.parse(raw || "{}")); } catch { resolve({}); }
        return;
      }
      // Treat anything else as form/unknown
      const params = new URLSearchParams(raw);
      const obj = {};
      for (const [k, v] of params.entries()) obj[k] = v;
      resolve(obj);
    });
  });
}
