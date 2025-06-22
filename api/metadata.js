
export default async function handler(req, res) {
  try {
    const response = await fetch("https://streaming06.liveboxstream.uk/proxy/ayrshire/7.html");
    const text = await response.text();
    const parts = text.split(",");
    const nowPlaying = parts.findLast(p => isNaN(p) && !p.includes("<") && p.trim().length > 1);

    if (nowPlaying) {
      res.status(200).json({ nowPlaying: nowPlaying.trim() });
    } else {
      res.status(200).json({ nowPlaying: "Unknown Track" });
    }
  } catch (error) {
    res.status(500).json({ error: "Failed to load metadata" });
  }
}
