// pages/api/latestTrack.js (ULTRA-SAFE, Node runtime)
export const config = { runtime: 'nodejs' };

function toIsoZ(input) {
  try {
    if (!input) return new Date().toISOString();
    const s = String(input);
    if (s.endsWith('Z')) return s;
    const d = new Date(s);
    return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  } catch { return new Date().toISOString(); }
}

function coerceDuration(rawDuration, source) {
  const n = Number(rawDuration);
  if (Number.isFinite(n) && n > 0) return Math.floor(n);
  const altDur = Number(process.env.ALT_DEFAULT_DURATION || 3600);
  const defDur = Number(process.env.DEFAULT_DURATION || 180);
  return String(source || '').toUpperCase() === 'ALT' ? altDur : defDur;
}

function normalizeLatest(raw) {
  try {
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
  } catch {
    return { artist:'', title:'', source:'ALT', duration:3600,
      startTime: new Date().toISOString(), start: new Date().toISOString(),
      endTime: new Date(Date.now()+3600e3).toISOString(), indeterminate:false };
  }
}

function decodeEntities(s='') {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripTags(s='') { return s.replace(/<[^>]*>/g, ''); }

function parseAlt7html(text='') {
  try {
    const raw = decodeEntities(stripTags(String(text || ''))).replace(/\r/g, '').trim();
    const line = raw.split('\n').map(x => x.trim()).filter(Boolean).pop() || '';
    const parts = line.split(',');
    const trackField = parts.length >= 7 ? parts.slice(6).join(',').trim() : (parts.pop() || '').trim();
    let artist = '', title = '';
    const sep1 = trackField.indexOf(' - ');
    const sep2 = trackField.indexOf(' – ');
    const idx = sep1 >= 0 ? sep1 : sep2;
    if (idx >= 0) {
      artist = trackField.slice(0, idx).trim();
      title  = trackField.slice(idx + 3).trim();
    } else {
      title = trackField.trim();
    }
    if (!artist && !title) return null;
    return { artist, title, source: 'ALT', duration: null, startTime: null, indeterminate: true };
  } catch { return null; }
}

async function fetchText(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

async function readPrimaryLatest() {
  // 1) External JSON
  const url = process.env.LATEST_TRACK_URL;
  if (url) {
    try { return await fetchJson(url); }
    catch { /* fall through */ }
  }

  // 2) Bundled file
  try {
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
  } catch { /* ignore */ }

  // 3) Placeholder
  return { artist:'', title:'', source:'', duration:null, startTime:null, indeterminate:true };
}

async function maybeFetchAlt(current) {
  try {
    const src = String(current?.source || '').toUpperCase();
    const hasNames = Boolean(current?.artist) || Boolean(current?.title);
    // Only augment when current is ALT or names are blank
    if (src !== 'ALT' && hasNames) return current;
    const altUrl = process.env.ALT_7HTML_URL;
    if (!altUrl) return current;
    const text = await fetchText(altUrl);
    const parsed = parseAlt7html(text);
    return parsed ? { ...current, ...parsed, source:'ALT' } : current;
  } catch { return current; }
}

export default async function handler(req, res) {
  try {
    let primary = await readPrimaryLatest();

    // Guard: if someone misconfigured LATEST_TRACK_URL to point at 7.html (HTML),
    // try to parse it rather than crash.
    if (!primary || (typeof primary === 'string') || (primary && primary.html)) {
      try {
        const txt = typeof primary === 'string' ? primary : '';
        const parsed = parseAlt7html(txt);
        if (parsed) primary = parsed;
      } catch { /* ignore */ }
    }

    const merged = await maybeFetchAlt(primary);
    const obj = normalizeLatest(merged);
    res.setHeader('Cache-Control', 'no-store, must-revalidate');
    res.status(200).json(obj);
  } catch (e) {
    console.error('[latestTrack] fatal:', e);
    res.status(200).json(normalizeLatest({}));
  }
}
