// pages/api/recent.js
export const config = { runtime: "edge" }; // fast + global

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store, max-age=0, s-maxage=0, must-revalidate",
  "content-type": "application/json; charset=utf-8",
};

function normaliseRow(row = {}) {
  const artist = row.Artist ?? row.artist ?? "";
  const title  = row.Title  ?? row.title  ?? "";
  const start  = row["Start ISO"] ?? row.startTime ?? row.startedAt ?? null;
  const durS   = row["Duration (s)"] ?? row.duration ?? null;
  const duration = durS == null || durS === "" ? null : Number(durS);
  return { artist, title, startTime: start, duration, source: row.Source ?? row.source ?? null };
}

export default async function handler(req) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: HEADERS });

  const RECENT_URL = process.env.RECENT_URL; // public URL to your rolling JSON (Dropbox/S3/etc.)
  if (!RECENT_URL) {
    return new Response(JSON.stringify({ error: "RECENT_URL not set" }), { status: 500, headers: HEADERS });
  }

  try {
    const r = await fetch(RECENT_URL, { cache: "no-store" });
    if (!r.ok) return new Response(JSON.stringify({ error: "Upstream failed", status: r.status }), { status: 502, headers: HEADERS });
    const data = await r.json().catch(() => []);
    const list = Array.isArray(data) ? data : [];
    const recent = list.slice(-20).map(normaliseRow).reverse(); // last 20, newest first
    return new Response(JSON.stringify(recent), { status: 200, headers: HEADERS });
  } catch (e) {
    return new Response(JSON.stringify({ error: "Fetch error", detail: String(e) }), { status: 500, headers: HEADERS });
  }
}
