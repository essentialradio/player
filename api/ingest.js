// pages/api/ingest.js
import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

function toNumber(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

// Promise timeout so we never hang the caller
function withTimeout(promise, ms = 4000) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error('KV timeout')), ms)),
  ]);
}

// Parse body for both JSON and x-www-form-urlencoded
async function parseBody(req) {
  const ct = (req.headers['content-type'] || '').toLowerCase();

  if (ct.includes('application/json')) {
    return req.body || {};
  }

  if (ct.includes('application/x-www-form-urlencoded')) {
    // Manually read the raw body and parse it
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8');
    const params = new URLSearchParams(raw);
    return Object.fromEntries(params.entries());
  }

  return {};
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    // Auth
    const { token } = req.query;
    if (!token || token !== process.env.INGEST_TOKEN) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Body
    const body = await parseBody(req);
    const artist = (body.artist || '').toString().trim();
    const title = (body.title || '').toString().trim();
    const duration = toNumber(body.duration);
    const startTime = (body.startTime || new Date().toISOString()).toString();

    if (!artist || !title) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const track = { artist, title, duration, startTime };

    // Write to KV with a timeout; also push to recent
    await withTimeout(redis.set('nowPlaying', JSON.stringify(track), { ex: 900 })); // optional TTL
    await withTimeout(redis.lpush('recentTracks', JSON.stringify(track)));
    await withTimeout(redis.ltrim('recentTracks', 0, 19));

    return res.status(200).json({ ok: true, stored: true, track });
  } catch (err) {
    // Don’t hang the pipeline; return a clear error
    return res.status(500).json({ ok: false, error: String(err) });
  }
}
