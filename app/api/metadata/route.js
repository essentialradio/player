// app/api/metadata/route.js
import { promises as fs } from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

// ---------- timeouts ----------
const TIMEOUT_MS = 2500;
const ITUNES_TIMEOUT_MS = 2500;

function fetchWithTimeout(url, { timeout = TIMEOUT_MS, ...opts } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(new Error('timeout')), timeout);
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(t));
}

// ---------- helpers ----------
const decodeHtml = (s) => String(s ?? '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&nbsp;/g, ' ');

const clean = (s) => String(s ?? '')
  .replace(/[\u200B-\u200D\uFEFF]/g, '')
  .replace(/\s+/g, ' ')
  .replace(/\s*[–—-]\s*/g, ' – ')
  .trim();

// Split "Artist - Title" safely (never on commas)
function splitCombined(s) {
  const line = String(s || '').trim();
  if (!line) return { artist: '', title: '' };
  let m = line.match(/^(.*?)\s+[–—-]\s+(.*)$/); if (m) return { artist: m[1].trim(), title: m[2].trim() };
  m = line.match(/^(.*?)\s*:\s*(.*)$/);          if (m) return { artist: m[1].trim(), title: m[2].trim() };
  m = line.match(/^(.*?)\s+by\s+(.*)$/i);        if (m) return { artist: m[2].trim(), title: m[1].trim() };
  return { artist: '', title: line };
}

const looksLikeTrack = (s) => {
  const line = String(s || '').trim();
  if (!line) return false;
  if (/(.*?)\s+[–—-]\s+(.*)/.test(line)) return true;
  if (/(.*?)\s+by\s+(.*)/i.test(line)) return true;
  if (/(.*?)\s*:\s*(.*)/.test(line)) return true;
  return false;
};

function parseCombined(s) {
  const line = clean(s);
  if (!line) return { artist: '', title: '' };
  let m = line.match(/^(.*?)\s+[–—-]\s+(.*)$/); if (m) return { artist: clean(m[1]), title: clean(m[2]) };
  m = line.match(/^(.*?)\s+by\s+(.*)$/i);       if (m) return { artist: clean(m[2]), title: clean(m[1]) };
  m = line.match(/^(.*?)\s*:\s*(.*)$/);         if (m) return { artist: clean(m[1]), title: clean(m[2]) };
  // conservative single-comma "Artist, Title"
  const count = (line.match(/,/g) || []).length;
  if (count === 1) {
    const i = line.indexOf(',');
    const left  = clean(line.slice(0, i));
    const right = clean(line.slice(i + 1));
    const looksArtist = left && left.split(/\s+/).length <= 6 && !/[!?]$/.test(left);
    if (looksArtist && right) return { artist: left, title: right };
  }
  return { artist: '', title: line };
}

// Livebox CSV “glue” to fix comma-split artist pieces before the dash
function glueLivebox(htmlText) {
  const plain = htmlText.replace(/<[^>]*>/g, '');
  const cells = plain.split(',');

  // rightmost tail that looks like a track
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

  // prepend preceding name fragments BEFORE the dash
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

// ---------- handler ----------
export async function GET(req) {
  const url = new URL(req.url);
  const debug = url.searchParams.get('debug') === '1';

  let artist = '', title = '', duration = null, startTime = null, source = 'unknown', artwork = null;
  let latestNowPlaying = '';  // combined from latestTrack if present
  let rawCombined = '';       // combined from Livebox glue
  let ltErr = null, lbErr = null, itErr = null;

  try {
    // 0) latestTrack.json FIRST (with timeout)
    try {
      const ltRes = await fetchWithTimeout(
        'https://essentialradio.github.io/player/latestTrack.json?_=' + Date.now(),
        { cache: 'no-store', timeout: TIMEOUT_MS }
      );
      if (ltRes.ok) {
        const lt = await ltRes.json();
        latestNowPlaying = clean(decodeHtml(lt?.nowPlaying));
        const la = clean(decodeHtml(lt?.artist));
        const ltit = clean(decodeHtml(lt?.title));
        if (la) artist = la;
        if (ltit) title = ltit;
        if (lt?.duration != null) duration = Number(lt.duration) || null;
        if (lt?.startTime) startTime = lt.startTime;
        if (artist || title || latestNowPlaying) source = 'latestTrack';
      } else {
        ltErr = `HTTP ${ltRes.status}`;
      }
    } catch (e) { ltErr = String(e?.message || e); }

    // derive from combined if needed
    if ((!artist || !title) && latestNowPlaying) {
      const guess = splitCombined(latestNowPlaying);
      if (!artist) artist = guess.artist;
      if (!title)  title  = guess.title;
    }

    // 1) Livebox fallback (with timeout)
    if (!artist && !title) {
      try {
        const lbRes = await fetchWithTimeout(
          'https://streaming06.liveboxstream.uk/proxy/ayrshire/7.html',
          { cache: 'no-store', timeout: TIMEOUT_MS }
        );
        if (lbRes.ok) {
          const lbText = await lbRes.text();
          rawCombined = glueLivebox(lbText);
          const p = parseCombined(rawCombined);
          artist = p.artist;
          title  = p.title;
          source = 'livebox-fallback';
        } else {
          lbErr = `HTTP ${lbRes.status}`;
        }
      } catch (e) { lbErr = String(e?.message || e); }
    }

    // 2) Safety net: still only combined? split it.
    if ((!artist || !title) && (latestNowPlaying || rawCombined)) {
      const combined = latestNowPlaying || rawCombined;
      const guess = splitCombined(combined);
      if (!artist) artist = guess.artist;
      if (!title)  title  = guess.title;
    }

    // 3) iTunes duration/artwork fallback (with timeout)
    if ((artist || title) && (!duration || !artwork)) {
      try {
        const itTerm = [artist, title].filter(Boolean).join(' ') || latestNowPlaying || rawCombined;
        if (itTerm) {
          const itRes = await fetchWithTimeout(
            `https://itunes.apple.com/search?term=${encodeURIComponent(itTerm)}&limit=1`,
            { cache: 'no-store', timeout: ITUNES_TIMEOUT_MS }
          );
          const itJson = await itRes.json().catch(() => ({}));
          const track = itJson?.results?.[0];
          if (!duration && track?.trackTimeMillis) duration = Math.round(track.trackTimeMillis / 1000);
          if (!artwork && track?.artworkUrl100) artwork = String(track.artworkUrl100).replace('100x100','300x300');
        }
      } catch (e) { itErr = String(e?.message || e); }
    }

    // 4) Rolling log (best-effort; ignore on readonly FS)
    if (artist && title) {
      const nowISO = new Date().toISOString();
      const logEntry = { Artist: artist, Title: title, "Scheduled Time": nowISO, "Duration (s)": duration ?? null };
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
      } catch { /* ignore */ }
    }

    // 5) Build & return
    const nowPlayingCombined =
      (artist && title) ? `${artist} - ${title}`
                        : (latestNowPlaying || rawCombined || '');

    const payload = {
      artist,
      title,
      nowPlaying: nowPlayingCombined,
      duration,
      startTime,
      artwork,
      source
    };

    if (debug) payload._debug = { ltErr, lbErr, itErr, latestNowPlaying, rawCombined };

    return new Response(JSON.stringify(payload), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store'
      }
    });
  } catch {
    // never hang: return an empty but valid response
    return new Response(JSON.stringify({
      artist: '',
      title: '',
      nowPlaying: '',
      duration: null,
      startTime: null,
      artwork: null,
      source: 'error'
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store'
      }
    });
  }
}
