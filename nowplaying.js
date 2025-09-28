/*! nowplaying.patched.js */
// Time helpers (Europe/London)
function toMinutes(hhmm){ try{var p=hhmm.split(':');return parseInt(p[0],10)*60+parseInt(p[1],10);}catch(e){return 0;} }
function nowInLondon() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
  const minutes = parseInt(map.hour, 10) * 60 + parseInt(map.minute, 10);
  return { day: map.weekday, minutesFromMidnight: minutes };
}

const NowPlaying = (function(){
  let cfg = {
    scheduleUrl: '',
    showTitleSel: '#showTitle',
    presenterSel: '#showPresenter',
    sourceSel: '#showSource',
    artworkImgSel: '#artwork', // patched default
    statusSel: '#npStatus',
    appVersion: 'v1',
    refreshMs: 60*1000
  };

  async function fetchJSON(url){
    const r = await fetch(url + (url.includes('?') ? '&' : '?') + 'v=' + encodeURIComponent(cfg.appVersion), { cache: 'no-store' });
    if(!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }

  function matchSlot(list){
    const ctx = nowInLondon(); // day & minutes in Europe/London
    const day = ctx.day; // e.g., "Sun"
    const minsNow = ctx.minutesFromMidnight;
    let hit = null;
    for(const item of list){
      const days = item.days || (item.day ? [item.day] : []);
      if(days.length && !days.includes(day)) continue;
      const s = toMinutes(item.start || item.startTime || "00:00");
      const e = toMinutes(item.end || item.endTime || "00:00");
      const end = (e <= s) ? (e + 1440) : e; // cross-midnight
      const nowM = (minsNow < s) ? minsNow + 1440 : minsNow;
      if(nowM >= s && nowM < end){ hit = {item, s, end}; break; }
    }
    return hit;
  }

  function setText(sel, text){
    const el = document.querySelector(sel); if(el) el.textContent = text || '';
  }

  async function setArtwork(title){
    try{
      const img = document.querySelector(cfg.artworkImgSel);
      if(!img) return;
      if(!title){ img.src = (window.DEFAULT_COVER_URL || 'essential-radio-logo.png'); return; }
      // iTunes search by show title
      const r = await fetch('https://itunes.apple.com/search?term=' + encodeURIComponent(title) + '&media=music&entity=album&limit=1');
      const j = await r.json();
      const url = (j.results && j.results[0] && j.results[0].artworkUrl100) ? j.results[0].artworkUrl100.replace('100x100','300x300') : null;
      img.src = url || (window.DEFAULT_COVER_URL || 'essential-radio-logo.png');
    }catch(e){}
  }

  async function refresh(){
    try{
      const data = await fetchJSON(cfg.scheduleUrl);
      const list = Array.isArray(data) ? data : (data.schedule || []);
      const hit = matchSlot(list || []);
      if(hit){
        const {item, s, end} = hit;
        const title = item.title || item.show || 'Now Playing';
        const presenter = item.presenter || item.dj || '';
        const source = (item.source || 'MAIN').toUpperCase();
        setText(cfg.showTitleSel, title);
        setText(cfg.presenterSel, presenter ? ('by ' + presenter) : '');
        setText(cfg.sourceSel, source);
        setText(cfg.statusSel, item.fixed ? 'fixed slot' : '');
        setArtwork(title);
      }else{
        setText(cfg.showTitleSel, 'More music soon');
        setText(cfg.presenterSel, '');
        setText(cfg.sourceSel, 'MAIN');
        setText(cfg.statusSel, 'non-fixed slot');
        setArtwork('');
      }
    }catch(e){
      // fallback
      setText(cfg.showTitleSel, 'More music soon');
      setText(cfg.presenterSel, '');
      setText(cfg.sourceSel, 'MAIN');
      setText(cfg.statusSel, '');
    }
  }

  function init(userCfg){
    cfg = Object.assign({}, cfg, userCfg||{});
    refresh();
    setInterval(refresh, Math.max(60*1000, cfg.refreshMs || 60*1000));
  }

  return { init };
})();
