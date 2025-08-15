import { promises as fs } from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

// --- helpers ---
const decodeHtml = (s) => String(s ?? '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&nbsp;/g, ' ');

const clean = (s) => String(s ?? '')
  .replace(/[\u200B-\u200D\uFEFF]/g, '')
  .replace(/\s+/g, ' ')
  .replace(/\s*[–—-]\s*/g, ' – ')
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
  let m = line.match(/^(.*?)\s+[–—-]\s+(.*)$/);
  if (m) return { artist: clean(m[1]), title: clean(m[2]) };
  m = line.match(/^(.*?)\s+by\s+(.*)$/i);
  if (m) return { artist: clean(m[2]), title: clean(m[1]) };
  m = line.match(/^(.*?)\s*:\s*(.*)$/);
  if (m) return { artist: clean(m[1]), title: clean(m[2]) };
  // very conservative single-comma Artist, Title
  const count = (line.match(/,/g) || []).length;
  if (count === 1) {
    const i = line.indexOf(',');
    const left  = clean(line.slice(0, i));
    const right = clean(line.slice(i + 1));
    const looksLikeArtist = left && left.split(/\s+/).length <= 6 && !/[!?]$/.test(left);
    if (looksLikeArtist && right) return { artist: left, title: right };
  }
  return { artist: '', title: line };
}

// Livebox CSV “glue” to fix comma-split artist names before dash
function glueLivebox(text) {
  const plain = text.replace(/<[^>]*>/g, '');
  const cells = plain.split(',');

  // find rightmost tail that looks like a track
  let startIdx = -1, joined = '';
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
  if (startIdx === -1) { startIdx = 0; joined = plain.trim(); }

  // aggressively glue preceding name fragments BEFORE the dash
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
        k--; steps++; continue;
      }
      break;
    }
    if (prependParts.length) {
      left = (prependParts.join(', ') + (left ? ', ' : '')) + left;
      joined = `${left} ${dashChar} ${right}`;
    }
  }
  return clean(decodeHtml(joined));
}

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const debug = url.searchParams.get('debug') === '1';

    // 0) Try canonical latestTrack.json FIRST
    let artist = '', title = '', duration = null, startTime = null, source = 'latestTrack';
    let ltOk = false, ltErr = null;

    try {
      const ltRes = await fetch('https://essentialradio.github.io/player/latestTrack.json?_=' + Date.now(), { cache: 'no-store' });
      if (ltRes.ok) {
        const lt = await ltRes.json();
        artist = clean(lt?.artist);
        title  = clean(lt?.title);
        if (lt?.duration) duration = Number(lt.duration) || null;
        if (lt?.startTime) startTime = lt.startTime;
        ltOk = Boolean(artist && title);
      } else {
        ltErr = `HTTP ${ltRes.status}`;
      }
    } catch (e) {
      ltErr = String(e?.message || e);
    }

    // 1) If latestTrack was empty/unavailable, fall back to Livebox
    let rawCombined = '';
    if (!ltOk) {
      source = 'livebox-fallback';
      try {
        const lbRes = await fetch('https://streaming06.liveboxstream.uk/proxy/ayrshire/7.html', { cache: 'no-store' });
        if (lbRes.ok) {
          const lbText = await lbRes.text();
          rawCombined = glueLivebox(lbText);
          const p = parseCombined(rawCombined);
          artist = p.artist; title = p.title;
        } else {
          rawCombined = '';
        }
      } catch { /* ignore */ }
    }

    // 2) iTunes duration fallback if needed
    if (!duration && artist && title) {
      try {
        const itRes = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(`${artist} ${title}`)}&limit=1`, { cache: 'no-store' });
        const itJson = await itRes.json();
        const track = itJson.results?.[0];
        if (track?.trackTimeMillis) duration = Math.round(track.trackTimeMillis / 1000);
      } catch { /* ignore */ }
    }

    // 3) Rolling log (best-effort; ignore if not allowed on this runtime)
    if (artist && title) {
      const nowISO = new Date().toISOString();
      const logEntry = { Artist: artist, Title: title, "Scheduled Time": nowISO, "Duration (s)": duration ?? null };
      try {
        const logPath = path.join(process.cwd(), 'public', 'playout_log_rolling.json');
        const existingData = await fs.readFile(logPath, 'utf-8').catch(() => '[]');
        const parsed = JSON.parse(existingData);
        const fiveMinsAgo = Date.now() - 5 * 60 * 1000;
        const isRecentDuplicate = parsed.some(item =>
          item.Artist === artist && item.Title === title &&
          new Date(item["Scheduled Time"]).getTime() > fiveMinsAgo
        );
        if (!isRecentDuplicate) {
          const updated = [...parsed, logEntry].slice(-100);
          await fs.writeFile(logPath, JSON.stringify(updated, null, 2));
        }
      } catch { /* ignore on Edge/readonly */ }
    }

    const payload = {
      artist,
      title,
      nowPlaying: (artist && title) ? `${artist} - ${title}` : (rawCombined || ''),
      duration,
      startTime,
      source
    };
    if (debug) {
      payload._debug = { ltOk, ltErr, rawCombined };
    }

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
