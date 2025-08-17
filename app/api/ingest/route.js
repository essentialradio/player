// Accepts POST JSON from playout:
// { artist, title, duration?, startTime? }
// Stores under Redis key "np:latest" with a TTL to avoid stale data.

import { NextResponse } from "next/server";

const TTL_SECONDS = 15 * 60; // 15 min

const decode = (s) =>
  String(s ?? "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, " ");

const clean = (s) =>
  decode(s)
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s*[–—-]\s*/g, " – ")
    .replace(/\s+/g, " ")
    .trim();

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Cache-Control": "no-store",
  };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: cors() });
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const artist = clean(body.artist);
    const title = clean(body.title);

    if (!artist || !title) {
      return NextResponse.json(
        { error: "artist and title are required" },
        { status: 400, headers: { ...cors(), "Content-Type": "application/json" } }
      );
    }

    // Optional fields
    let duration = null;
    if (body.duration !== undefined && body.duration !== null) {
      const n = Number(body.duration);
      if (Number.isFinite(n) && n >= 0) duration = Math.round(n);
    }

    const serverNowISO = new Date().toISOString();
    const startTime = body.startTime ? String(body.startTime) : serverNowISO;
    let endTime = null;
    if (duration != null) {
      const t0 = new Date(startTime).getTime();
      if (Number.isFinite(t0)) endTime = new Date(t0 + duration * 1000).toISOString();
    }

    const record = {
      artist,
      title,
      nowPlaying: `${artist} - ${title}`,
      duration,           // seconds or null
      startTime,          // ISO if provided, else server time
      endTime,            // ISO or null
      ts: serverNowISO,   // server receipt time
      source: "ingest",
      v: 2,
    };

    const base = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!base || !token) {
      return NextResponse.json(
        { error: "Upstash env missing" },
        { status: 500, headers: { ...cors(), "Content-Type": "application/json" } }
      );
    }

    // Upstash REST SET with TTL (EX)
    const form = new URLSearchParams({
      key: "np:latest",
      value: JSON.stringify(record),
      EX: String(TTL_SECONDS),
    });

    const r = await fetch(`${base}/set`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
      cache: "no-store",
    });

    if (!r.ok) {
      return NextResponse.json(
        { error: `Upstash SET failed ${r.status}` },
        { status: 502, headers: { ...cors(), "Content-Type": "application/json" } }
      );
    }

    return NextResponse.json({ ok: true, saved: record }, {
      headers: { ...cors(), "Content-Type": "application/json" }
    });
  } catch (e) {
    return NextResponse.json(
      { error: "Server error" },
      { status: 500, headers: { ...cors(), "Content-Type": "application/json" } }
    );
  }
}
