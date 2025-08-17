// api/ingest.js
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN, // RW token
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Only POST allowed' });
  }

  try {
    const body = await readBody(req);
    const artist = (body.artist || '').trim();
    const title  = (body.title  || '').trim();
    const duration = Number(body.duration || 0);
    const startTime = body.startTime || new Date().toISOString();

    if (!artist || !title) {
      return res.status(400).json({ error: 'artist and title are required' });
    }

    const payload = { artist, title, duration, startTime };

    // Save "now playing"
    await redis.set('nowplaying', JSON.stringify(payload));

    // Avoid consecutive duplicates in the recent list
    const last = await redis.lindex('recentTracks', 0);
    const lastObj = safeParse(last);
    const isDupe = lastObj && lastObj.artist === artist && lastObj.title === title;

    if (!isDupe) {
      await redis.lpush('recentTracks', JSON.stringify({ ...payload, ts: Date.now() }));
      await redis.ltrim('recentTracks', 0, 49); // keep last 50
    }

    return res.status(200).json({ ok: true, stored: payload, pushedToRecent: !isDupe });
  } catch (err) {
    console.error('INGEST error:', err);
    return res.status(500).json({ error: 'Failed to ingest data' });
  }
}

/* helpers */
function safeParse(x) {
  if (!x) return null;
  try { return typeof x === 'string' ? JSON.parse(x) : x; } catch { return null; }
}

// Accept JSON or form-encoded (PlayIt Live friendly)
function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', c => raw += c);
    req.on('end', () => {
      const ct = (req.headers['content-type'] || '').toLowerCase();
      if (ct.includes('application/json')) {
        try { resolve(JSON.parse(raw || '{}')); } catch { resolve({}); }
        return;
      }
      // Treat as form/unknown
      const params = new URLSearchParams(raw);
      const obj = {};
      for (const [k, v] of params.entries()) obj[k] = v;
      resolve(obj);
    });
  });
}
