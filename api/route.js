
export async function GET() {
  try {
    const res = await fetch("https://streaming06.liveboxstream.uk/proxy/ayrshire/7.html");
    let text = await res.text();

    // Remove HTML tags
    text = text.replace(/<[^>]*>/g, '');

    const parts = text.split(',');
    const track = parts.findLast(p => isNaN(p) && p.trim().length > 1);
    const decodeHtml = (s) => s.replace(/&amp;/g, '&')
                               .replace(/&lt;/g, '<')
                               .replace(/&gt;/g, '>')
                               .replace(/&quot;/g, '"')
                               .replace(/&#039;/g, "'");

    const nowPlaying = track ? decodeHtml(track.trim()) : "Unknown Track";

    // Attempt to generate artwork URL via iTunes API
    let artwork = null;
    if (nowPlaying !== "Unknown Track") {
      const searchUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(nowPlaying)}&limit=1`;
      const artRes = await fetch(searchUrl);
      const artData = await artRes.json();
      if (artData.results && artData.results.length > 0) {
        artwork = artData.results[0].artworkUrl100.replace("100x100", "300x300");
      }
    }

    return new Response(JSON.stringify({ nowPlaying, artwork }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (err) {
    return new Response(JSON.stringify({
      nowPlaying: "Unable to fetch metadata",
      artwork: null
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
