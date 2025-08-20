// iTunes artwork lookup with ERLogo2.png fallback
window.getTrackArtwork = window.getTrackArtwork || (async function(name){
  const FALLBACK = 'ERLogo2.png';
  try {
    const q = encodeURIComponent((name || '').trim());
    if (!q) return FALLBACK;
    const r = await fetch(`https://itunes.apple.com/search?term=${q}&entity=song&limit=1&country=gb`);
    if (!r.ok) return FALLBACK;
    const j = await r.json();
    const raw = j?.results?.[0]?.artworkUrl100 || j?.results?.[0]?.artworkUrl60 || j?.results?.[0]?.artworkUrl30 || '';
    return raw ? raw.replace(/\/(\d+x\d+)bb\//, '/600x600bb/') : FALLBACK;
  } catch { return FALLBACK; }
});
