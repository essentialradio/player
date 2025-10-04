// app/api/metadata/route.ts
import { Redis } from "@upstash/redis";

export const dynamic = "force-dynamic";

const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

function normalize(x: any = {}) {
  const start = x.startTime || x.start || null;
  const dur = Number.isFinite(x.duration) ? x.duration : Number(x.duration || 0) || null;
  const src = String(x.source || "").toUpperCase();
  const valid = Boolean(start) && Number.isFinite(dur) && dur > 0 && (src === "PLAYIT" || src === "FIXED");
  return {
    artist: x.artist || "",
    title: x.title || "",
    startTime: start,
    duration: dur,
    source: valid ? src : (src || "ALT"),
    indeterminate: !valid,
  };
}

function fallbackALT() {
  return { artist:"", title:"", startTime:null, duration:null, source:"ALT", indeterminate:true };
}

export async function GET() {
  try {
    // 1) Redis
    let track: any = null;
    try {
      const val = await redis.get("nowPlaying");
      track = typeof val === "string" ? JSON.parse(val) : (val || null);
    } catch {}

    // 2) File fallback
    const url = process.env.LATEST_JSON_URL?.trim();
    if ((!track || track?.duration == null) && url) {
      const bust = Math.floor(Date.now() / 10000);
      const r = await fetch(`${url}${url.includes("?") ? "&" : "?"}v=${bust}`, { cache: "no-store" });
      if (r.ok) return Response.json(normalize(await r.json()), { headers: { "Cache-Control": "no-store" } });
    }

    // 3) Normalize or fallback
    return Response.json(track ? normalize(track) : fallbackALT(), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json(fallbackALT(), { headers: { "Cache-Control": "no-store" } });
  }
}
