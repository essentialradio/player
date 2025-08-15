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
  if (/[0-9]/.test(t)) return false;
  if (t.length > 40) return false;
  if (!/^[A-Za-z]/.test(t)) return false;
  return /^[A-Za-z][A-Za-z '&.-]*$/.test(t);
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

  // Handle multiple commas in artist name
  const dashIdx = line.indexOf(' – ');
  if (dashIdx > -1) {
    const leftPart = line.slice(0, dashIdx);
    const rightPart = line.slice(dashIdx + 3);
    return { artist: clean(leftPart), title: clean(rightPart) };
  }

  return { artist: '', title: line };
}

function combineNowPlaying(artist, title) {
  if (artist && title) return `${artist} - ${title}`;
  return title || artist || '';
}

export async function GET() {
  try {
    const res = await fetch('https://streaming06.liveboxstream.uk/proxy/ayrshire/7.html', { cache: 'no-store' });
    let text = await res.text();
    text = text.replace(/<[^>]*>/g, '');

    const cells = text.split(',');
    let startIdx = -1;
    let joined = '';

    for (let i = cells.length - 1; i >= 0; i--) {
      const candidate = cells.slice(i).join(',').trim();
      if (looksLikeTrack(candidate)) {
        startIdx = i;
        joined = candidate;
        break;
      }
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

    if (startIdx === -1) {
      startIdx = 0;
      joined = text.trim();
    }

    let fixedJoined = joined;
    const dashMatch = joined.match(/^(.*?)\s+([–—-])\s+(.*)$/);
    if (dashMatch) {
      let left = dashMatch[1].trim();
      const dashChar = dashMatch[2];
      const right = dashMatch[3].trim();

      let k = startIdx - 1;
      let fragments = [];
      let steps = 0;
      while (k >= 0 && steps < 3) {
        const prev = (cells[k] || '').trim();
        if (!isNameFragment(prev)) break;
        fragments.unshift(prev);
        k--;
        steps++;
      }
      if (fragments.length) {
        left = fragments.join(', ') + (left ? ', ' + left : '');
        fixedJoined = `${left} ${dashChar} ${right}`;
      }
    }

    const rawCombined = clean(decodeHtml(fixedJoined));
    let { artist, title } = parseCombined(rawCombined);

    let duration = null;
    let startTime = null;
    try {
      const latestRes = await fetch('https://essentialradio.github.io/player/latestTrack.json?_=' + Date.now(), { cache: 'no-store' });
      if (latestRes.ok) {
        const latest = await latestRes.json();
        const la = clean(latest?.artist);
        const lt = clean(latest?.title);
        if (lt && title && lt.toLowerCase() === title.toLowerCase() && la) {
          const richer = !artist || la.toLowerCase().includes(artist.toLowerCase()) || la.length > artist.length + 2;
          if (richer) artist = la;
        }
        if (latest?.duration) duration = Number(latest.duration) || null;
        if (latest?.startTime) startTime = latest.startTime;
      }
    } catch {}

    if (!duration && artist && title) {
      try {
        const itunesRes = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(`${artist} ${title}`)}&limit=1`, { cache: 'no-store' });
        const itunesJson = await itunesRes.json();
        const track = itunesJson.results?.[0];
        if (track?.trackTimeMillis) duration = Math.round(track.trackTimeMillis / 1000);
      } catch {}
    }

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
      } catch {}
    }

    return new Response(JSON.stringify({
      artist,
      title,
      nowPlaying: combineNowPlaying(artist, title) || rawCombined,
      duration,
      startTime
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store'
      }
    });
  } catch {
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
