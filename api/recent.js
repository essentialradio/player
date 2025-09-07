// --- replace this helper in api/recent.js ---
async function fetchJSON(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  // be tolerant if the server ever serves text
  const text = await res.text();
  try { return JSON.parse(text); } catch { throw new Error("Invalid JSON at " + url); }
}

async function fetchRollingJSON(req) {
  // Try root first (your current setup), then /public as a fallback
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host  = req.headers["x-forwarded-host"] || req.headers.host;
  const base  = `${proto}://${host}`;
  const tries = [
    `${base}/playout_log_rolling.json?ts=${Date.now()}`,          // repo root
    `${base}/public/playout_log_rolling.json?ts=${Date.now()}`,   // /public fallback
  ];

  let lastErr;
  for (const u of tries) {
    try { return await fetchJSON(u); }
    catch (e) { lastErr = e; /* try next */ }
  }
  throw lastErr || new Error("rolling fetch failed");
}
