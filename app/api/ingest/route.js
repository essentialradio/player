export async function POST(request) {
  try {
    const fs = await import("fs/promises");
    const path = await import("path");

    const body = await request.json();
    const filePath = path.resolve("./playout_log_rolling.json");

    // Read existing log
    let log = [];
    try {
      const existing = await fs.readFile(filePath, "utf-8");
      log = JSON.parse(existing);
    } catch {
      log = [];
    }

    // Append new entry
    log.push(body);

    // Write back
    await fs.writeFile(filePath, JSON.stringify(log, null, 2), "utf-8");

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to ingest" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
