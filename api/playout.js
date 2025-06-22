
import { readFile } from 'fs/promises';
import https from 'https';

async function fetchNowPlayingFromStream() {
  return new Promise((resolve) => {
    https.get('https://streaming06.liveboxstream.uk/proxy/ayrshire/7.html', (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const parts = data.split(',');
          const track = parts.findLast(p => isNaN(p) && !p.includes('<') && p.trim().length > 1);
          resolve(track?.trim() || null);
        } catch {
          resolve(null);
        }
      });
    }).on('error', () => resolve(null));
  });
}

export default async function handler(req, res) {
  try {
    const data = await readFile('playout_log_rolling.json', 'utf-8');
    const log = JSON.parse(data);
    const now = new Date();

    const recent = log
      .filter(p => new Date(p.startTime) < now)
      .sort((a, b) => new Date(b.startTime) - new Date(a.startTime))
      .slice(0, 5)
      .map(p => ({ title: p.title || `${p.artist} - ${p.title}` }));

    const nowPlaying = await fetchNowPlayingFromStream();
    const next = log.find(p => new Date(p.startTime) > now);
    const nextToPlay = next?.title || null;

    res.status(200).json({
      nowPlaying,
      recentlyPlayed: recent,
      nextToPlay
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load playout data' });
  }
}
