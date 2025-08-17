// Returns the latest now-playing JSON from Upstash Redis
// Response shape your frontend expects:
// { artist, title, nowPlaying, duration?, startTime?, endTime?, source }

import { NextResponse } from "next/server";

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Cache-Control": "no-store",
    },
  });
}

export async function GET() {
  try {
    const base = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!base || !token) {
      return NextResponse.json(
        { artist: "", title: "", nowPlaying: "" },
        { status: 200, headers: hdrs() } // stay graceful if env missing
      );
    }

    const r = await fetch(`${base}/get/${encodeURIComponent("np:latest")}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });

    if (!r.ok) {
      return NextResponse.json(
        { artist: "", title: "", nowPlaying: "" },
        { status: 200, headers: hdrs() }
      );
    }

    const j = await r.json().catch(() => null);
    const rec = j?.result ? JSON.parse(j.result) : null;

    if (rec?.artist || rec?.title) {
      const artist = (rec.artist ?? "").trim();
      const title  = (rec.title ?? "").trim();
      const nowPlaying = artist && title ? `${artist} - ${title}` : (rec.nowPlaying ?? "");
      return NextResponse.json(
        {
          artist,
          title,
          nowPlaying,
          duration: rec.duration ?? null,
          startTime: rec.startTime ?? rec.ts ?? null,
          endTime: rec.endTime ?? null,
          source: rec.source ?? "ingest",
        },
        { headers: hdrs() }
      );
    }

    // empty / not found
    return NextResponse.json(
      { artist: "", title: "", nowPlaying: "" },
      { headers: hdrs() }
    );
  } catch {
    return NextResponse.json(
      { artist: "", title: "", nowPlaying: "" },
      { status: 200, headers: hdrs() }
    );
  }
}

function hdrs() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
    "Content-Type": "application/json",
  };
}
