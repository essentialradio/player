// pages/api/latestTrack.js (ALT-aware, Node runtime)
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
  const altDur = Number(process.env.ALT_DEFAULT_DURATION || 3600);
  const defDur = Number(process.env.DEFAULT_DURATION || 180);
  return String(source || '').toUpperCase() === 'ALT' ? altDur : defDur;
}

function normalizeLatest(raw) {
  const src = String(raw?.source || '').toUpperCase();
  const startIso = toIsoZ(raw?.startTime || raw?.start || new Date().toISOString());
  const duration = coerceDuration(raw?.duration, src);

  const out = {
    artist: String(raw?.artist || ''),
    title: String(raw?.title || ''),
    source: src || 'ALT',
    duration,
    startTime: startIso,
    start: startIso,
    indeterminate: false,
  };
  out.endTime = new Date(Date.parse(startIso) + duration * 1000).toISOString();
  return out;
}

function decodeEntities(s='') {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripTags(s='') {
  return s.replace(/<[^>]*>/g, '');
}

function parseAlt7html(text='') {
  const raw = decodeEntities(stripTags(String(text || ''))).replace(/\r/g, '').trim();
  const line = raw.split('\n').map(x => x.trim()).filter(Boolean).pop() || '';
  const parts = line.split(',');
  const trackField = parts.length >= 7 ? parts.slice(6).join(',').trim() : (parts.pop() || '').trim();

  let artist = '', title = '';
  if (trackField.includes(' - ')) {
    [artist, title] = trackField.split(' - ', 1).concat(trackField.split(' - ').slice(1).join(' - '));
    artist = artist.trim(); title = title.trim();
  } else if (trackField.includes(' – ')) {
    [artist, title] = trackField.split(' – ', 1).concat(trackField.split(' – ').slice(1).join(' – '));
    artist = artist.trim(); title = title.trim();
  } else {
    title = trackField.trim();
  }

  if (!artist && !title) return null;
  return { artist, title, source: 'ALT', duration: null, startTime: null, indeterminate: true };
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Upstream ${url} -> HTTP ${res.status}`);
  return await res.json();
}

async function readPrimaryLatest() {
  const url = process.env.LATEST_TRACK_URL;
  if (url) return await fetchJson(url);

  // file fallback
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
  return { artist: '', title: '', source: 'ALT', duration: null, startTime: null, indeterminate: true };
}

async function maybeFetchAltFallback(current) {
  const hasNames = Boolean(current?.artist) || Boolean(current?.title);
  if (hasNames) return current;
  const altUrl = process.env.ALT_7HTML_URL;
  if (!altUrl) return current;
  try {
    const res = await fetch(altUrl, { cache: 'no-store' });
    if (!res.ok) throw new Error(`ALT ${altUrl} -> HTTP ${res.status}`);
    const text = await res.text();
    const parsed = parseAlt7html(text);
    return parsed ? Object.assign({}, current, parsed) : current;
  } catch (e) {
    console.error('[latestTrack ALT fallback] error:', e);
    return current;
  }
}


export default async function handler(req, res) {
  try {
    const primary = await readPrimaryLatest();
    const merged = await maybeFetchAltFallback(primary);
    const obj = normalizeLatest(merged);
    res.setHeader('Cache-Control', 'no-store, must-revalidate');
    res.status(200).json(obj);
  } catch (e) {
    console.error('[latestTrack] error:', e);
    res.status(200).json(normalizeLatest({}));
  }
}
