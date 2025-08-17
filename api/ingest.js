// api/ingest.js
import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { token } = req.query;
  if (token !== process.env.INGEST_TOKEN) {
    return res.status(403).json({ error: "Forbidden" });
  }

  let artist, title, duration, startTime;

  try {
    if (req.headers["content-type"]?.includes("application/json")) {
      // JSON body
      ({ artist, title, duration, startTime } = req.body);
    } else if (req.headers["content-type"]?.includes("application/x-www-form-urlencoded")) {
      // Form-encoded body
      artist = req.body.artist;
      title = req.body.title;
      duration = req.body.duration;
      startTime = req.body.startTime;
    }
  } catch (err) {
    return res.status(400).json({ error: "Invalid request body", details: err.message });
  }

  if (!artist || !title) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  // Build track object
  const track = {
    artist,
    title,
    duration: duration ? Number(duration) : 0,
    startTime: startTime || new Date().toISOString(),
  };

  try {
    // Save current track
    await redis.set("nowPlaying", JSON.stringify(track));

    // Add to history (prepend to list)
    await redis.lpush("recentTracks", JSON.stringify(track));

    // Trim list to last 20 items
    await redis.ltrim("recentTracks", 0, 19);

    return res.json({ ok: true, stored: true, track });
  } catch (err) {
    return res.status(500).json({ error: "Upstash not configured", details: err.message });
  }
}
