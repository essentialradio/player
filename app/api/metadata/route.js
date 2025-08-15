// app/api/metadata/route.js
export const dynamic = 'force-dynamic';

// ---- timeouts ----
const TIMEOUT_MS = 2500;
function fetchWithTimeout(url, { timeout = TIMEOUT_MS, ...opts } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(new Error('timeout')), timeout);
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(t));
}

// ---- helpers ----
const decodeHtml = (s) => String(s ?? '')
  .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
  .replace(/&quot;/g,'"').replace(/&#039;/g,"'").replace(/&nbsp;/g,' ');
const clean = (s) => String(s ?? '')
  .replace(/[\u200B-\u200D\uFEFF]/g,'').replace(/\s+/g,' ')
  .replace(/\s*[–—-]\s*/g,' – ').trim();

// split "Artist - Title" safely (NEVER on commas)
function splitCombined(s) {
  const line = clean(s);
  if (!line) return { artist:'', title:'' };

  // "Artist – Title" / "Artist - Title"
  let m = line.match(/^(.*?)\s+[–—-]\s+(.*)$/);
  if (m) return { artist: clean(m[1]), title: clean(m[2]) };

  // "Artist: Title"
  m = line.match(/^(.*?)\s*:\s*(.*)$/);
  if (m) return { artist: clean(m[1]), title: clean(m[2]) };

  // "Title by Artist"
  m = line.match(/^(.*?)\s+by\s+(.*)$/i);
  if (m) return { artist: clean(m[2]), title: clean(m[1]) };

  // last resort: keep full as title
  return { artist:'', title: line };
}

const looksLikeTrack = (s) => {
  const line = clean(s);
  if (!line) return false;
  return /^(.*?)\s+[–—-]\s+(.*)$/.test(line) ||
         /^(.*?)\s+by\s+(.*)$/i.test(line) ||
         /^(.*?)\s*:\s*(.*)$/.test(line);
};

// parse a combined line from Livebox etc.
function parseCombined(s) {
  const line = clean(s);
  if (!line) return { artist:'', title:'' };

  let m = line.match(/^(.*?)\s+[–—-]\s+(.*)$/);
  if (m) return { artist: clean(m[1]), title: clean(m[2]) };

  m = line.match(/^(.*?)\s+by\s+(.*)$/i);
  if (m) return { artist: clean(m[2]), title: clean(m[1]) };

  m = line.match(/^(.*?)\s*:\s*(.*)$/);
  if (m) return { artist: clean(m[1]), title: clean(m[2]) };

  // extremely conservative "Artist, Title" (one comma only)
  const commas = (line.match(/,/g) || []).length;
  if (commas === 1) {
    const i = line.indexOf(',');
    const left = clean(line.slice(0, i));
    const right = clean(line.slice(i + 1));
    const looksArtist = left && left.split(/\s+/).length <= 6 && !/[!?]$/.test(left);
    if (looksArtist && right) return { artist: left, title: right };
  }
  return { artist:'', title: line };
}

// Livebox CSV “glue”: if name got split by commas before the dash, rejoin it
function glueLivebox(html) {
  const plain = html.replace(/<[^>]*>/g, '');
  const cells = plain.split(',');

  // find rightmost tail that looks like a track line
  let start = -1, joined = '';
  for (let i = cells.length - 1; i >= 0; i--) {
    const cand = cells.slice(i).join(',').trim();
    if (looksLikeTrack(cand)) { start = i; joined = cand; break; }
  }
  if (start === -1) {
    for (let i = cells.length - 1; i >= 0; i--) {
      const c = (cells[i] || '').trim();
      if (c && isNaN(c) && c.length > 1) {
        start = i;
        joined = (i < cells.length - 1) ? (c + ',' + cells.slice(i + 1).join(',')).trim() : c;
        break;
      }
    }
  }
  if (start === -1) { start = 0; joined = plain.trim(); }

  // if we have "X – Y", pull preceding cells that look like name fragments and prepend
  const m = joined.match(/^(.*?)\s+([–—-])\s+(.*)$/);
  if (m) {
    let left = m[1].trim();
    const dash = m[2];
    const right = m[3].trim();

    let k = start - 1;
    const parts = [];
    let steps = 0;
    while (k >= 0 && steps < 8) {
      const prev = String(cells[k] || '').trim();
      if (!prev || prev.length > 50 || /[0-9]{3,}/.test(prev) || /[–—-]/.test(prev)) break;
      const stripped = prev.replace(/^,+\s*/, '').replace(/\s*,+\s*$/, '');
      if (/^[A-Za-z][A-Za-z '&.-]*$/.test(stripped)) { parts.unshift(stripped); k--; steps++; continue; }
      break;
    }
    if (parts.length) left = (parts.join(', ') + (left ? ', ' : '')) + left;
    joined = `${left} ${dash} ${right}`;
  }
  return clean(decodeHtml(joined));
}

// ---- handler ----
export async function GET(req) {
  const url = new URL(req.url);
  const debug = url.searchParams.get('debug') === '1';

  let artist = '', title = '', duration = null, startTime = null, source = 'unknown';
  let latestCombined = '';  // from latestTrack.nowPlaying
  let liveboxCombined = ''; // glued string from Livebox
  let ltErr = null, lbErr = null;

  try {
    // 1) latestTrack.json (primary)
    try {
      const r = await fetchWithTimeout(
        'https://essentialradio.github.io/player/latestTrack.json?_=' + Date.now(),
        { cache: 'no-store' }
      );
      if (r.ok) {
        const j = await r.json();
        latestCombined = clean(decodeHtml(j?.nowPlaying));
        const la = clean(decodeHtml(j?.artist));
        const lt = clean(decodeHtml(j?.title));
        if (la) artist = la;
        if (lt) title = lt;
        if (j?.duration != null) duration = Number(j.duration) || null;
        if (j?.startTime) startTime = j.startTime;
        if (artist || title || latestCombined) source = 'latestTrack';
      } else {
        ltErr = `HTTP ${r.status}`;
      }
    } catch (e) { ltErr = String(e?.message || e); }

    // If we have combined but missing split fields, derive them
    if ((!artist || !title) && latestCombined) {
      const g = splitCombined(latestCombined);
      if (!artist) artist = g.artist;
      if (!title)  title  = g.title;
    }

    // 2) Livebox fallback only if still empty
    if (!artist && !title) {
      try {
        const r = await fetchWithTimeout(
          'https://streaming06.liveboxstream.uk/proxy/ayrshire/7.html',
          { cache: 'no-store' }
        );
        if (r.ok) {
          const text = await r.text();
          liveboxCombined = glueLivebox(text);
          const p = parseCombined(liveboxCombined);
          artist = p.artist;
          title  = p.title;
          source = 'livebox';
        } else {
          lbErr = `HTTP ${r.status}`;
        }
      } catch (e) { lbErr = String(e?.message || e); }
    }

    // 3) If we STILL only have a combined string, split it
    if ((!artist || !title) && (latestCombined || liveboxCombined)) {
      const combined = latestCombined || liveboxCombined;
      const g = splitCombined(combined);
      if (!artist) artist = g.artist;
      if (!title)  title  = g.title;
      if (!source) source = 'combined';
    }

    // 4) Build response (ALWAYS include split fields if possible)
    const nowPlaying = (artist && title) ? `${artist} - ${title}`
                                         : (latestCombined || liveboxCombined || '');

    const payload = { artist, title, nowPlaying, duration, startTime, source };
    if (debug) payload._debug = { ltErr, lbErr, latestCombined, liveboxCombined };

    return new Response(JSON.stringify(payload), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store'
      }
    });
  } catch {
    return new Response(JSON.stringify({
      artist:'', title:'', nowPlaying:'', duration:null, startTime:null, source:'error'
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
