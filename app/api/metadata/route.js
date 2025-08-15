// app/api/metadata/route.js
export const dynamic = 'force-dynamic';

const TIMEOUT_MS = 2500;
const ITUNES_TIMEOUT_MS = 2500;

function fetchWithTimeout(url, { timeout = TIMEOUT_MS, ...opts } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(new Error('timeout')), timeout);
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(t));
}

const decodeHtml = (s) => String(s ?? '')
  .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
  .replace(/&quot;/g,'"').replace(/&#039;/g,"'").replace(/&nbsp;/g,' ');
const clean = (s) => String(s ?? '')
  .replace(/[\u200B-\u200D\uFEFF]/g,'').replace(/\s+/g,' ')
  .replace(/\s*[–—-]\s*/g,' – ').trim();

// Split "Artist - Title" safely (never on commas)
function splitCombined(s) {
  const line = String(s || '').trim();
  if (!line) return { artist:'', title:'' };
  let m = line.match(/^(.*?)\s+[–—-]\s+(.*)$/); if (m) return { artist:m[1].trim(), title:m[2].trim() };
  m = line.match(/^(.*?)\s*:\s*(.*)$/);          if (m) return { artist:m[1].trim(), title:m[2].trim() };
  m = line.match(/^(.*?)\s+by\s+(.*)$/i);        if (m) return { artist:m[2].trim(), title:m[1].trim() };
  return { artist:'', title:line };
}

const looksLikeTrack = (s) => {
  const line = String(s || '').trim();
  if (!line) return false;
  if (/(.*?)\s+[–—-]\s+(.*)/.test(line)) return true;
  if (/(.*?)\s+by\s+(.*)/i.test(line))   return true;
  if (/(.*?)\s*:\s*(.*)/.test(line))     return true;
  return false;
};

function parseCombined(s) {
  const line = clean(s);
  if (!line) return { artist:'', title:'' };
  let m = line.match(/^(.*?)\s+[–—-]\s+(.*)$/); if (m) return { artist: clean(m[1]), title: clean(m[2]) };
  m = line.match(/^(.*?)\s+by\s+(.*)$/i);       if (m) return { artist: clean(m[2]), title: clean(m[1]) };
  m = line.match(/^(.*?)\s*:\s*(.*)$/);         if (m) return { artist: clean(m[1]), title: clean(m[2]) };
  const count = (line.match(/,/g) || []).length;
  if (count === 1) {
    const i = line.indexOf(',');
    const left  = clean(line.slice(0, i));
    const right = clean(line.slice(i + 1));
    const looksArtist = left && left.split(/\s+/).length <= 6 && !/[!?]$/.test(left);
    if (looksArtist && right) return { artist:left, title:right };
  }
  return { artist:'', title:line };
}

// Fix Livebox CSV that splits artist on commas before the dash
function glueLivebox(htmlText) {
  const plain = htmlText.replace(/<[^>]*>/g, '');
  const cells = plain.split(',');

  // rightmost segment that looks like a track
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

  const dashMatch = joined.match(/^(.*?)\s+([–—-])\s+(.*)$/);
  if (dashMatch) {
    let left = dashMatch[1].trim();
    const dashChar = dashMatch[2];
    const right = dashMatch[3].trim();

    // prepend up to 8 name fragments, e.g. "Peter", "Gabriel"
    let k = startIdx - 1, steps = 0;
    const prepend = [];
    while (k >= 0 && steps < 8) {
      const prev = String(cells[k] || '').trim();
      if (!prev || prev.length > 50 || /[0-9]{3,}/.test(prev) || /[–—-]/.test(prev)) break;
      const stripped = prev.replace(/^,+\s*/, '').replace(/\s*,+\s*$/, '');
      if (/^[A-Za-z][A-Za-z '&.-]*$/.test(stripped)) { prepend.unshift(stripped); k--; steps++; continue; }
      break;
    }
    if (prepend.length) left = (prepend.join(', ') + (left ? ', ' : '')) + left;
    joined = `${left} ${dashChar} ${right}`;
  }
  return clean(decodeHtml(joined));
}

// Compare two titles loosely (ignore punctuation/case/parentheses)
function looseEq(a, b) {
  const n = (s)=> String(s||'').toLowerCase().replace(/[’'"]/g,'').replace(/\s+/g,' ').trim();
  const np = (s)=> n(s).replace(/\s*\([^)]*\)\s*/g,'');
  return n(a) === n(b) || np(a) === np(b);
}

export async function GET(req) {
  const url = new URL(req.url);
  const debug = url.searchParams.get('debug') === '1';

  let lt = null, lb = null;
  let ltErr = null, lbErr = null, itErr = null;

  // Fetch BOTH in parallel with timeouts
  await Promise.allSettled([
    (async () => {
      try {
        const r = await fetchWithTimeout('https://essentialradio.github.io/player/latestTrack.json?_=' + Date.now(), { cache:'no-store' });
        if (r.ok) lt = await r.json(); else ltErr = `HTTP ${r.status}`;
      } catch (e) { ltErr = String(e?.message || e); }
    })(),
    (async () => {
      try {
        const r = await fetchWithTimeout('https://streaming06.liveboxstream.uk/proxy/ayrshire/7.html', { cache:'no-store' });
        if (r.ok) {
          const text = await r.text();
          const glued = glueLivebox(text);
          const p = parseCombined(glued);
          lb = { artist: p.artist, title: p.title, nowPlaying: (p.artist && p.title) ? `${p.artist} - ${p.title}` : glued };
        } else { lbErr = `HTTP ${r.status}`; }
      } catch (e) { lbErr = String(e?.message || e); }
    })()
  ]);

  // Normalise latestTrack
  let ltArtist = clean(decodeHtml(lt?.artist));
  let ltTitle  = clean(decodeHtml(lt?.title));
  let ltNP     = clean(decodeHtml(lt?.nowPlaying));
  let ltDur    = (lt?.duration != null) ? Number(lt.duration) : null;
  let ltStart  = lt?.startTime || null;

  // If latestTrack lacks split fields but has combined, split on dash
  if ((!ltArtist || !ltTitle) && ltNP) {
    const g = splitCombined(ltNP);
    ltArtist = ltArtist || g.artist;
    ltTitle  = ltTitle  || g.title;
  }

  // Decision: LIVEBOX-FIRST, but only if it looks good/fresh
  // 1) If Livebox produced artist+title, tentatively choose it
  let artist = '', title = '', duration = null, startTime = null, source = 'unknown';
  if (lb?.artist && lb?.title) {
    artist = lb.artist; title = lb.title; source = 'livebox';
    // If latestTrack has same title and a richer artist string, prefer that artist
    if (ltTitle && looseEq(ltTitle, title) && ltArtist) {
      const richer = ltArtist.length > artist.length || ltArtist.toLowerCase().includes(artist.toLowerCase());
      if (richer) artist = ltArtist;
    }
    // Bring in timing from latestTrack if it matches title
    if (ltTitle && looseEq(ltTitle, title)) {
      if (ltDur)   duration = ltDur;
      if (ltStart) startTime = ltStart;
    }
  }

  // 2) If Livebox failed/empty, use latestTrack
  if (!artist && !title && (ltArtist || ltTitle)) {
    artist = ltArtist || '';
    title  = ltTitle  || '';
    duration = ltDur;
    startTime = ltStart;
    source = 'latestTrack';
  }

  // 3) If STILL empty, use whatever combined string we have
  let combined = '';
  if (!artist || !title) {
    combined = lb?.nowPlaying || ltNP || '';
    if (combined) {
      const g = splitCombined(combined);
      if (!artist) artist = g.artist;
      if (!title)  title  = g.title;
      if (!source) source = 'combined';
    }
  }

  // iTunes duration fallback if needed
  if ((!duration) && (artist || title)) {
    try {
      const term = [artist, title].filter(Boolean).join(' ') || combined;
      if (term) {
        const itR = await fetchWithTimeout(`https://itunes.apple.com/search?term=${encodeURIComponent(term)}&limit=1`, { cache:'no-store', timeout: ITUNES_TIMEOUT_MS });
        const itJ = await itR.json().catch(() => ({}));
        const trk = itJ?.results?.[0];
        if (trk?.trackTimeMillis) duration = Math.round(trk.trackTimeMillis / 1000);
      }
    } catch (e) { itErr = String(e?.message || e); }
  }

  // Build response
  const nowPlaying = (artist && title) ? `${artist} - ${title}` : (combined || '');
  const payload = { artist, title, nowPlaying, duration: duration ?? null, startTime: startTime || null, source };

  if (debug) payload._debug = { ltErr, lbErr, itErr, ltNP, lbNP: lb?.nowPlaying };

  return new Response(JSON.stringify(payload), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store'
    }
  });
}
