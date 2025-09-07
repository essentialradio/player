// api/recent.js
// Unified "recently played" API.
// GET: Pulls from playout_log_rolling.json (root or /public), normalises ALT/FIXED rows, returns top 100.
// POST: Preserved — writes to recent.json blob for any existing producers.

import { put, get } from '@vercel/blob';

const BLOB_PATH = 'recent.json';
const MAX = 500;

/* ---------- helpers ---------- */
function toNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// Parse Hour which might be ISO or "YYYY-MM-DD HH(:MM)?"
function parseHourToDate(hourStr) {
  if (!hourStr) return null;

  // Try native first (ISO, with Z)
  const d1 = new Date(hourStr);
  if (!isNaN(d1)) return d1;

  // Try "YYYY-MM-DD HH:MM" or "YYYY-MM-DD HH"
  const m = String(hourStr).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2})(?::(\d{2}))?$/);
  if (m) {
    const [, Y, M, D, hh, mm = '00'] = m;
    const d = new Date(Date.UTC(+Y, +M - 1, +D, +hh, +mm, 0, 0)); // treat as UTC
    if (!isNaN(d)) return d;
  }

  return null;
}

function deriveISO(row) {
  // Prefer backend-provided ISO if present
  if (row['Start ISO']) return row['Start ISO'];

  // Else build from Hour + Scheduled Time
  if (row.Hour && row['Scheduled Time']) {
    const base = parseHourToDate(row.Hour);
    if (base) {
      const parts = String(row['Scheduled Time']).split(':').map(Number);
      const hh = Number.isFinite(parts[0]) ? parts[0] : 0;
      const mm = Number.isFinite(parts[1]) ? parts[1] : 0;
      base.setUTCHours(hh, mm, 0, 0);
      return base.toISOString();
    }
  }
  return null;
}

function normaliseRow(r) {
  const artist = r.Artist || '';
  const title  = r.Title  || '';
  const source = r.Source || 'PLAYIT';

  // Match Python normaliser default of 180s
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

async function fetchJSON(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  const text = await res.text(); // be tolerant if server serves text
  try { return JSON.parse(text); } catch { throw new Error('Invalid JSON at ' + url); }
}

// Works if your app serves from repo root OR from /public
async function fetchRollingJSON(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host  = req.headers['x-forwarded-host'] || req.headers.host;
  const base  = `${proto}://${host}`;
  const stamp = Date.now();

  const tries = [
    `${base}/playout_log_rolling.json?ts=${stamp}`,        // repo root
    `${base}/public/playout_log_rolling.json?ts=${stamp}`, // /public fallback
  ];

  let lastErr;
  for (const u of tries) {
    try { return await fetchJSON(u); }
    catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('rolling fetch failed');
}

/* ---------- existing blob helpers (POST preserved) ---------- */
async function readBlobLog() {
  try {
    const info = await get(BLOB_PATH); // throws if not found
    const res  = await fetch(info.url, { cache: 'no-store' });
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

async function writeBlobLog(list) {
  await put(BLOB_PATH, JSON.stringify(list), {
    contentType: 'application/json',
    access: 'public',
  });
}

/* ---------- handler ---------- */
export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      let rows = [];
      try {
        const rolling = await fetchRollingJSON(req);      // primary (includes ALT/FIXED)
        rows = rolling.map(normaliseRow).filter(r => r.startMs != null);
      } catch (e) {
        console.warn('recent GET: rolling fetch failed, falling back to blob:', e?.message || e);
        // fallback: existing blob, if you still post to it
        const blobList = await readBlobLog();
        rows = blobList.map(x => ({
          key: x.key,
          artist: x.artist,
          title: x.title,
          startMs: toNumber(x.startMs, null),
          endMs:   toNumber(x.endMs,   null),
          duration: toNumber(x.duration, 0),
          endedAt:  toNumber(x.endedAt,  null),
          source: 'PLAYIT'
        })).filter(r => r.startMs != null);
      }

      rows.sort((a, b) => b.startMs - a.startMs);
      res.setHeader('Cache-Control', 'no-store, no-cache, max-age=0, s-maxage=0, must-revalidate');
      return res.status(200).json(rows.slice(0, 100));
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
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json([]);
  }
}
