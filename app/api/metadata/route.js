
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
  .replace(/\s*[–—-]\s*/g, ' – ')
  .trim();

const looksLikeTrack = (s) => {
  const line = String(s || '').trim();
  if (!line) return false;
  if (/(.*?)\s+[–—-]\s+(.*)/.test(line)) return true;
  if (/(.*?)\s+by\s+(.*)/i.test(line)) return true;
  if (/(.*?)\s*:\s*(.*)/.test(line)) return true;
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

function parseArtistTitle(line) {
  const m1 = line.match(/^(.*?)\s+[–—-]\s+(.*)$/);
  if (m1) return { artist: clean(m1[1]), title: clean(m1[2]) };
  const m2 = line.match(/^(.*?)\s+by\s+(.*)$/i);
  if (m2) return { artist: clean(m2[2]), title: clean(m2[1]) };
  const m3 = line.match(/^(.*?)\s*:\s*(.*)$/);
  if (m3) return { artist: clean(m3[1]), title: clean(m3[2]) };
  return { artist: '', title: clean(line) };
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

    // NEW: glue preceding comma-split fragments until dash
    const dashPos = joined.search(/\s+[–—-]\s+/);
    if (dashPos > 0) {
      let left = joined.slice(0, dashPos).trim();
      const right = joined.slice(dashPos + 3).trim();
      let k = startIdx - 1;
      let fragments = [];
      while (k >= 0) {
        const prev = (cells[k] || '').trim();
        if (!isNameFragment(prev)) break;
        fragments.unshift(prev);
        k--;
      }
      if (fragments.length) {
        left = fragments.join(', ') + ', ' + left;
      }
      joined = `${left} - ${right}`;
    }

    const rawCombined = clean(decodeHtml(joined));
    let { artist, title } = parseArtistTitle(rawCombined);

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
