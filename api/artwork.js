// pages/api/artwork.js
export default async function handler(req, res) {
  try {
    const { q = '', country = 'GB', limit = '5' } = req.query || {};
    const term = String(q).slice(0, 200);
    const clean = term
      .replace(/[\u2013\u2014]/g, '-')
      .replace(/\s*-\s*/g, ' ')
      .replace(/\s*\([^)]*\)/g, ' ')
      .replace(/\s*\[[^\]]*\]/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();

    if (!clean) {
      res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60');
      return res.status(200).json({ url: '', source: 'none', hits: 0 });
    }

    const url = new URL('https://itunes.apple.com/search');
    url.searchParams.set('media', 'music');
    url.searchParams.set('entity', 'musicTrack');
    url.searchParams.set('country', String(country || 'GB'));
    url.searchParams.set('limit', String(limit || '5'));
    url.searchParams.set('term', clean);

    const r = await fetch(url.toString(), {
      headers: { 'User-Agent': 'EssentialRadioArtworkProxy/1.0 (+yourdomain)' }
    });

    if (!r.ok) {
      res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60');
      return res.status(200).json({ url: '', source: 'itunes', hits: 0 });
    }

    const d = await r.json();
    const results = Array.isArray(d?.results) ? d.results : [];
    const hit = results.find(x => (x.kind === 'song' || x.wrapperType === 'track') && x.artworkUrl100);
    let best = '';
    if (hit?.artworkUrl100) {
      best = hit.artworkUrl100.replace('100x100', '300x300');
      if (/[^\/]100x100bb\.jpg$/.test(hit.artworkUrl100)) {
        best = hit.artworkUrl100.replace('100x100', '600x600');
      }
    }
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=86400');
    return res.status(200).json({ url: best || '', source: 'itunes', hits: results.length });
  } catch (e) {
    try { res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60'); } catch {}
    return res.status(200).json({ url: '', source: 'error', hits: 0 });
  }
}
