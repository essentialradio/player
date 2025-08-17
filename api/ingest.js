import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN, // full RW token
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Only POST allowed' });
  }

  try {
    const { artist, title, duration, startTime } = req.body;

    if (!artist || !title) {
      return res.status(400).json({ error: 'artist and title are required' });
    }

    const payload = {
      artist,
      title,
      duration: duration || 0,
      startTime: startTime || null,
    };

    await redis.set('nowplaying', JSON.stringify(payload));

    return res.status(200).json({ ok: true, stored: payload });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to ingest data' });
  }
}
