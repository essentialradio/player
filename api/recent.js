// api/recent.js
import { put, get } from '@vercel/blob';

const BLOB_PATH = 'recent.json';
const MAX = 500;

async function readLog() {
  try {
    const info = await get(BLOB_PATH); // throws if not found
    const res = await fetch(info.url, { cache: 'no-store' });
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return []; // first run: no blob yet
  }
}

async function writeLog(list) {
  await put(BLOB_PATH, JSON.stringify(list), {
    contentType: 'application/json',
    access: 'public',
  });
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const list = await readLog();
      res.setHeader('Cache-Control', 'no-store, no-cache, max-age=0, s-maxage=0, must-revalidate');
      return res.status(200).json(list.slice(0, 100)); // top 100
    }

    if (req.method === 'POST') {
      const b = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const { artist, title, startMs, endMs, duration, endedAt } = b || {};
      if (!artist || !title || !startMs || !endMs) {
        return res.status(400).json({ error: 'invalid payload' });
      }
      const key = `${artist}||${title}||${startMs}`;
      const list = await readLog();
      if (!list.length || list[0].key !== key) {
        list.unshift({ key, artist, title, startMs, endMs, duration, endedAt });
      }
      await writeLog(list.slice(0, MAX));
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).end('Method Not Allowed');
  } catch (e) {
    console.error('recent api error', e);
    return res.status(500).json({ error: 'server error' });
  }
}
