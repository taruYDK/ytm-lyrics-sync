  // Same-origin, anonymous YouTube Music requests. Never forward cookies or auth tokens.
  const nativeLyricsWarnings = new Map();
  function reportNativeLyricsFailure(endpoint, reason, status) {
    const key = endpoint + ':' + reason;
    const now = Date.now();
    if (nativeLyricsWarnings.has(key) && now - nativeLyricsWarnings.get(key) < 60000) return;
    nativeLyricsWarnings.set(key, now);
    // Never log response bodies, request URLs, lyrics, track IDs or authentication data.
    const code = Number.isInteger(status) && status >= 100 && status <= 599 ? ' HTTP ' + status : '';
    const message = '[YTMLS] YouTube Music: ' + endpoint + ' ' + reason + code;
    if (reason === 'lyrics-tab-unavailable' || reason === 'timed-lyrics-unavailable') console.info(message);
    else console.warn(message);
  }
  function nativeLyricsBrowseId(response) {
    const tabs = response?.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer?.watchNextTabbedResultsRenderer?.tabs;
    if (!Array.isArray(tabs)) return null;
    for (const item of tabs) {
      const tab = item?.tabRenderer, endpoint = tab?.endpoint?.browseEndpoint;
      const kind = endpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType;
      if (!tab?.unselectable && kind === 'MUSIC_PAGE_TYPE_TRACK_LYRICS' && typeof endpoint.browseId === 'string') return endpoint.browseId;
    }
    return null;
  }

  function parseNativeTimedLyrics(response) {
    const data = response?.contents?.elementRenderer?.newElement?.type?.componentType?.model?.timedLyricsModel?.lyricsData;
    if (!Array.isArray(data?.timedLyricsData)) return null;
    const lines = data.timedLyricsData.map(item => {
      const cue = item?.cueRange;
      const start = cue?.startTimeMilliseconds, end = cue?.endTimeMilliseconds;
      if (start == null || end == null || start === '' || end === '') return null;
      const time = Number(start)/1000, finish = Number(end)/1000;
      if (typeof item.lyricLine !== 'string' || !item.lyricLine.trim() || !Number.isFinite(time) || !Number.isFinite(finish) || time < 0 || finish <= time) return null;
      return {text:item.lyricLine,time,end:finish};
    }).filter(Boolean).sort((a,b)=>a.time-b.time);
    if (!lines.length) return null;
    return {lines,syncLevel:'line',_source:'YouTube Music',_providerKey:'youtubeMusic'};
  }

  async function fetchFromYouTubeMusic(info, duration, trackKey) {
    if (!/^[A-Za-z0-9_-]{11}$/.test(info.videoId || '') || trackKey !== STATE.lastTrackKey) return null;
    const current = () => trackKey === STATE.lastTrackKey && STATE.enabled !== false && STATE.providerEnabled.youtubeMusic !== false;
    async function request(endpoint, clientName, clientVersion, payload) {
      const controller = new AbortController();
      const timer = setTimeout(()=>controller.abort(),5000);
      try {
        const response = await fetch('https://music.youtube.com/youtubei/v1/' + endpoint + '?prettyPrint=false', {
          method:'POST',credentials:'omit',cache:'no-store',signal:controller.signal,
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({context:{client:{clientName,clientVersion,hl:'ja',gl:'JP'}},...payload}),
        });
        if (!response.ok) {
          if (current()) reportNativeLyricsFailure(endpoint, 'request-failed', response.status);
          return null;
        }
        try { return await response.json(); }
        catch (_) {
          if (current()) reportNativeLyricsFailure(endpoint, 'invalid-json');
          return null;
        }
      } catch (error) {
        if (current()) reportNativeLyricsFailure(endpoint, error?.name === 'AbortError' ? 'timeout' : 'network-error');
        return null;
      } finally {clearTimeout(timer);}
    }
    try {
      if (!current()) return null;
      const next = await request('next','WEB_REMIX','1.20240101.01.00',{videoId:info.videoId});
      if (!current() || !next) return null;
      const browseId = nativeLyricsBrowseId(next);
      if (!browseId) { reportNativeLyricsFailure('next', 'lyrics-tab-unavailable'); return null; }
      const lyrics = await request('browse','ANDROID_MUSIC','7.21.50',{browseId});
      if (!current() || !lyrics) return null;
      const result = parseNativeTimedLyrics(lyrics);
      if (!result) reportNativeLyricsFailure('browse', 'timed-lyrics-unavailable');
      return result;
    } catch (_) {
      if (current()) reportNativeLyricsFailure('provider', 'processing-error');
      return null;
    }
  }
