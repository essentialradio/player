// /api/artwork.js (hardened)
export default async function handler(req, res) {
  // CORS + conservative caching (UI can add cache-busters when needed)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store, max-age=0, s-maxage=0, must-revalidate");
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    let { artist = "", title = "" } = req.query;
    artist = String(artist || "").trim();
    title  = String(title  || "").trim();

    const norm = (s) => String(s || "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")  // strip diacritics
      .replace(/&/g, " and ")
      .replace(/\s*[\(\[][^)\]]*[\)\]]\s*/g, " ") // remove bracketed bits
      .replace(/\s+(feat|featuring|ft|with|x)\.?\s+.+$/i, " ") // strip features
      .replace(/\b(clean|explicit|radio\s*edit|edit|remix|mix|version|rework|vip|club\s*mix|acoustic|live)\b/ig, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();

    const a = norm(artist);
    const t = norm(title);

    // If only one side provided, still attempt but we'll be stricter on matches
    const termsPrimary = [];
    if (t && a) termsPrimary.push(`${t} ${a}`, `${a} ${t}`);
    if (t) termsPrimary.push(t);
    if (a) termsPrimary.push(a);

    const toJSON = async (url) => {
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) return null;
      try { return await r.json(); } catch { return null; }
    };

    // Compute a simple score for how well an Apple result matches
    const scoreHit = (hit) => {
      const tHit = norm(hit.trackName || hit.collectionName || "");
      const aHit = norm(hit.artistName || "");

      let s = 0;
      if (t && tHit) {
        if (tHit === t) s += 100;
        else if (tHit.startsWith(t) || t.startsWith(tHit)) s += 90;
        else if (tHit.includes(t) || t.includes(tHit)) s += 75;
      }
      if (a && aHit) {
        if (aHit === a) s += 60;
        else if (aHit.includes(a) || a.includes(aHit)) s += 45;
      }
      // Prefer non-compilation albums and songs over albums
      if (hit.kind === "song" || hit.wrapperType === "track") s += 15;
      if (String(hit.collectionName || "").toLowerCase().includes("greatest hits")) s -= 5;
      return s;
    };

    let bestArtwork = "";
    let bestScore = -1;

    // 1) song search (no attribute constraint, allow both title+artist in term)
    for (const q of termsPrimary) {
      const url = `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&media=music&entity=song&limit=10`;
      const data = await toJSON(url);
      const hits = (data?.results || []).filter(x => (x.kind === "song" || x.wrapperType === "track") && x.artworkUrl100);
      for (const h of hits) {
        const sc = scoreHit(h);
        if (sc > bestScore) {
          bestScore = sc;
          bestArtwork = h.artworkUrl100;
        }
      }
      if (bestScore >= 130) break; // good enough (exact-ish)
    }

    // 2) if still weak, search by title-only then filter by artist
    if (bestScore < 100 && t) {
      const url = `https://itunes.apple.com/search?term=${encodeURIComponent(t)}&media=music&entity=song&attribute=songTerm&limit=10`;
      const data = await toJSON(url);
      const hits = (data?.results || []).filter(x => (x.kind === "song" || x.wrapperType === "track") && x.artworkUrl100);
      for (const h of hits) {
        const sc = scoreHit(h) + 5; // small bump
        if (sc > bestScore) {
          bestScore = sc;
          bestArtwork = h.artworkUrl100;
        }
      }
    }

    // 3) album fallback (artist + title, or just title)
    if (!bestArtwork) {
      const q = a && t ? `${a} ${t}` : (t || a || "");
      const url = `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&media=music&entity=album&limit=10`;
      const data = await toJSON(url);
      const hits = (data?.results || []).filter(x => x.artworkUrl100);
      for (const h of hits) {
        const sc = scoreHit(h) - 10; // album less preferred
        if (sc > bestScore) {
          bestScore = sc;
          bestArtwork = h.artworkUrl100;
        }
      }
    }

    if (!bestArtwork) {
      return res.status(200).json({ url: "" });
    }

    // Prefer 600px, which is widely supported; 1200 often works but 600 is safer
    const urlOut = bestArtwork.replace(/\/\d+x\d+bb?\.jpg/i, "/600x600bb.jpg");
    return res.status(200).json({ url: urlOut });
  } catch (e) {
    return res.status(200).json({ url: "" });
  }
}
