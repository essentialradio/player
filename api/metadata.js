// api/metadata.js
// Front-end polls here. We return { artist, title, nowPlaying, duration?, startTime?, source }.
// 1) Prefer the ingested record from Redis (np:latest)
// 2) Fallback to latestTrack.json (GitHub Pages)
// 3) Fallback to Livebox "7.html" and robustly glue comma-split artist names

export default async function handler(req, res) {
  // CORS + no-cache
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    return res.status(204).end();
  }
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const H = { "Content-Type": "application/json" };

  const decode = (s) =>
    String(s ?? "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/&nbsp;/g, " ");

  const clean = (s) =>
    String(s ?? "")
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .replace(/\s*[–—-]\s*/g, " – ")
      .replace(/\s+/g, " ")
      .trim();

  const looksLikeTrack = (s) => {
    const l = clean(s);
    return /^(.*?)\s+[–—-]\s+(.*)$/.test(l) || // Artist – Title
           /^(.*?)\s+by\s+(.*)$/i.test(l) ||   // Title by Artist
           /^(.*?)\s*:\s*(.*)$/.test(l);       // Artist: Title
  };

  function splitCombined(s) {
    const line = clean(s);
    if (!line) return { artist: "", title: "" };
    let m = line.match(/^(.*?)\s+[–—-]\s+(.*)$/);
    if (m) return { artist: clean(m[1]), title: clean(m[2]) };
    m = line.match(/^(.*?)\s*:\s*(.*)$/);
    if (m) return { artist: clean(m[1]), title: clean(m[2]) };
    m = line.match(/^(.*?)\s+by\s+(.*)$/i);
    if (m) return { artist: clean(m[2]), title: clean(m[1]) };
    return { artist: "", title: line };
  }

  // Rebuild artist if Livebox split it on commas before the dash
  function glueLivebox(html) {
    const plain = html.replace(/<[^>]*>/g, "");
    const cells = plain.split(",");
    let start = -1, joined = "";

    // find rightmost track-like segment
    for (let i = cells.length - 1; i >= 0; i--) {
      const cand = cells.slice(i).join(",").trim();
      if (looksLikeTrack(cand)) { start = i; joined = cand; break; }
    }

    // fallback: take last non-numeric-ish cell + tail
    if (start === -1) {
      for (let i = cells.length - 1; i >= 0; i--) {
        const c = (cells[i] || "").trim();
        if (c && isNaN(c) && c.length > 1) {
          start = i;
          joined = (i < cells.length - 1) ? (c + "," + cells.slice(i + 1).join(",")).trim() : c;
          break;
        }
      }
    }
    if (start === -1) joined = plain.trim();

    // If we have "left – right", pull any preceding artist fragments split by commas
    const m = joined.match(/^(.*?)\s+([–—-])\s+(.*)$/);
    if (m) {
      let left = m[1].trim();
      const dash = m[2];
      const right = m[3].trim();
      let k = start - 1, steps = 0;
      const parts = [];
      while (k >= 0 && steps < 8) {
        let prev = String(cells[k] || "").trim();
        if (!prev || prev.length > 50 || /[0-9]{3,}/.test(prev) || /[–—-]/.test(prev)) break;
        prev = prev.replace(/^,+\s*/, "").replace(/\s*,+\s*$/, "");
        if (/^[A-Za-z][A-Za-z '&.-]*$/.test(prev)) { parts.unshift(prev); k--; steps++; continue; }
        break;
      }
      if (parts.length) left = (parts.join(", ") + (left ? ", " : "")) + left;
      joined = `${left} ${dash} ${right}`;
    }
    return clean(decode(joined));
  }

  // --- Try Redis (preferred) ---
  async function fromRedis() {
    const base = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!base || !token) return null;
    try {
      const r = await fetch(`${base}/get/${encodeURIComponent("np:latest")}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!r.ok) return null;
      const j = await r.json().catch(() => null);
      const rec = j?.result ? JSON.parse(j.result) : null;
      if (rec?.artist && rec?.title) {
        const artist = clean(decode(rec.artist));
        const title  = clean(decode(rec.title));
        return {
          artist,
          title,
          nowPlaying: `${artist} - ${title}`,
          duration: rec.duration != null ? Number(rec.duration) : null,
          startTime: rec.startTime || rec.ts || null,
          endTime: rec.endTime || null,
          source: "ingest",
        };
      }
      return null;
    } catch {
      return null;
    }
  }

  // --- Fallbacks: latestTrack.json + Livebox ---
  async function fromFallbacks() {
    const [ltResp, lbResp] = await Promise.allSettled([
      fetch("https://essentialradio.github.io/player/latestTrack.json?_=" + Date.now(), { cache: "no-store" }),
      fetch("https://streaming06.liveboxstream.uk/proxy/ayrshire/7.html",               { cache: "no-store" }),
    ]);

    let lt = null, lbText = null;
    if (ltResp.status === "fulfilled" && ltResp.value.ok) lt = await ltResp.value.json().catch(() => null);
    if (lbResp.status === "fulfilled" && lbResp.value.ok) lbText = await lbResp.value.text().catch(() => null);

    let la = clean(decode(lt?.artist));
    let ltit = clean(decode(lt?.title));
    let lnp = clean(decode(lt?.nowPlaying));
    if ((!la || !ltit) && lnp) {
      const g = splitCombined(lnp);
      la ||= g.artist;
      ltit ||= g.title;
    }

    let lbArtist = "", lbTitle = "", lbCombined = "";
    if (lbText) {
      const glued = glueLivebox(lbText);
      const p = splitCombined(glued);
      lbArtist = p.artist; lbTitle = p.title;
      lbCombined = (p.artist && p.title) ? `${p.artist} - ${p.title}` : glued;
    }

    let artist = "", title = "", duration = null, startTime = null, source = "unknown", combined = "";
    if (lbArtist || lbTitle) {
      artist = lbArtist; title = lbTitle; combined = lbCombined; source = "livebox";
      // If titles match latestTrack, borrow timing/duration
      const titlesMatch = ltit && lbTitle && ltit.toLowerCase() === lbTitle.toLowerCase();
      if (titlesMatch) {
        if (lt?.duration != null) duration = Number(lt.duration) || null;
        if (lt?.startTime) startTime = lt.startTime;
      }
    } else if (la || ltit) {
      artist = la || ""; title = ltit || "";
      combined = (la && ltit) ? `${la} - ${ltit}` : (lnp || "");
      duration = lt?.duration != null ? Number(lt.duration) : null;
      startTime = lt?.startTime || null;
      source = "latestTrack";
    } else {
      combined = lnp || lbCombined || "";
    }

    if ((!artist || !title) && combined) {
      const g = splitCombined(combined);
      artist ||= g.artist;
      title  ||= g.title;
      if (!source) source = "combined";
    }

    return {
      artist,
      title,
      nowPlaying: (artist && title) ? `${artist} - ${title}` : combined,
      duration: duration ?? null,
      startTime: startTime || null,
      endTime: null,
      source,
    };
  }

  try {
    const primary = await fromRedis();
    if (primary) return res.status(200).json(primary);
    const fallback = await fromFallbacks();
    return res.status(200).json(fallback);
  } catch (e) {
    return res.status(500).json({ error: "Server error" });
  }
}
