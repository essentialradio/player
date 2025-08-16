import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export async function GET() {
  try {
    const data = await redis.get('nowPlaying');
    if (data && data.artist && data.title) {
      return NextResponse.json({
        artist: data.artist,
        title: data.title,
        duration: data.duration || null,
      });
    }

    return NextResponse.json({ nowPlaying: 'No track info', duration: null });
  } catch (err) {
    console.error('Metadata fetch failed', err);
    return NextResponse.json({ nowPlaying: 'Error', duration: null });
  }
}
