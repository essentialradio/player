export async function GET() {
  try {
    const res = await fetch("https://streaming06.liveboxstream.uk/proxy/ayrshire/7.html");
    const text = await res.text();
    
    const parts = text.split(',');
    const track = parts.findLast(p => isNaN(p) && p.trim().length > 2);

    return new Response(JSON.stringify({
      nowPlaying: track ? track.trim() : "Unknown Track"
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({
      nowPlaying: "Unable to fetch metadata"
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
