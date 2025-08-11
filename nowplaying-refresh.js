async function refreshNowPlaying() {
  try {
    const res = await fetch(`https://www.essential.radio/api/metadata?ts=${Date.now()}`, {
      cache: 'no-store'
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const nowPlayingContainer = document.getElementById("nowPlaying");
    if (!nowPlayingContainer) return;

    let nowPlayingText = "";
    if (data.nowPlaying && data.nowPlaying.trim() !== "") {
      // Preserve the LIVE + flashing dot at the start
      nowPlayingText = `<span class="live-indicator">NOW PLAYING <span class="dot"></span></span> ${data.nowPlaying} on Essential Radio`;

      // Schedule "More Music Soon" once track ends
      if (data.duration && Number.isFinite(data.duration)) {
        clearTimeout(window._moreMusicSoonTimeout);
        window._moreMusicSoonTimeout = setTimeout(() => {
          nowPlayingContainer.innerHTML = `<span class="live-indicator">NOW PLAYING <span class="dot"></span></span> More Music Soon on Essential Radio`;
        }, data.duration * 1000);
      }
    } else {
      nowPlayingText = `<span class="live-indicator">NOW PLAYING <span class="dot"></span></span> More Music Soon on Essential Radio`;
    }

    nowPlayingContainer.innerHTML = nowPlayingText;

  } catch (err) {
    console.error("Error refreshing now playing:", err);
  }
}

// Initial load
refreshNowPlaying();

// Poll every 30 seconds
setInterval(refreshNowPlaying, 30000);

// Update immediately when window regains focus
window.addEventListener("focus", refreshNowPlaying);
