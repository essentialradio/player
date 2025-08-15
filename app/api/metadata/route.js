import { promises as fs } from 'fs';
import path from 'path';

// Prefer latestTrack.json first, fallback to Livebox 7.html with CSV glue

// --- helpers ---
const decodeHtml = (s) => String(s ?? '')
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#039;/g, "'")
  .replace(/&nbsp;/g, ' ');

const clean = (s) => String(s ?? '')
  .replace(/[\u200B-\u200D\uFEFF]/g, '')
  .replace(/\s+/g, ' ')
  .replace(/\s*[–—-]\s*/g, ' – ') // normalise dash variants
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

  // 1) Artist – Title (any dash)
  let m = line.match(/^(.*?)\s+[–—-]\s+(.*)$/);
  if (m) return { artist: clean(m[1]), title: clean(m[2]) };

  // 2) Title by Artist
  m = line.match(/^(.*?)\s+by\s+(.*)$/i);
  if (m) return { artist: clean(m[2]), title: clean(m[1]) };

  // 3) Artist: Title
  m = line.match(/^(.*?)\s*:\s*(.*)$/);
  if (m) return { artist: clean(m[1]), title: clean(m[2]) };

  // 4) VERY conservative single-comma Artist, Title
  const count = (line.match(/,/g) || []).length;
  if (count === 1) {
    const i = line.indexOf(',');
    const left  = clean(line.slice(0, i));
    const right = clean(line.slice(i + 1));
    const looksLikeArtistName = left && left.split(/\s+/).length <= 6 && !/[!?]$/.test(left);
    if (looksLikeArtistName && right) return { artist: left, title: right };
  }

  // 5) Give up guessing: keep full as title
  return { artist: '', title: line };
}

const isNameFragment = (s) => {
  const t = String(s || '').trim();
  if (!t) return false;
  if (/[0-9]{3,}/.test(t)) return false;
  if (t.length > 50) return false;
  if (!/[A-Za-z]/.test(t)) return false;
  return /^[A-Za-z][A-Za-z '&.-]*$/.test(t);
};

function combineNowPlaying(artist, title) {
  if (artist && title) return `${artist} - ${title}`;
  return title || artist || '';
}

export const dynamic = 'force-dynamic';

export async function GET(req) {
  try {
    const nowISO = new Date().toISOString();
    let artist = '', title = '', duration = null, startTime = null;
    let rawCombined = '';
    let used = 'latestTrack';

    // --- 0) Primary: latestTrack.json ---
    try {
      const latestRes = await fetch('https://essentialradio.github.io/player/latestTrack.json?_=' + Date.now(), { cache: 'no-store' });
      if (latestRes.ok) {
        const latest = await latestRes.json();
        const la = clean(latest?.artist);
        const lt = clean(latest?.title);
        if (la && lt) {
          artist = la;
          title  = lt;
          rawCombined = `${la} - ${lt}`;
          if (latest?.duration) duration = Number(latest.duration) || null;
          if (latest?.startTime) startTime = latest.startTime;
        } else {
          used = 'livebox-fallback';
        }
      } else {
        used = 'livebox-fallback';
      }
    } catch {
      used = 'livebox-fallback';
    }

    // --- 1) Fallback: Livebox scrape with CSV glue ---
    if (!artist || !title) {
      const res = await fetch('https://streaming06.liveboxstream.uk/proxy/ayrshire/7.html', { cache: 'no-store' });
      let text = await res.text();

      // Strip HTML
      text = text.replace(/<[^>]*>/g, '');

      const cells = text.split(',');
      let startIdx = -1;
      let joined = '';
      // Rightmost tail that looks like a track
      for (let i = cells.length - 1; i >= 0; i--) {
        const candidate = cells.slice(i).join(',').trim();
        if (looksLikeTrack(candidate)) { startIdx = i; joined = candidate; break; }
      }
      if (startIdx === -1) {
        for (let i = cells.length - 1; i >= 0; i--) {
          const c = (cells[i] || '').trim();
          if (c && isNaN(c) && c.length > 1) {
            startIdx = i;
            joined = (i < cells.length - 1) ? (c + ',' + cells.slice(i + 1).join(',')).trim() : c;
            break;
          }
        }
      }
      if (startIdx === -1) { startIdx = 0; joined = text.trim(); }

      // Glue name fragments before dash
      let fixedJoined = joined;
      const dashMatch = joined.match(/^(.*?)\s+([–—-])\s+(.*)$/);
      if (dashMatch) {
        let left = dashMatch[1].trim();
        const dashChar = dashMatch[2];
        const right = dashMatch[3].trim();

        let k = startIdx - 1;
        const prependParts = [];
        let steps = 0;
        while (k >= 0 && steps < 8) {
          let prev = String(cells[k] || '').trim();
          if (!prev) break;
          if (prev.length > 50) break;
          if (/[0-9]{3,}/.test(prev)) break;
          if (/[–—-]/.test(prev)) break;
          const stripped = prev.replace(/^,+\s*/, '').replace(/\s*,+\s*$/, '');
          if (/^[A-Za-z][A-Za-z '&.-]*$/.test(stripped)) {
            prependParts.unshift(stripped);
            k--; steps++;
            continue;
          }
          break;
        }
        if (prependParts.length) {
          left = (prependParts.join(', ') + (left ? ', ' : '')) + left;
          fixedJoined = `${left} ${dashChar} ${right}`;
        }
      }

      rawCombined = clean(decodeHtml(fixedJoined));
      const parsed = parseCombined(rawCombined);
      artist = parsed.artist || artist;
      title  = parsed.title  || title;
      // duration/startTime remain null here (we'll try iTunes next)
      used = 'livebox-fallback';
    }

    // --- 2) iTunes duration fallback if still missing ---
    if (!duration && artist && title) {
      try {
        const itunesRes = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(`${artist} ${title}`)}&limit=1`, { cache: 'no-store' });
        const itunesJson = await itunesRes.json();
        const track = itunesJson.results?.[0];
        if (track?.trackTimeMillis) duration = Math.round(track.trackTimeMillis / 1000);
      } catch {}
    }

    // --- 3) Rolling log (avoid dupes within 5 minutes) ---
    if (artist && title) {
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
      } catch {}
    }

    const payload = {
      artist,
      title,
      nowPlaying: combineNowPlaying(artist, title) || rawCombined,
      duration,
      startTime,
      source: used
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
      startTime: null,
      source: 'error'
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
