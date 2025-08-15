import { promises as fs } from 'fs';
import path from 'path';

// Clean helpers
const decodeHtml = (s) => String(s ?? '')
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#039;/g, "'");

const clean = (s) => String(s ?? '')
  .replace(/[\u200B-\u200D\uFEFF]/g, '')
  .replace(/\s+/g, ' ')
  .replace(/\s*[–—-]\s*/g, ' – ') // normalise dashes to EN dash
  .trim();

const looksLikeTrack = (s) => {
  const line = String(s || '').trim();
  if (!line) return false;
  if (/(.*?)\s+[–—-]\s+(.*)/.test(line)) return true;   // Artist – Title
  if (/(.*?)\s+by\s+(.*)/i.test(line)) return true;     // Title by Artist
  if (/(.*?)\s*:\s*(.*)/.test(line)) return true;       // Artist: Title
  return false;
};

function parseCombined(s) {
  const line = clean(s);
  if (!line) return { artist: '', title: '' };

  // 1) Artist – Title (accept -, –, —)
  let m = line.match(/^(.*?)\s+[–—-]\s+(.*)$/);
  if (m) return { artist: clean(m[1]), title: clean(m[2]) };

  // 2) Title by Artist
  m = line.match(/^(.*?)\s+by\s+(.*)$/i);
  if (m) return { artist: clean(m[2]), title: clean(m[1]) };

  // 3) Artist: Title
  m = line.match(/^(.*?)\s*:\s*(.*)$/);
  if (m) return { artist: clean(m[1]), title: clean(m[2]) };

  // 4) VERY conservative single-comma "Artist, Title"
  const count = (line.match(/,/g) || []).length;
  if (count === 1) {
    const i = line.indexOf(',');
    const left  = clean(line.slice(0, i));
    const right = clean(line.slice(i + 1));
    const looksLikeArtistName = left && left.split(/\s+/).length <= 6 && !/[!?]$/.test(left);
    if (looksLikeArtistName && right) return { artist: left, title: right };
  }

  // 5) Give up guessing: keep full string as title (preserves commas)
  return { artist: '', title: line };
}

function combineNowPlaying(artist, title) {
  if (artist && title) return `${artist} - ${title}`;
  return title || artist || '';
}

export async function GET() {
  try {
    // 1) Pull raw metadata from Livebox status page
    const res = await fetch('https://streaming06.liveboxstream.uk/proxy/ayrshire/7.html', { cache: 'no-store' });
    let text = await res.text();

    // Strip HTML
    text = text.replace(/<[^>]*>/g, '');

    // 2) Livebox outputs comma-separated columns. Titles can contain commas.
    // Walk from the end and JOIN trailing cells until it *looks like* a track line.
    const cells = text.split(',');
    let rawTrack = '';

    for (let i = cells.length - 1; i >= 0; i--) {
      const joined = cells.slice(i).join(',').trim();
      if (looksLikeTrack(joined)) { rawTrack = joined; break; }
    }

    // Fallbacks if nothing matched
    if (!rawTrack) {
      for (let i = cells.length - 1; i >= 0; i--) {
        const c = (cells[i] || '').trim();
        if (c && isNaN(c) && c.length > 1) {
          rawTrack = (i < cells.length - 1) ? (c + ',' + cells.slice(i + 1).join(',')).trim() : c;
          break;
        }
      }
    }
    if (!rawTrack) rawTrack = text.trim();

    const rawCombined = clean(decodeHtml(rawTrack));

    // 3) Parse combined into fields
    let { artist, title } = parseCombined(rawCombined);

    // 4) Enrich from canonical latestTrack.json (adds collaborators; gets timing)
    let duration = null;
    let startTime = null;
    try {
      const latestRes = await fetch('https://essentialradio.github.io/player/latestTrack.json?_=' + Date.now(), { cache: 'no-store' });
      if (latestRes.ok) {
        const latest = await latestRes.json();
        const la = clean(latest?.artist);
        const lt = clean(latest?.title);
        if (lt && title && lt.toLowerCase() === title.toLowerCase() && la) {
          const parsed = (artist || '').toLowerCase();
          const richer = !artist || la.toLowerCase().includes(parsed) || la.length > artist.length + 2;
          if (richer) artist = la;
        }
        if (latest?.duration) duration = Number(latest.duration) || null;
        if (latest?.startTime) startTime = latest.startTime;
      }
    } catch { /* ignore enrichment failure */ }

    // 5) Optional iTunes duration fallback (if you want to keep it)
    if (!duration && artist && title) {
      try {
        const itunesRes = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(`${artist} ${title}`)}&limit=1`, { cache: 'no-store' });
        const itunesJson = await itunesRes.json();
        const track = itunesJson.results?.[0];
        if (track?.trackTimeMillis) duration = Math.round(track.trackTimeMillis / 1000);
      } catch { /* ignore iTunes failure */ }
    }

    // 6) Append to rolling log (avoid dupes within 5 minutes)
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
      } catch { /* ignore log failure */ }
    }

    // 7) Final payload
    const payload = {
      artist,
      title,
      nowPlaying: combineNowPlaying(artist, title) || rawCombined,
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
      artist: '',
      title: '',
      nowPlaying: '',
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
