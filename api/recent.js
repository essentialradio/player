
import fs from 'fs';
import path from 'path';

// Location of your rolling log relative to the repo root (serverless runtime)
const DATA_FILE = path.join(process.cwd(), 'playout_log_rolling.json');

function safeReadJSON(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

// Normalise a single row from Python output into a UI-friendly object
function normaliseRow(row) {
  const artist = row.Artist ?? row.artist ?? '';
  const title  = row.Title  ?? row.title  ?? '';
  const source = row.Source ?? row.source ?? 'PLAYIT';

  // Prefer 'Start ISO' when present — exact timestamp (Python wrote it)
  let startISO = row['Start ISO'] || row['startISO'] || null;
  let startMs = null;

  if (startISO) {
    const d = new Date(startISO);
    if (!Number.isNaN(d.getTime())) {
      startISO = d.toISOString();
      startMs = d.getTime();
    } else {
      startISO = null;
    }
  }

  // Fallback: derive from 'Hour' (UTC) + 'Scheduled Time' (HH:MM, local)
  if (!startISO) {
    const hourStr = row.Hour || row.hour;
    const schedStr = row['Scheduled Time'] || row['Displayed Time'] || row.scheduled || null;

    if (hourStr && schedStr && /^\d{2}:\d{2}$/.test(schedStr)) {
      const base = new Date(hourStr); // UTC hour boundary e.g. "...T14:00:00Z"
      if (!Number.isNaN(base.getTime())) {
        const [hh, mm] = schedStr.split(':').map(n => parseInt(n, 10));
        // Interpret Scheduled Time as hours/minutes to set ON the UTC base.
        // This matches previous behaviour and avoids TZ libs in serverless.
        base.setUTCHours(Number.isFinite(hh) ? hh : 0, Number.isFinite(mm) ? mm : 0, 0, 0);
        startISO = base.toISOString();
        startMs = base.getTime();
      }
    }
  }

  // Duration is optional; keep as number if provided
  let durationSec = row['Duration (s)'] ?? row.duration ?? null;
  if (durationSec != null) {
    const n = Number(durationSec);
    durationSec = Number.isFinite(n) ? n : null;
  }

  return {
    artist,
    title,
    source,
    startISO,
    startMs,
    duration: durationSec,
  };
}

export default function handler(req, res) {
  const debug = (req.query?.debug ?? '') === '1' || (req.query?.debug ?? '').toLowerCase() === 'true';

  // Load rows
  const rowsRaw = safeReadJSON(DATA_FILE);

  // Normalise and drop rows without any time
  let rows = rowsRaw.map(normaliseRow).filter(r => Number.isFinite(r.startMs));

  // Sort newest first
  rows.sort((a, b) => b.startMs - a.startMs);

  // Query params
  const qLimit = Number.parseInt(req.query?.limit ?? '', 10);
  const qDays  = Number.parseInt(req.query?.days  ?? '', 10);

  // Optional filter by last N days (e.g., ?days=14)
  if (Number.isFinite(qDays) && qDays > 0) {
    const cutoffMs = Date.now() - qDays * 24 * 60 * 60 * 1000;
    rows = rows.filter(r => r.startMs >= cutoffMs);
  }

  // Apply limit (default high enough for ~two weeks)
  const limit = Number.isFinite(qLimit) && qLimit > 0 ? qLimit : 3500;
  const out = rows.slice(0, limit);

  // Headers
  res.setHeader('Cache-Control', 'no-store, no-cache, max-age=0, s-maxage=0, must-revalidate');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (debug) {
    const counts = out.reduce((acc, r) => {
      acc[r.source] = (acc[r.source] || 0) + 1;
      return acc;
    }, {});
    return res.status(200).json({
      items: out,
      debug: {
        totalRead: rowsRaw.length,
        totalNormalised: rows.length,
        returned: out.length,
        counts,
        limit,
        days: Number.isFinite(qDays) && qDays > 0 ? qDays : null,
        file: DATA_FILE,
      }
    });
  }

  return res.status(200).json(out);
}
