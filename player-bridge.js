// YT Music 歌詞シンクロ - player bridge v2.0.0
// MAIN world から YouTube Music プレイヤー本体の状態を毎フレーム取得する。
(() => {
  'use strict';
  const SOURCE = 'ytmls-player-bridge-v1';

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

    window.postMessage({
      source: SOURCE,
      type: 'snapshot',
      payload: {
        videoId,
        title,
        artist,
        currentTime,
        duration,
        playerState,
        playbackRate,
        timeSource,
        sampledAt,
        wallTime: Date.now()
      }
    }, '*');
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const message = event.data;
    if (!message || message.source !== SOURCE) return;
    if (message.type === 'tracking-config') {enabled=message.enabled===true;if(enabled){publish(true);schedule();}else{clearTimeout(timer);timer=null;}return;}
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
