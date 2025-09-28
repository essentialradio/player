// pages/api/recent.js
export const config = { runtime: "edge" }; // fast + global

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store, max-age=0, s-maxage=0, must-revalidate",
  "content-type": "application/json; charset=utf-8",
};

// Your Dropbox rolling log (direct-download form)
const DEFAULT_RECENT_URL =
  "https://dl.dropboxusercontent.com/scl/fi/26wndol1tpgk2k50np6mb/playout_log_rolling.json?rlkey=q5nwa49bgk6wecsr63kawssu5&dl=1";

const normaliseRow = (row = {}) => {
  const artist = row.Artist ?? row.artist ?? "";
  const title  = row.Title  ?? row.title  ?? "";
  const start  = row["Start ISO"] ?? row.startTime ?? row.startedAt ?? null;
  const durS   = row["Duration (s)"] ?? row.duration ?? null;
  const duration =
    durS == null || durS === "" || Number.isNaN(Number(durS)) ? null : Number(durS);

  return {
    artist,
    title,
    startTime: start,               // ISO string
    duration,                       // seconds or null
    source: row.Source ?? row.source ?? null,
  };
};

export default async function handler(req) {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: HEADERS });
  }

  const urlFromEnv   = process.env.RECENT_URL; // optional Vercel env override
  const urlFromQuery = new URL(req.url).searchParams.get("src"); // optional ?src= override
  const RECENT_URL   = urlFromEnv || urlFromQuery || DEFAULT_RECENT_URL;

  // limit (newest first), defaults to 20, capped 1..100
  const sp = new URL(req.url).searchParams;
  const limitQ = Number(sp.get("limit"));
  const LIMIT = Number.isFinite(limitQ) ? Math.max(1, Math.min(100, limitQ)) : 20;

  try {
    const r = await fetch(RECENT_URL, { cache: "no-store" });
    if (!r.ok) {
      return new Response(
        JSON.stringify({ error: "Upstream failed", status: r.status }),
        { status: 502, headers: HEADERS }
      );
    }

    const data = await r.json().catch(() => []);
    const list = Array.isArray(data) ? data : [];

    // Take the last N entries and return newest-first
    const recent = list.slice(-LIMIT).map(normaliseRow).reverse();

    return new Response(JSON.stringify(recent), { status: 200, headers: HEADERS });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: "Fetch error", detail: String(e) }),
      { status: 500, headers: HEADERS }
    );
  }
}
