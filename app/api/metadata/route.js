export async function GET() {
  try {
    const fs = await import("fs/promises");
    const path = await import("path");

    const filePath = path.resolve("./playout_log_rolling.json");
    const data = await fs.readFile(filePath, "utf-8");
    const json = JSON.parse(data);

    // Grab the most recent track entry
    const latest = json[json.length - 1];

    return new Response(JSON.stringify(latest), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Metadata not found" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
