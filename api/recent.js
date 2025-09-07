// api/recent.js
// Unified "recently played" API with robust fallbacks and debug mode.
// GET: Pulls from playout_log_rolling.json (root or /public), normalises rows, returns newest first.
// POST: Preserved — writes to recent.json blob for any existing producers.

import { put, get } from '@vercel/blob';

const BLOB_PATH = 'recent.json';
const MAX = 500;

// OPTIONAL: external fallback (uncomment if you still publish to GitHub Pages)
// const GITHUB_FALLBACK = 'https://essentialradio.github.io/player/playout_log_rolling.json';

/* ----------------- helpers ----------------- */
function toNumber(v, fallback = 0) {
  const n = typeof v === 'string' ? Number.parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// Parse Hour which might be ISO or "YYYY-MM-DD HH(:MM)?"
function parseHourToDate(hourStr) {
  if (!hourStr) return null;
  const d1 = new Date(hourStr);                // handles ISO w/ Z
  if (!Number.isNaN(d1)) return d1;

  const m = String(hourStr).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2})(?::(\d{2}))?$/);
  if (m) {
    const [, Y, M, D, hh, mm = '00'] = m;
    const d = new Date(Date.UTC(+Y, +M - 1, +D, +hh, +mm, 0, 0)); // treat as UTC hour
    if (!Number.isNaN(d)) return d;
  }
  return null;
}

function deriveISO(row) {
  if (row['Start ISO']) return row['Start ISO']; // provided by Python for ALT/FIXED
  if (row.Hour && row['Scheduled Time']) {
    const base = parseHourToDate(row.Hour);
    if (base) {
      const [hh, mm] = String(row['Scheduled Time']).split(':').map(Number);
      base.setUTCHours(Number.isFinite(hh) ? hh : 0, Number.isFinite(mm) ? mm : 0, 0, 0);
      return base.toISOString();
    }
  }
  return null;
}

function normaliseRow(r) {
  const artist = r.Artist || '';
  const title  = r.Title  || '';
  const source = r.Source || 'PLAYIT';

  const durSec =
    toNumber(r['Full Duration (s)']) ||
    toNumber(r['Duration (s)']) ||
    180;

  const iso = deriveISO(r);
  const startMs = iso ? Date.parse(iso) : null;
  const endMs   = startMs ? startMs + durSec * 1000 : null;

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

async function fetchText(url) {
  const res = await fetch(url, { cache: 'no-store' });
  const status = res.status;
  const ok = res.ok;
  const text = ok ? await res.text() : '';
  return { ok, status, text };
}

async function tryLocations(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host  = req.headers['x-forwarded-host'] || req.headers.host;
  const base  = `${proto}://${host}`;
  const ts    = Date.now();

  const urls = [
    `${base}/playout_log_rolling.json?ts=${ts}`,        // repo root
    `${base}/public/playout_log_rolling.json?ts=${ts}`, // /public fallback
    // GITHUB_FALLBACK && `${GITHUB_FALLBACK}?ts=${ts}`
  ].filter(Boolean);

  const attempts = [];
  for (const u of urls) {
    try {
      const { ok, status, text } = await fetchText(u);
      attempts.push({ url: u, status, ok });
      if (!ok) continue;
      try {
        const json = JSON.parse(text);
        if (Array.isArray(json)) return { json, attempts, used: u };
        // if server ever wraps, ignore
      } catch {
        // not JSON, try next
      }
    } catch (e) {
      attempts.push({ url: u, status: 'FETCH_ERR', ok: false, error: String(e) });
    }
  }
  const err = new Error('No rolling JSON found at any location');
  err.attempts = attempts;
  throw err;
}

/* -------- existing blob helpers (POST preserved) -------- */
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

/* ----------------- handler ----------------- */
export default async function handler(req, res) {
  const debug = req.query?.debug === '1' || req.query?.debug === 'true';

  try {
    if (req.method === 'GET') {
      let rows = [];
      let attempts = [];
      let usedUrl = null;

      try {
        const { json, attempts: atts, used } = await tryLocations(req); // primary: rolling JSON
        attempts = atts;
        usedUrl = used;
        rows = json.map(normaliseRow).filter(r => r.startMs != null);
      } catch (e) {
        // fallback to blob if you still POST to this API
        attempts = e?.attempts || attempts;
        const blob = await readBlobLog();
        rows = blob.map(x => ({
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
      const out = rows.slice(0, 100);

      res.setHeader('Cache-Control', 'no-store, no-cache, max-age=0, s-maxage=0, must-revalidate');
      if (debug) {
        const counts = out.reduce((acc, r) => {
          acc[r.source] = (acc[r.source] || 0) + 1;
          return acc;
        }, {});
        return res.status(200).json({ items: out, debug: { usedUrl, attempts, counts } });
      }
      return res.status(200).json(out);
    }

    if (req.method === 'POST') {
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
    return res.status(200).json(debug ? { items: [], debug: { error: String(e), attempts: e?.attempts || [] } } : []);
  }
}
