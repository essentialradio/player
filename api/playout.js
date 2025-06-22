import { readFile } from 'fs/promises';
export default async function handler(req, res) {
  try {
    const data = await readFile('public/playout_log_rolling.json', 'utf-8');
    const log = JSON.parse(data);
    const now = new Date();
    const recent = log
      .filter(p => new Date(p.startTime) < now)
      .sort((a, b) => new Date(b.startTime) - new Date(a.startTime))
      .slice(0, 5)
      .map(p => ({ title: p.title || `${p.artist} - ${p.title}` }));

    res.status(200).json({
      nowPlaying: null, // handled on client via stream fetch
      recentlyPlayed: recent,
      nextToPlay: "Sleep Token - Damocles"
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load playout data' });
  }
}