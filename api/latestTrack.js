// /api/latestTrack.js
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
    if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
      const item = await redis.get("player:latest");
      if (item) return send(res, item, 200, 5);
    }
    const fb = readLocal("latestTrack.json", { artist: "", title: "", startTime: null, duration: 0 });
    return send(res, fb, 200, 5);
  } catch {
    return send(res, { artist: "", title: "", startTime: null, duration: 0 }, 200, 5);
  }
}

function readLocal(filename, fallback) {
  try { const p = path.join(process.cwd(), "player", filename); return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch { return fallback; }
}
function send(res, body, status = 200, maxAge = 10) {
  res.writeHead(status, { ...HDRS, "cache-control": `public, max-age=${maxAge}` });
  res.end(body == null ? "" : JSON.stringify(body));
}
