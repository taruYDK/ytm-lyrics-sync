  // ---------- YouTube Player 本体とのブリッジ ----------
  // DOM上の <video> は自動次曲時に前曲要素が残ることがあるため、
  // MAIN world の #movie_player API が返す videoId/currentTime を最優先する。
  const PLAYER_BRIDGE_SOURCE = "ytmls-player-bridge-v1";

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== PLAYER_BRIDGE_SOURCE || data.type !== "snapshot") return;
    const payload = data.payload || {};
    const currentTime = Number(payload.currentTime);
    const duration = Number(payload.duration);
    const playerState = Number(payload.playerState);
    const playbackRate = Number(payload.playbackRate);
    const sampledAtRaw = Number(payload.sampledAt);
    const now = performance.now();
    const videoId = String(payload.videoId || "");
    const rate = Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1;

    // v1.7.0: v1.6.9 の「実測値へ22%ずつ寄せる」平滑化は、
    // Player API の値が少し揺れたり量子化される曲で位相遅れを作り、
    // 見た目は滑らかでも歌詞が音より遅れる原因になっていた。
    // MAIN world 側で毎フレーム採った高精度時刻をそのまま基準にし、
    // message配送から描画までのごく短い経過時間だけ補う。
    const sampledAt = Number.isFinite(sampledAtRaw) && Math.abs(now - sampledAtRaw) < 2000
      ? sampledAtRaw
      : now;

    STATE.playerSnapshot = {
      videoId,
      title: String(payload.title || ""),
      artist: String(payload.artist || ""),
      currentTime: Number.isFinite(currentTime) ? currentTime : null,
      duration: Number.isFinite(duration) ? duration : null,
      playerState: Number.isFinite(playerState) ? playerState : null,
      playbackRate: rate,
      timeSource: String(payload.timeSource || ""),
      sampledAt,
      receivedAt: now,
    };

    // v1.7.2: 歌詞タブの開閉などで Player API の videoId が1〜数フレームだけ
    // 前曲へ戻ることがある。単発のID変化を曲変更として採用すると、歌詞を開いた瞬間に
    // 前曲へ巻き戻って見えるため、同じIDが連続して安定した時だけ確定する。
    if (videoId) {
      if (STATE.playbackIdCandidate !== videoId) {
        STATE.playbackIdCandidate = videoId;
        STATE.playbackIdCandidateSince = now;
        STATE.playbackIdCandidateCount = 1;
      } else {
        STATE.playbackIdCandidateCount += 1;
      }

      const stableId = STATE.observedPlaybackVideoId;
      const isInitial = !stableId;
      const stableEnough = STATE.playbackIdCandidateCount >= 6 && (now - STATE.playbackIdCandidateSince) >= 120;
      if (isInitial || (videoId !== stableId && stableEnough)) {
        const changedStableTrack = Boolean(stableId && videoId !== stableId);
        STATE.observedPlaybackVideoId = videoId;
        STATE.stablePlayerTitle = String(payload.title || "");
        STATE.stablePlayerArtist = String(payload.artist || "");
        STATE.stablePlayerSnapshotAt = now;
        if (changedStableTrack) {
          // 新しい曲になったら、前曲でのユーザー操作キャンセルを持ち越さない。
          cancelLyricsAutoOpen();
          updateTrackTimingControl();
          openLyricsTabForTrack(videoId);
        }
      } else if (videoId === stableId) {
        // 同じ安定曲のメタデータ更新は即反映する。
        if (payload.title) STATE.stablePlayerTitle = String(payload.title);
        if (payload.artist) STATE.stablePlayerArtist = String(payload.artist);
        STATE.stablePlayerSnapshotAt = now;
      }
    }
  }, false);

  function getFreshPlayerSnapshot(maxAgeMs = 900) {
    const snap = STATE.playerSnapshot;
    if (!snap || !Number.isFinite(snap.receivedAt)) return null;
    if (performance.now() - snap.receivedAt > maxAgeMs) return null;
    return snap;
  }

  function getStablePlaybackVideoId() {
    return String(STATE.observedPlaybackVideoId || "");
  }

  function getAuthoritativeVideoId() {
    const stable = getStablePlaybackVideoId();
    if (stable) return stable;
    const snap = getFreshPlayerSnapshot();
    if (snap && snap.videoId) return String(snap.videoId);
    return String(getVideoId() || "");
  }

  function requestPlayerSeek(videoId, seconds) {
    const id = String(videoId || "");
    const time = Number(seconds);
    if (!id || !Number.isFinite(time)) return false;
    window.postMessage({
      source: PLAYER_BRIDGE_SOURCE,
      type: "seek",
      payload: { videoId: id, time: Math.max(0, time) },
    }, "*");
    return true;
  }

  function getAuthoritativePlaybackTime(media = getVideoElement()) {
    const snap = getFreshPlayerSnapshot();
    if (snap && Number.isFinite(snap.currentTime)) {
      const base = Number(snap.currentTime);
      const rate = Number.isFinite(snap.playbackRate) && snap.playbackRate > 0 ? Number(snap.playbackRate) : 1;
      const anchor = Number.isFinite(snap.sampledAt) ? Number(snap.sampledAt) : Number(snap.receivedAt);
      // bridge は表示中ほぼ毎フレーム更新される。古いサンプルを長時間
      // 勝手に進めると再び同期ズレになるため、補間は最大80msだけ。
      const elapsed = Math.max(0, Math.min(0.08, (performance.now() - anchor) / 1000));
      let value = base + (snap.playerState === 1 ? elapsed * rate : 0);
      if (Number.isFinite(snap.duration) && snap.duration > 0) {
        value = Math.min(value, Number(snap.duration) + 0.05);
      }
      return value;
    }
    const value = media ? Number(media.currentTime) : NaN;
    return Number.isFinite(value) ? value : null;
  }

  function getAuthoritativeDuration(media = getVideoElement()) {
    const snap = getFreshPlayerSnapshot();
    if (snap && Number.isFinite(snap.duration) && snap.duration > 0) return Number(snap.duration);
    const value = media ? Number(media.duration) : NaN;
    return Number.isFinite(value) ? value : null;
  }
