async function refreshNowPlaying() {
  try {
    const res = await fetch('/api/metadata');
    const data = await res.json();

    if (data.artist && data.title) {
      document.getElementById('np-artist').textContent = data.artist;
      document.getElementById('np-title').textContent = data.title;
    } else if (data.nowPlaying) {
      // fallback: split if combined
      const [artist, title] = data.nowPlaying.split(' - ');
      document.getElementById('np-artist').textContent = artist || '';
      document.getElementById('np-title').textContent = title || '';
    }
  } catch (err) {
    console.error('NowPlaying refresh failed', err);
  }
}

setInterval(refreshNowPlaying, 15000); // every 15s
refreshNowPlaying();
