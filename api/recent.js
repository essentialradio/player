// api/recent.js
// Unified "recently played" API.
// GET: Pulls from playout_log_rolling.json, normalises ALT/FIXED rows, returns top 100.
// POST: Unchanged — keeps your existing write-to-blob behaviour.

import { put, get } from '@vercel/blob';

const BLOB_PATH = 'recent.json';
const MAX = 500;

// --- helpers ---
function toNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function deriveISO(row) {
  // Prefer backend-provided ISO if present
  if (row['Start ISO']) return row['Start ISO'];

  // Else build it from Hour (ISO hour) + Scheduled Time (HH:MM)
  if (row.Hour && row['Scheduled Time']) {
    const base = new Date(row.Hour); // ex: 2025-09-07T16:00:00Z
    const [hh, mm] = String(row['Scheduled Time']).split(':').map(Number);
    if (Number.isFinite(hh) && Number.isFinite(mm)) {
      // Hour is a Zulu (UTC) ISO. Set UTC hours/mins to get a precise instant.
      base.setUTCHours(hh, mm, 0, 0);
      return base.toISOString();
    }
  }
  return null;
}

function normaliseRow(r) {
  const artist = r.Artist || '';
  const title = r.Title || '';
  const source = r.Source || 'PLAYIT';

  // Duration fallback to 180s (matches your Python normaliser)
  const durSec =
    toNumber(r['Full Duration (s)']) ||
    toNumber(r['Duration (s)']) ||
    180;

  const iso = deriveISO(r);
  const startMs = iso ? Date.parse(iso) : null;
  const endMs = startMs ? startMs + durSec * 1000 : null;

  return {
    key: startMs != null ? `${artist}||${title}||${startMs}` : `${artist}||${title}||0`,
    artist,
    title,
    startMs,
    endMs,
    duration: durSec,
    endedAt: endMs,
    source
  };
}

async function fetchRolling(req) {
  // Build absolute URL to playout_log_rolling.json on this deployment
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const base = `${proto}://${host}`;
  const url = `${base}/playout_log_rolling.json?ts=${Date.now()}`;

  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`rolling fetch ${res.status}`);
  return res.json();
}

// --- existing blob helpers (kept so POST keeps working) ---
async function readBlobLog() {
  try {
    const info = await get(BLOB_PATH); // throws if not found
    const res = await fetch(info.url, { cache: 'no-store' });
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return []; // first run: no blob yet
  }
}

async function writeBlobLog(list) {
  await put(BLOB_PATH, JSON.stringify(list), {
    contentType: 'application/json',
    access: 'public',
  });
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      // Primary source of truth: rolling log (includes ALT/FIXED)
      const rolling = await fetchRolling(req);                    // ← reads playout_log_rolling.json
      const normalised = rolling.map(normaliseRow)
        // keep only rows with a usable timestamp
        .filter(r => r.startMs != null)
        // newest first
        .sort((a, b) => b.startMs - a.startMs);

      // Top 100 only
      res.setHeader('Cache-Control', 'no-store, no-cache, max-age=0, s-maxage=0, must-revalidate');
      return res.status(200).json(normalised.slice(0, 100));
    }

    if (req.method === 'POST') {
      // Keep your original POST behaviour (write to recent.json blob)
      const b = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const { artist, title, startMs, endMs, duration, endedAt } = b || {};
      if (!artist || !title || !startMs || !endMs) {
        return res.status(400).json({ error: 'invalid payload' });
      }
      const key = `${artist}||${title}||${startMs}`;
      const list = await readBlobLog();
      if (!list.length || list[0].key !== key) {
        list.unshift({ key, artist, title, startMs, endMs, duration, endedAt });
      }
      await writeBlobLog(list.slice(0, MAX));
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).end('Method Not Allowed');
  } catch (e) {
    console.error('recent api error', e);
    // Fail-soft: return an empty list rather than a 500
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json([]);
  }
}
