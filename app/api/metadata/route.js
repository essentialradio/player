import { promises as fs } from 'fs';
import path from 'path';

export async function GET() {
  try {
    // 1) Pull raw metadata from your stream status page
    const res = await fetch("https://streaming06.liveboxstream.uk/proxy/ayrshire/7.html", { cache: "no-store" });
    let text = await res.text();

    // Strip HTML
    text = text.replace(/<[^>]*>/g, '');

    // Livebox puts lots of comma-separated cells; pick last meaningful non-numeric cell safely
    const cells = text.split(',');
    let rawTrack = "";
    for (let i = cells.length - 1; i >= 0; i--) {
      const c = (cells[i] || '').trim();
      if (c && isNaN(c) && c.length > 1) { rawTrack = c; break; }
    }

    const decodeHtml = (s) => String(s ?? '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'");

    const clean = (s) => String(s ?? '')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/\s+/g, ' ')
      .replace(/\s*[–—-]\s*/g, ' – ') // normalise dashes
      .trim();

    const rawCombined = clean(decodeHtml(rawTrack));

    // If we truly have nothing useful, bail early (empty payload)
    if (!rawCombined || rawCombined.length < 3 || rawCombined === "Unknown Track") {
      return new Response(JSON.stringify({ artist:"", title:"", nowPlaying:"", duration:null, startTime:null }), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-store'
        }
      });
    }

    // 2) Parse robustly (dash -> "by" -> colon -> very-conservative single comma)
    function parseCombined(s) {
      const line = clean(s);
      if (!line) return { artist:"", title:"" };

      // Artist – Title (accept -, –, —)
      let m = line.match(/^(.*?)\s+[–—-]\s+(.*)$/);
      if (m) return { artist: clean(m[1]), title: clean(m[2]) };

      // Title by Artist
      m = line.match(/^(.*?)\s+by\s+(.*)$/i);
      if (m) return { artist: clean(m[2]), title: clean(m[1]) };

      // Artist: Title
      m = line.match(/^(.*?)\s*:\s*(.*)$/);
      if (m) return { artist: clean(m[1]), title: clean(m[2]) };

      // Very conservative single-comma "Artist, Title"
      const count = (line.match(/,/g) || []).length;
      if (count === 1) {
        const i = line.indexOf(',');
        const left  = clean(line.slice(0, i));
        const right = clean(line.slice(i + 1));
        const looksLikeArtist = left && left.split(/\s+/).length <= 6 && !/[!?]$/.test(left);
        if (looksLikeArtist && right) return { artist:left, title:right };
      }

      // Give up guessing: keep all as title (preserves commas in titles)
      return { artist:"", title: line };
    }

    // Prefer explicit fields if Livebox ever starts providing them (future-proof)
    let artist = ""; let title = "";
    // (Your feed doesn’t provide separate fields today, so we default to parsing:)
    ({ artist, title } = parseCombined(rawCombined));

    // 3) Optional enrichment from your canonical latestTrack.json
    //    If the title matches and latest.artist looks richer (contains parsed artist or is clearly longer),
    //    upgrade the artist credit to include collaborators (e.g., "Jax Jones, Calum Scott").
    let duration = null;
    let startTime = null;
    try {
      const latestRes = await fetch("https://essentialradio.github.io/player/latestTrack.json?_=" + Date.now(), { cache: "no-store" });
      if (latestRes.ok) {
        const latest = await latestRes.json();
        const la = clean(latest?.artist);
        const lt = clean(latest?.title);
        if (lt && title && lt.toLowerCase() === title.toLowerCase() && la) {
          const parsed = artist.toLowerCase();
          const richer = !artist || la.toLowerCase().includes(parsed) || la.length > artist.length + 2;
          if (richer) artist = la;
        }
        if (latest?.duration) duration = Number(latest.duration) || null;
        if (latest?.startTime) startTime = latest.startTime;
      }
    } catch { /* ignore enrichment failure */ }

    // 4) Fallback duration via iTunes if not enriched above
    if (!duration) {
      try {
        const itunesRes = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(`${artist} ${title}` || rawCombined)}&limit=1`, { cache: "no-store" });
        const itunesJson = await itunesRes.json();
        const track = itunesJson.results?.[0];
        if (track?.trackTimeMillis) duration = Math.round(track.trackTimeMillis / 1000);
      } catch (e) {
        console.warn("iTunes lookup failed:", e);
      }
    }

    // 5) Write structured log if we have both pieces
    if (artist && title) {
      const nowISO = new Date().toISOString();
      const logEntry = {
        Artist: artist,
        Title: title,
        "Scheduled Time": nowISO,
        "Duration (s)": duration ?? null
      };
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

    // 6) Compose final payload (structured first)
    const payload = {
      artist,
      title,
      nowPlaying: artist && title ? `${artist} - ${title}` : (title || artist || rawCombined),
      duration,
      startTime
    };

    return new Response(JSON.stringify(payload), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store'
      }
    });

  } catch (err) {
    return new Response(JSON.stringify({
      artist: "",
      title: "",
      nowPlaying: "",
      duration: null,
      startTime: null
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store'
      }
    });
  }
}
