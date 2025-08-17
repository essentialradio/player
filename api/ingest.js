// api/ingest.js
// Accepts JSON from playout: { artist, title, duration?, startTime? }
// Saves a canonical record to Upstash Redis (key: np:latest) with a TTL.

export default async function handler(req, res) {
  // CORS + no-cache
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    return res.status(204).end();
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const TTL_SECONDS = 15 * 60; // keep it fresh; playout will refresh often

  const decode = (s) =>
    String(s ?? "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/&nbsp;/g, " ");

  const clean = (s) =>
    decode(s)
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .replace(/\s*[–—-]\s*/g, " – ")
      .replace(/\s+/g, " ")
      .trim();

  try {
    // Body (works for PlayIt Live posting JSON)
    const body =
      req.body ||
      (await new Promise((resolve, reject) => {
        let data = "";
        req.on("data", (c) => (data += c));
        req.on("end", () => {
          try {
            resolve(JSON.parse(data || "{}"));
          } catch (e) {
            reject(e);
          }
        });
      }));

    const artist = clean(body.artist);
    const title = clean(body.title);
    if (!artist || !title) {
      return res.status(400).json({ error: "artist and title are required" });
    }

    // duration (seconds, optional)
    let duration = null;
    if (body.duration !== undefined && body.duration !== null) {
      const n = Number(body.duration);
      if (Number.isFinite(n) && n >= 0) duration = Math.round(n);
    }

    // times
    const serverNowISO = new Date().toISOString();
    const startTime = body.startTime ? String(body.startTime) : serverNowISO;
    let endTime = null;
    if (duration != null) {
      const t0 = new Date(startTime).getTime();
      if (Number.isFinite(t0)) endTime = new Date(t0 + duration * 1000).toISOString();
    }

    const record = {
      artist,
      title,
      nowPlaying: `${artist} - ${title}`,
      duration,            // seconds or null
      startTime,           // ISO
      endTime,             // ISO or null
      ts: serverNowISO,    // server-receipt timestamp
      source: "ingest",
      v: 2
    };

    // Save to Upstash Redis
    const base = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!base || !token) {
      return res.status(500).json({ error: "Upstash env missing" });
    }

    // Use REST "SET" with expiry
    const form = new URLSearchParams({
      key: "np:latest",
      value: JSON.stringify(record),
      EX: String(TTL_SECONDS),
    });

    const r = await fetch(`${base}/set`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });

    if (!r.ok) {
      return res
        .status(502)
        .json({ error: `Upstash SET failed ${r.status}` });
    }

    return res.status(200).json({ ok: true, saved: record });
  } catch (e) {
    return res.status(500).json({ error: "Server error" });
  }
}
