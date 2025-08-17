// api/latestTrack.js
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

export default async function handler(req, res) {
  try {
    // Match the key used in ingest.js
    const track = await redis.get("nowplaying");
    const parsed = track ? JSON.parse(track) : {};

    res.status(200).json(parsed);
  } catch (err) {
    console.error("Error fetching track:", err);
    res.status(500).json({ error: "Failed to fetch latest track" });
  }
}
