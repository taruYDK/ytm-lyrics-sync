// YT Music 歌詞シンクロ - player bridge v2.0.0
// MAIN world から YouTube Music プレイヤー本体の状態を毎フレーム取得する。
(() => {
  'use strict';
  // Talks to the extension only through events named with a key traded before the page's
  // scripts run (see bridge-channel.js). Built-ins are captured now, so later page scripts
  // cannot patch them to read or fake the messages.
  const ATTR = 'data-ytmls-bridge-key';
  const dispatch = EventTarget.prototype.dispatchEvent, listen = EventTarget.prototype.addEventListener;
  const CustomEventCtor = CustomEvent, stringify = JSON.stringify, parse = JSON.parse;
  const detailOf = Object.getOwnPropertyDescriptor(CustomEvent.prototype, 'detail').get;
  const root = document.documentElement;
  let key = root.getAttribute(ATTR);
  if (key) root.removeAttribute(ATTR);
  else { key = crypto.randomUUID(); root.setAttribute(ATTR, key); }
  const post = message => dispatch.call(document, new CustomEventCtor(`ytmls-bridge-out-${key}`, {detail: stringify(message)}));

  function readNumber(fn) {
    try {
      const value = Number(fn());
      return Number.isFinite(value) ? value : null;
    } catch (_) {
      return null;
    }
  }

  let enabled = true, metadataAt = -Infinity, metadata = null, metadataPlayer = null;
  function publish(forceMetadata = false) {
    if (!enabled) return;
    const sampledAt = performance.now();
    const player = document.getElementById('movie_player');
    if (!player) return;

    if (forceMetadata || player !== metadataPlayer || sampledAt - metadataAt >= 250) {
      try { metadata = typeof player.getVideoData === 'function' ? player.getVideoData() : null; } catch (_) { metadata=null; }
      metadataAt=sampledAt;metadataPlayer=player;
    }
    const data = metadata;

    const apiCurrentTime = readNumber(() => player.getCurrentTime());
    const duration = readNumber(() => player.getDuration());
    const playerState = readNumber(() => player.getPlayerState());
    const playbackRate = readNumber(() => typeof player.getPlaybackRate === 'function' ? player.getPlaybackRate() : 1);
    const videoId = data && data.video_id ? String(data.video_id) : '';
    const title = data && data.title ? String(data.title) : '';
    const artist = data && (data.author || data.artist) ? String(data.author || data.artist) : '';
    const volume = readNumber(() => player.getVolume());
    let muted = null;
    try { muted = typeof player.isMuted === 'function' ? Boolean(player.isMuted()) : null; } catch (_) {}

    // 通常再生中は実videoの currentTime が最も高精度で、毎フレーム滑らかに進む。
    // ただし自動次曲では前曲videoが一瞬残るため、Player API と0.75秒以上食い違う
    // media時刻は旧曲とみなし、Player APIへフォールバックする。
    let media = null;
    try {
      media = player.querySelector('video.html5-main-video') || player.querySelector('video');
    } catch (_) {}
    const mediaCurrentTime = media ? readNumber(() => media.currentTime) : null;
    const mediaUsable = Boolean(
      media &&
      !media.ended &&
      mediaCurrentTime != null &&
      (apiCurrentTime == null || Math.abs(mediaCurrentTime - apiCurrentTime) <= 0.75)
    );

    const currentTime = mediaUsable ? mediaCurrentTime : apiCurrentTime;
    const timeSource = mediaUsable ? 'media' : 'player-api';

    if (!videoId && currentTime == null && duration == null) return;

    post({
      type: 'snapshot',
      payload: {
        videoId,
        title,
        artist,
        currentTime,
        duration,
        playerState,
        playbackRate,
        volume,
        muted,
        timeSource,
        sampledAt,
        wallTime: Date.now()
      }
    });
  }

  listen.call(document, `ytmls-bridge-in-${key}`, (event) => {
    let message;
    try { message = parse(detailOf.call(event)); } catch (_) { return; }
    if (!message || typeof message !== 'object') return;
    if (message.type === 'tracking-config') {enabled=message.enabled===true;if(enabled){publish(true);schedule();}else{clearTimeout(timer);timer=null;}return;}
    // The queue's songs (the Mac-style Up Next panel): YouTube Music loads their pictures only when
    // the queue is on screen, so the picture addresses and video ids come from its own item data.
    if (message.type === 'queue-info') {
      const list = [...document.querySelectorAll('ytmusic-player-queue-item')].map(item => {
        let data = null;
        try { data = item.data || item.__data?.data || null; } catch (_) {}
        const thumbs = Array.isArray(data?.thumbnail?.thumbnails) ? data.thumbnail.thumbnails : [];
        const small = thumbs.filter(t => t && typeof t.url === 'string').sort((a, b) => (a.width || 0) - (b.width || 0));
        const pick = small.find(t => (t.width || 0) >= 88) || small.at(-1) || null;
        return {videoId: typeof data?.videoId === 'string' ? data.videoId : '', thumb: pick ? String(pick.url) : ''};
      });
      post({type: 'queue-info', payload: list});
      return;
    }
    // Volume (the Mac-style toolbar and Now Playing screen): 0-100, through the player itself so
    // YouTube Music's own volume stays in step. Not tied to a song.
    if (message.type === 'set-volume' || message.type === 'toggle-mute') {
      const player = document.getElementById('movie_player');
      if (!player) return;
      try {
        if (message.type === 'toggle-mute') { if (player.isMuted()) player.unMute(); else player.mute(); }
        else {
          const value = Math.round(Math.min(100, Math.max(0, Number(message.payload?.volume))));
          if (!Number.isFinite(value)) return;
          player.setVolume(value);
          if (value > 0 && player.isMuted()) player.unMute();
        }
      } catch (_) {}
      publish(true);
      return;
    }
    if (!['seek', 'toggle-playback'].includes(message.type) || !enabled) return;
    const payload = message.payload || {};
    const requestedVideoId = String(payload.videoId || '');
    const requestedTime = Number(payload.time);
    if (!requestedVideoId || (message.type === 'seek' && !Number.isFinite(requestedTime))) return;

    const player = document.getElementById('movie_player');
    if (!player) return;
    let data = null;
    try { data = typeof player.getVideoData === 'function' ? player.getVideoData() : null; } catch (_) {}
    const actualVideoId = data && data.video_id ? String(data.video_id) : '';
    // 表示している歌詞と実再生曲が一致する時だけseekする。古いvideo要素には触れない。
    if (!actualVideoId || actualVideoId !== requestedVideoId) return;
    try {
      if (message.type === 'toggle-playback') {
        const state = readNumber(() => player.getPlayerState());
        if (state === null) return;
        if (state === 1 || state === 3) player.pauseVideo();
        else player.playVideo();
        return;
      }
      if (typeof player.seekTo === 'function') player.seekTo(Math.max(0, requestedTime), true);
    } catch (_) {}
  }, false);

  let timer = null;
  function schedule() {
    if (!enabled || timer !== null) return;
    timer=setTimeout(()=>{timer=null;publish();schedule();},34);
  }
  publish(true);schedule();
  window.addEventListener('yt-navigate-finish', ()=>publish(true), true);
  document.addEventListener('ytmd-player-state-change', ()=>publish(true), true);
})();
