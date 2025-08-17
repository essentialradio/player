// /api/ingest.js
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN
});

const HDRS = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, GET, OPTIONS',
  'access-control-allow-headers': 'content-type'
};

const RECENT_KEY = 'player:recent';
const LATEST_KEY = 'player:latest';
const LASTTS_KEY = 'player:last_ingest_ts';
const RECENT_MAX = 100;
const MIN_INTERVAL_MS = 750;

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, null, 204);

  const url = new URL(req.url, `http://${req.headers.host}`);
  const token = url.searchParams.get('token') || '';
  if (!process.env.INGEST_TOKEN || token !== process.env.INGEST_TOKEN) {
    return send(res, { error: 'Unauthorized' }, 401);
  }

  // Read payload
  let payload = {};
  try {
    if (req.method === 'POST') {
      payload = await readBodySmart(req);
      if (!payload.artist && !payload.title) payload = { ...payload, ...qsToObj(url.searchParams) };
    } else if (req.method === 'GET') {
      payload = qsToObj(url.searchParams);
    } else {
      return send(res, { error: 'Method not allowed' }, 405);
    }
  } catch {
    return send(res, { error: 'Bad request' }, 400);
  }

  const item = normaliseItem(payload);
  if (!item.artist || !item.title) return send(res, { error: 'artist and title are required' }, 400);

  try {
    // Soft rate limit
    const now = Date.now();
    const lastTs = Number(await redis.get(LASTTS_KEY)) || 0;
    if (now - lastTs < MIN_INTERVAL_MS) return send(res, { ok: true, skipped: 'rate' });

    // Deduplicate consecutive
    const latest = await redis.get(LATEST_KEY);
    if (latest && latest.artist === item.artist && latest.title === item.title) {
      await redis.set(LATEST_KEY, { ...latest, ...patchNonEmpty(latest, item) });
      await redis.set(LASTTS_KEY, String(now));
      return send(res, { ok: true, skipped: 'duplicate' });
    }

    await redis.set(LATEST_KEY, item);
    await redis.lpush(RECENT_KEY, JSON.stringify(item));
    await redis.ltrim(RECENT_KEY, 0, RECENT_MAX - 1);
    await redis.set(LASTTS_KEY, String(now));
    return send(res, { ok: true });
  } catch {
    return send(res, { error: 'Storage error' }, 500);
  }
}

/* helpers */
function send(res, body, status = 200) { res.writeHead(status, HDRS); res.end(body == null ? '' : JSON.stringify(body)); }
function qsToObj(sp) { const o={}; for (const [k,v] of sp.entries()) o[k]=v; return o; }
function patchNonEmpty(oldObj, newObj) { const out={...oldObj}; if (newObj.startTime) out.startTime=newObj.startTime; if (Number.isFinite(newObj.duration)&&newObj.duration>0) out.duration=newObj.duration; if (newObj.meta!=null) out.meta=newObj.meta; return out; }
function normaliseItem(src={}) {
  const artist=String(src.artist||'').trim(); const title=String(src.title||'').trim();
  let duration=Number(src.duration); if (!Number.isFinite(duration)||duration<0) duration=0;
  const startTime=src.startTime ? toISO(String(src.startTime)) : new Date().toISOString();
  const meta = src.meta ?? null; return { artist, title, startTime, duration, meta };
}
function toISO(x){ const d=new Date(x); return isNaN(d)?new Date().toISOString():d.toISOString(); }
function readBodySmart(req){ return new Promise((resolve,reject)=>{ let raw=''; req.on('data',c=>raw+=c); req.on('end',()=>{ try{ const ct=(req.headers['content-type']||'').toLowerCase();
  if (ct.includes('application/json')) return resolve(raw?JSON.parse(raw):{});
  if (ct.includes('application/x-www-form-urlencoded')) return resolve(parseForm(raw));
  const s=raw.trim(); if (!s) return resolve({}); if (s.startsWith('{')&&s.endsWith('}')) { try { return resolve(JSON.parse(s)); } catch {} }
  if (s.includes('=')&&(s.includes('&')||s.includes('='))) return resolve(parseForm(s));
  try { return resolve(JSON.parse(s)); } catch { return resolve({}); } } catch(e){ reject(e); }});
  req.on('error', reject); });}
function parseForm(s){ const p=new URLSearchParams(s); const o={}; for (const [k,v] of p.entries()) o[k]=v; return o; }
