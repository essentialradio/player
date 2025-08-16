export const dynamic = 'force-dynamic';
export const revalidate = 0;

const H = () => ({ 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
const OK=(j)=>new Response(JSON.stringify(j),{status:200,headers:H()});
const BAD=(m)=>new Response(JSON.stringify({error:m}),{status:400,headers:H()});
const NOAUTH=()=>new Response(JSON.stringify({error:'Unauthorized'}),{status:401,headers:H()});

const clean = (s) => String(s ?? '')
  .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
  .replace(/&quot;/g,'"').replace(/&#039;/g,"'")
  .replace(/[\u200B-\u200D\uFEFF]/g,'').replace(/\s*[–—-]\s*/g,' – ')
  .replace(/\s+/g,' ').trim();

async function redisSetJSON(key, obj, ttlSec) {
  const url = `${process.env.UPSTASH_REDIS_REST_URL}/set`;
  const body = new URLSearchParams({ key, value: JSON.stringify(obj), EX: String(ttlSec) });
  const r = await fetch(url, { method: 'POST',
    headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}` },
    body });
  if (!r.ok) throw new Error(`Upstash set failed: ${r.status}`);
  return true;
}

export async function POST(req){
  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!process.env.INGEST_TOKEN || token !== process.env.INGEST_TOKEN) return NOAUTH();

  let b; try { b = await req.json(); } catch { return BAD('Invalid JSON'); }

  const artist = clean(b.artist), title = clean(b.title);
  if (!artist || !title) return BAD('artist and title are required');
  const duration = Number.isFinite(b.duration) ? Math.max(0, Math.round(b.duration)) : null;
  const now = new Date().toISOString();
  const startTime = b.startTime ? String(b.startTime) : now;

  const record = { artist, title, nowPlaying: `${artist} - ${title}`, duration, startTime, ts: now, source: 'ingest', v: 1 };
  await redisSetJSON('np:latest', record, 15 * 60); // 15 min TTL
  return OK({ ok: true });
}
