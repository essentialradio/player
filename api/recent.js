// api/recent.js
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN, // RO or RW token is fine
});

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const n = Math.min(Math.max(Number(url.searchParams.get('limit')) || 12, 1), 50);

    const raw = await redis.lrange('recentTracks', 0, n - 1);
    const items = (raw || []).map(v => {
      try { return typeof v === 'string' ? JSON.parse(v) : v; }
      catch { return null; }
    }).filter(Boolean);

    return res.status(200).json({ items });
  } catch (err) {
    console.error('RECENT error:', err);
    return res.status(200).json({ items: [] }); // safe fallback
  }
}
