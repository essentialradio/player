import { promises as fs } from 'fs';
import path from 'path';

// --- helpers ---
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

const looksLikeTrack = (s) => {
  const line = String(s || '').trim();
  if (!line) return false;
  if (/(.*?)\s+[–—-]\s+(.*)/.test(line)) return true;   // Artist – Title
  if (/(.*?)\s+by\s+(.*)/i.test(line)) return true;     // Title by Artist
  if (/(.*?)\s*:\s*(.*)/.test(line)) return true;       // Artist: Title
  return false;
};

const isNameFragment = (s) => {
  const t = String(s || '').trim();
  if (!t) return false;
  if (/[0-9]/.test(t)) return false;             // avoid numeric cols
  if (t.length > 40) return false;               // avoid long junk
  if (!/^[A-Za-z]/.test(t)) return false;        // start with a letter
  // allow &, ' and simple words
  return /^[A-Za-z][A-Za-z '&.-]*$/.test(t);
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

function combineNowPlaying(artist, title) {
  if (artist && title) return `${artist} - ${title}`;
  return title || artist || '';
}

export async function GET() {
  try {
    // 1) Pull raw CSV-like status from Livebox
    const res = await fetch('https://streaming06.liveboxstream.uk/proxy/ayrshire/7.html', { cache: 'no-store' });
    let text = await res.text();

    // Strip HTML
    text = text.replace(/<[^>]*>/g, '');

    // 2) Split on commas (Livebox isn't quoting) and recombine smartly
    const cells = text.split(',');
    let startIdx = -1;
    let joined = '';
    // Find rightmost position where the remainder looks like a track line
    for (let i = cells.length - 1; i >= 0; i--) {
      const candidate = cells.slice(i).join(',').trim();
      if (looksLikeTrack(candidate)) {
        startIdx = i;
        joined = candidate;
        break;
      }
    }
    // Fallbacks
    if (startIdx === -1) {
      // take last non-numeric-ish cell joined with the tail
      for (let i = cells.length - 1; i >= 0; i--) {
        const c = (cells[i] || '').trim();
        if (c && isNaN(c) && c.length > 1) {
          startIdx = i;
          joined = (i < cells.length - 1) ? (c + ',' + cells.slice(i + 1).join(',')).trim() : c;
          break;
        }
      }
    }
    if (startIdx === -1) {
      // give up: whole text
      startIdx = 0;
      joined = text.trim();
    }

    // 3) If we have a dash split, check for comma-broken artist pieces BEFORE the dash
    //    Example: cells[startIdx-1] = "Peter", joined = " Gabriel – Sledgehammer"
    let fixedJoined = joined;
    const dashMatch = joined.match(/^(.*?)\s+([–—-])\s+(.*)$/);
    if (dashMatch) {
      let left = dashMatch[1].trim();
      const dashChar = dashMatch[2];
      const right = dashMatch[3].trim();

      // Look back up to 3 cells to glue name fragments (e.g., "Peter", "Earth", "KC")
      let k = startIdx - 1;
      let fragments = [];
      let steps = 0;
      while (k >= 0 && steps < 3) {
        const prev = (cells[k] || '').trim();
        // Stop if previous cell looks numeric/junk
        if (!isNameFragment(prev)) break;
        // Prepend fragment
        fragments.unshift(prev);
        k--;
        steps++;
        // Heuristic: stop when previous previous cell wouldn't look like a name fragment
        // (we'll check in next loop iteration)
      }
      if (fragments.length) {
        left = (fragments.join(', ') + (left ? ', ' : '')) + left;
        fixedJoined = `${left} ${dashChar} ${right}`;
      }
    }

    const rawCombined = clean(decodeHtml(fixedJoined));

    // 4) Parse into fields
    let { artist, title } = parseCombined(rawCombined);

    // 5) Enrich from canonical latestTrack.json (adds collaborators; timing)
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

    // 6) Optional iTunes duration fallback
    if (!duration && artist && title) {
      try {
        const itunesRes = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(`${artist} ${title}`)}&limit=1`, { cache: 'no-store' });
        const itunesJson = await itunesRes.json();
        const track = itunesJson.results?.[0];
        if (track?.trackTimeMillis) duration = Math.round(track.trackTimeMillis / 1000);
      } catch {}
    }

    // 7) Rolling log (avoid dupes within 5 minutes)
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
      } catch {}
    }

    // 8) Final payload
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
