// /api/recent.js
import fs from "fs";
import path from "path";
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const HDRS = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type",
};

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return send(res, null, 204);

  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const limit = clamp(Number(url.searchParams.get("limit")) || 12, 5, 30);

    if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
      const raw = await redis.lrange("player:recent", 0, limit - 1);
      if (raw?.length) {
        const items = raw.map(deserialise).filter(Boolean);
        return send(res, { items: dedupeConsecutive(items) }, 200, 15);
      }
    }

    let items = readLocal("playout_log_rolling.json", []);
    if (Array.isArray(items)) items = items.slice(0, limit);
    return send(res, { items: dedupeConsecutive(items) }, 200, 15);
  } catch {
    return send(res, { items: [] }, 200, 5);
  }
}

/* utils */
function readLocal(filename, fallback) {
  try { const p = path.join(process.cwd(), "player", filename); return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch { return fallback; }
}
function deserialise(x) { try { return typeof x === "string" ? JSON.parse(x) : x; } catch { return null; } }
function dedupeConsecutive(arr) {
  const out = [];
  for (const it of arr) {
    const last = out[out.length - 1];
    if (!last || last.artist !== it.artist || last.title !== it.title) out.push(it);
  }
  return out;
}
function clamp(n, min, max) { n = Number.isFinite(n) ? n : min; return Math.max(min, Math.min(max, n)); }
function send(res, body, status = 200, maxAge = 10) {
  res.writeHead(status, { ...HDRS, "cache-control": `public, max-age=${maxAge}` });
  res.end(body == null ? "" : JSON.stringify(body));
}
