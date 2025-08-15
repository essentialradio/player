import { promises as fs } from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

// ---- helpers ----
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
  .replace(/\s*[–—-]\s*/g, ' – ')
  .trim();

const nfc = (s) => clean(decodeHtml(s)).toLowerCase().replace(/[’'"]/g, '').replace(/\s+/g,' ').trim();
const nfcNoParen = (s) => nfc(s).replace(/\s*\([^)]*\)\s*/g, '').trim();

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

  // Artist – Title (any dash)
  let m = line.match(/^(.*?)\s+[–—-]\s+(.*)$/);
  if (m) return { artist: clean(m[1]), title: clean(m[2]) };

  // Title by Artist
  m = line.match(/^(.*?)\s+by\s+(.*)$/i);
  if (m) return { artist: clean(m[2]), title: clean(m[1]) };

  // Artist: Title
  m = line.match(/^(.*?)\s*:\s*(.*)$/);
  if (m) return { artist: clean(m[1]), title: clean(m[2]) };

  // Very conservative single-comma Artist, Title
  const count = (line.match(/,/g) || []).length;
  if (count === 1) {
    const i = line.indexOf(',');
    const left  = clean(line.slice(0, i));
    const right = clean(line.slice(i + 1));
    const looksLikeArtistName = left && left.split(/\s+/).length <= 6 && !/[!?]$/.test(left);
    if (looksLikeArtistName && right) return { artist: left, title: right };
  }

  // Give up guessing: keep full as title
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

function glueLivebox(text) {
  // Strip HTML, split on commas, and recombine intelligently
  const plain = text.replace(/<[^>]*>/g, '');
  const cells = plain.split(',');

  // Rightmost track-like tail
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

  // Aggressively glue preceding name fragments BEFORE the dash
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

function chooseBest(liveArtist, liveTitle, latestArtist, latestTitle) {
  // If latest has both fields, and titles are close, prefer latest artist/title
  const titlesClose = latestTitle && liveTitle && (
    nfc(latestTitle) === nfc(liveTitle) ||
    nfcNoParen(latestTitle) === nfcNoParen(liveTitle)
  );

  // "Broken" live artist heuristics: single token, or subset of latest, or empty
  const liveTokens = (liveArtist || '').split(/\s+/).filter(Boolean);
  const brokenLive = !liveArtist || liveTokens.length === 1 ||
                     (latestArtist && latestArtist.toLowerCase().includes(liveArtist.toLowerCase()) && latestArtist.length > (liveArtist.length + 2));

  if (latestArtist && latestTitle && titlesClose && (brokenLive || nfc(latestArtist) !== nfc(liveArtist))) {
    return { artist: latestArtist, title: latestTitle, source: 'latestTrack' };
  }
  return {
    artist: liveArtist || latestArtist || '',
    title: liveTitle || latestTitle || '',
    source: liveArtist ? 'livebox' : (latestArtist ? 'latestTrack' : 'unknown')
  };
}

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const debug = url.searchParams.get('debug') === '1';

    // Fetch both in parallel
    const [liveboxRes, latestRes] = await Promise.allSettled([
      fetch('https://streaming06.liveboxstream.uk/proxy/ayrshire/7.html', { cache: 'no-store' }),
      fetch('https://essentialradio.github.io/player/latestTrack.json?_=' + Date.now(), { cache: 'no-store' })
    ]);

    // Livebox parse
    let liveArtist = '', liveTitle = '', rawCombined = '';
    if (liveboxRes.status === 'fulfilled' && liveboxRes.value.ok) {
      const liveText = await liveboxRes.value.text();
      rawCombined = glueLivebox(liveText);
      const parsed = parseCombined(rawCombined);
      liveArtist = parsed.artist;
      liveTitle  = parsed.title;
    }

    // Latest
    let latestArtist = '', latestTitle = '', duration = null, startTime = null;
    if (latestRes.status === 'fulfilled' && latestRes.value.ok) {
      const latest = await latestRes.value.json();
      latestArtist = clean(latest?.artist);
      latestTitle  = clean(latest?.title);
      if (latest?.duration) duration = Number(latest.duration) || null;
      if (latest?.startTime) startTime = latest.startTime;
    }

    // Decide best
    const best = chooseBest(liveArtist, liveTitle, latestArtist, latestTitle);

    // Duration & timing: prefer latestTrack, fallback to iTunes
    if (!duration && best.artist && best.title) {
      try {
        const itunesRes = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(`${best.artist} ${best.title}`)}&limit=1`, { cache: 'no-store' });
        const itunesJson = await itunesRes.json();
        const track = itunesJson.results?.[0];
        if (track?.trackTimeMillis) duration = Math.round(track.trackTimeMillis / 1000);
      } catch {}
    }

    // Rolling log (avoid dupes within 5 minutes)
    if (best.artist && best.title) {
      const nowISO = new Date().toISOString();
      const logEntry = {
        Artist: best.artist,
        Title: best.title,
        "Scheduled Time": nowISO,
        "Duration (s)": duration ?? null
      };
      try {
        const logPath = path.join(process.cwd(), 'public', 'playout_log_rolling.json');
        const existingData = await fs.readFile(logPath, 'utf-8').catch(() => '[]');
        const parsed = JSON.parse(existingData);
        const fiveMinsAgo = Date.now() - 5 * 60 * 1000;
        const isRecentDuplicate = parsed.some(item =>
          item.Artist === best.artist &&
          item.Title === best.title &&
          new Date(item["Scheduled Time"]).getTime() > fiveMinsAgo
        );
        if (!isRecentDuplicate) {
          const updated = [...parsed, logEntry].slice(-100);
          await fs.writeFile(logPath, JSON.stringify(updated, null, 2));
        }
      } catch {}
    }

    const payload = {
      artist: best.artist,
      title: best.title,
      nowPlaying: (best.artist && best.title) ? `${best.artist} - ${best.title}` : (rawCombined || latestTitle || ''),
      duration,
      startTime,
      source: best.source
    };
    if (debug) {
      payload._debug = {
        rawCombined,
        liveArtist,
        liveTitle,
        latestArtist,
        latestTitle,
        decision: best
      };
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
