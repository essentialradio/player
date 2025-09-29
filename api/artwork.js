// /api/artwork.js
export default async function handler(req, res) {
  // Lightweight CORS + no-store headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store, max-age=0, s-maxage=0, must-revalidate");
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    let { artist = "", title = "" } = req.query;
    artist = String(artist || "").trim();
    title  = String(title  || "").trim();

    // --- Clean noisy bits commonly causing wrong matches ---
    const stripNoise = (s) =>
      s
        // remove brackets like (feat ...), [Remix], (Radio Edit), etc.
        .replace(/\s*[\(\[][^)\]]*[\)\]]\s*/g, " ")
        // remove "feat/ft/with/x/&" trailers and following names
        .replace(/\s+(feat|ft|with|x|&)\.?\s+.+$/i, " ")
        // remove trailing qualifiers
        .replace(/\b(clean|explicit|radio\s+edit|edit|remix|mix|version|rework|vip|club\s+mix)\b/ig, " ")
        // collapse whitespace
        .replace(/\s{2,}/g, " ")
        .trim();

    const a = stripNoise(artist);
    const t = stripNoise(title);

    // Build a ranked list of queries (most specific → least)
    const queries = [];
    if (a && t) queries.push(`${a} ${t}`, `${t} ${a}`, t);
    else if (t) queries.push(t);
    else if (a) queries.push(a);
    else queries.push(""); // empty guard

    const fetchJSON = async (u) => {
      const r = await fetch(u, { cache: "no-store" });
      if (!r.ok) return null;
      return r.json().catch(() => null);
    };

    // Try song entity first, then album as fallback
    let artwork = "";
    for (const q of queries) {
      const term = encodeURIComponent(q);
      // 1) song-first search
      const urlSong =
        `https://itunes.apple.com/search?term=${term}&media=music&entity=song&attribute=songTerm&limit=3`;
      const ds = await fetchJSON(urlSong);
      const hitS = ds?.results?.find(Boolean);
      if (hitS?.artworkUrl100) {
        artwork = hitS.artworkUrl100;
        break;
      }
      // 2) album fallback
      const urlAlb =
        `https://itunes.apple.com/search?term=${term}&media=music&entity=album&attribute=albumTerm&limit=3`;
      const da = await fetchJSON(urlAlb);
      const hitA = da?.results?.find(Boolean);
      if (hitA?.artworkUrl100) {
        artwork = hitA.artworkUrl100;
        break;
      }
    }

    if (!artwork) {
      return res.status(200).json({ url: "" });
    }

    // Up-size to 600x600 (more reliable than 300x300)
    const url = artwork.replace(/\/\d+x\d+bb?\.jpg/i, "/600x600bb.jpg");
    return res.status(200).json({ url });
  } catch (err) {
    // Fail soft: empty URL instead of erroring the UI
    return res.status(200).json({ url: "" });
  }
}
