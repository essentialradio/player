// pages/api/artwork.js
export const config = { runtime: "edge" }; // fast + global

const noStoreHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store, max-age=0, s-maxage=0, must-revalidate",
};

const stripNoise = (s = "") =>
  String(s)
    // remove bracketed/parenthesized segments: (feat ...), [Remix], (Official Video), etc.
    .replace(/\s*[\(\[][^)\]]*[\)\]]\s*/g, " ")
    // drop "feat/ft/with/x/&" + everything after
    .replace(/\s+(feat|featuring|ft|with|w\/|x|&)\.?\s+.+$/i, " ")
    // remove common qualifiers
    .replace(
      /\b(clean|explicit|radio\s+edit|edit|remix|mix|version|rework|vip|club\s+mix|official\s+audio|official\s+video|visualizer|lyric\s+video)\b/gi,
      " "
    )
    // collapse whitespace
    .replace(/\s{2,}/g, " ")
    .trim();

async function fetchJSON(url) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) return null;
  try { return await r.json(); } catch { return null; }
}

function bumpSize(url, px = 600) {
  // iTunes returns artworkUrl100 like .../100x100bb.jpg
  return String(url).replace(/\/\d+x\d+bb?\.jpg/i, `/${px}x${px}bb.jpg`);
}

export default async function handler(req) {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: noStoreHeaders });
  }

  try {
    const { searchParams } = new URL(req.url);
    const rawArtist = searchParams.get("artist") || "";
    const rawTitle  = searchParams.get("title")  || "";

    const artist = stripNoise(rawArtist);
    const title  = stripNoise(rawTitle);

    // Build ranked queries (most specific → least)
    const queries = [];
    if (artist && title) queries.push(`${artist} ${title}`, `${title} ${artist}`, title);
    else if (title)      queries.push(title);
    else if (artist)     queries.push(artist);
    else                 queries.push("");

    let artwork = "";

    for (const q of queries) {
      const term = encodeURIComponent(q);

      // 1) SONG search first (avoid videos)
      const urlSong =
        `https://itunes.apple.com/search?term=${term}&media=music&entity=song&attribute=songTerm&limit=5`;
      const ds = await fetchJSON(urlSong);
      // filter out obvious video/lyric noise just in case
      const songHit = ds?.results?.find(r =>
        r?.artworkUrl100 &&
        !/video|lyric/i.test(`${r?.kind || ""} ${r?.collectionName || ""} ${r?.trackName || ""}`)
      );
      if (songHit?.artworkUrl100) {
        artwork = songHit.artworkUrl100;
        break;
      }

      // 2) ALBUM fallback
      const urlAlb =
        `https://itunes.apple.com/search?term=${term}&media=music&entity=album&attribute=albumTerm&limit=5`;
      const da = await fetchJSON(urlAlb);
      const albHit = da?.results?.find(r => r?.artworkUrl100);
      if (albHit?.artworkUrl100) {
        artwork = albHit.artworkUrl100;
        break;
      }

      // 3) Track-term fallback (slightly broader)
      const urlTrack =
        `https://itunes.apple.com/search?term=${term}&media=music&entity=song&attribute=artistTerm&limit=5`;
      const dt = await fetchJSON(urlTrack);
      const trackHit = dt?.results?.find(r => r?.artworkUrl100);
      if (trackHit?.artworkUrl100) {
        artwork = trackHit.artworkUrl100;
        break;
      }
    }

    if (!artwork) {
      return new Response(JSON.stringify({ url: "" }), {
        status: 200,
        headers: { ...noStoreHeaders, "content-type": "application/json; charset=utf-8" },
      });
    }

    const url = bumpSize(artwork, 600); // 600x600 is a sweet spot
    return new Response(JSON.stringify({ url }), {
      status: 200,
      headers: { ...noStoreHeaders, "content-type": "application/json; charset=utf-8" },
    });
  } catch {
    return new Response(JSON.stringify({ url: "" }), {
      status: 200,
      headers: { ...noStoreHeaders, "content-type": "application/json; charset=utf-8" },
    });
  }
}
