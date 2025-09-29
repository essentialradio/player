// /api/artwork.js
export default async function handler(req, res) {
  try {
    const { artist = "", title = "" } = req.query;
    const q = encodeURIComponent(
      `${artist} ${title}`.replace(/\s+(ft|feat)\.?\s+.+$/i, "")
    );
    const r = await fetch(
      `https://itunes.apple.com/search?term=${q}&media=music&limit=1`
    );
    const d = await r.json();
    const raw = d?.results?.[0]?.artworkUrl100 || "";
    if (!raw) return res.status(200).json({ url: "" });
    const url = raw.replace(/100x100bb?\.jpg/i, "300x300bb.jpg");
    res.status(200).json({ url });
  } catch (err) {
    res.status(200).json({ url: "" });
  }
}
