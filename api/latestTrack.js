// pages/api/latestTrack.js (Node runtime)
export const config = { runtime: 'nodejs' };


// ---- helpers ----
function toIsoZ(input) {
  if (!input) return new Date().toISOString();
  const s = String(input);
  if (s.endsWith('Z')) return s;
  const d = new Date(s);
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

function coerceDuration(rawDuration, source) {
  const n = Number(rawDuration);
  if (Number.isFinite(n) && n > 0) return Math.floor(n);
  return String(source || '').toUpperCase() === 'ALT' ? (Number(process.env.ALT_DEFAULT_DURATION || 3600)) : (Number(process.env.DEFAULT_DURATION || 180));
}

function normalizeLatest(raw) {
  const src = String(raw?.source || '').toUpperCase();
  const startIso = toIsoZ(raw?.startTime || raw?.start || new Date().toISOString());
  const duration = coerceDuration(raw?.duration, src);

  const out = {
    artist: String(raw?.artist || ''),
    title: String(raw?.title || ''),
    source: src,
    duration,
    startTime: startIso,
    start: startIso,
    indeterminate: false,
  };
  out.endTime = new Date(Date.parse(startIso) + duration * 1000).toISOString();
  return out;
}

async function readLatestJson() {
  // 1) Try external URL (recommended for dynamic content)
  const url = process.env.LATEST_TRACK_URL;
  if (url) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Upstream ${url} -> HTTP ${res.status}`);
    return await res.json();
  }

  // 2) Try reading from project files (bundled at build time)
  const path = require('path');
  const fs = require('fs');
  const candidates = [
    path.join(process.cwd(), 'public', 'latestTrack.json'),
    path.join(process.cwd(), 'latestTrack.json'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
      return JSON.parse(raw);
    }
  }

  // 3) Last resort: safe placeholder
  return {
    artist: '',
    title: '',
    source: 'ALT',
    duration: null,
    startTime: new Date().toISOString(),
    indeterminate: true,
  };
}


export default async function handler(req, res) {
  try {
    const raw = await readLatestJson();
    const obj = normalizeLatest(raw);

    res.setHeader('Cache-Control', 'no-store, must-revalidate');
    res.status(200).json(obj);
  } catch (e) {
    console.error('[latestTrack] error:', e);
    res.status(200).json(normalizeLatest({}));
  }
}
