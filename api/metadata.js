export async function GET() {
  try {
    const res = await fetch("https://streaming06.liveboxstream.uk/proxy/ayrshire/7.html");
    let text = await res.text();

    // Remove stray HTML tags
    text = text.replace(/<[^>]*>/g, '');

    // Extract final non-numeric, meaningful string
    const parts = text.split(',');
    const track = parts.findLast(p => isNaN(p) && p.trim().length > 1);

    // Decode common HTML entities
    const decodeHtml = (s) => s.replace(/&amp;/g, '&')
                               .replace(/&lt;/g, '<')
                               .replace(/&gt;/g, '>')
                               .replace(/&quot;/g, '"')
                               .replace(/&#039;/g, "'");

    return new Response(JSON.stringify({
      nowPlaying: track ? decodeHtml(track.trim()) : "Unknown Track"
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'  // <-- ADD THIS LINE
      }
    });
  } catch (err) {
    return new Response(JSON.stringify({
      nowPlaying: "Unable to fetch metadata"
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'  // <-- ADD THIS LINE HERE TOO
      }
    });
  }
}
