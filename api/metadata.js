import { promises as fs } from 'fs';
import path from 'path';

export async function GET() {
  try {
    const res = await fetch("https://streaming06.liveboxstream.uk/proxy/ayrshire/7.html");
    let text = await res.text();

    // Remove any HTML
    text = text.replace(/<[^>]*>/g, '');

    // Find last non-numeric, meaningful part
    const parts = text.split(',');
    const rawTrack = parts.findLast(p => isNaN(p) && p.trim().length > 1);
    const decodeHtml = (s) => s.replace(/&amp;/g, '&')
                               .replace(/&lt;/g, '<')
                               .replace(/&gt;/g, '>')
                               .replace(/&quot;/g, '"')
                               .replace(/&#039;/g, "'");

    const nowPlaying = rawTrack ? decodeHtml(rawTrack.trim()) : "Unknown Track";

    // Skip if invalid
    if (!nowPlaying || nowPlaying.length < 3 || nowPlaying === "Unknown Track") {
      return new Response(JSON.stringify({ nowPlaying: "", duration: null }), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    // Attempt duration lookup from iTunes
    let duration = null;
    try {
      const itunesRes = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(nowPlaying)}&limit=1`);
      const itunesJson = await itunesRes.json();
      const track = itunesJson.results?.[0];
      if (track?.trackTimeMillis) {
        duration = Math.round(track.trackTimeMillis / 1000);
      }
    } catch (e) {
      console.warn("iTunes lookup failed:", e);
    }

    // Split artist + title
    const [artist, title] = nowPlaying.split(' - ').map(s => s.trim());

    if (artist && title) {
      const now = new Date().toISOString();
      const logEntry = {
        Artist: artist,
        Title: title,
        "Scheduled Time": now,
        "Duration (s)": duration ?? null
      };

      // Write to playout_log_rolling.json
      try {
        const logPath = path.join(process.cwd(), 'public', 'playout_log_rolling.json');
        const existingData = await fs.readFile(logPath, 'utf-8').catch(() => '[]');
        const parsed = JSON.parse(existingData);

        const fiveMinsAgo = Date.now() - 5 * 60 * 1000;
        const isRecentDuplicate = parsed.some(item =>
          item.Artist === artist &&
          item.Title === title &&
          new Date(item["Scheduled Time"]).getTime() > fiveMinsAgo
        );

        if (!isRecentDuplicate) {
          const updated = [...parsed, logEntry].slice(-100);
          await fs.writeFile(logPath, JSON.stringify(updated, null, 2));
        }
      } catch (e) {
        console.warn("Failed to update playout_log_rolling.json:", e);
      }
    }

    // Return the nowPlaying + duration
    return new Response(JSON.stringify({ nowPlaying, duration }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });

  } catch (err) {
    return new Response(JSON.stringify({
      nowPlaying: "Unable to fetch metadata"
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}
