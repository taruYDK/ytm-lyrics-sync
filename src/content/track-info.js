  // ---------- 再生中の曲情報 ----------
  function getVideoElement() {
    // YouTube Musicには切り替え時に古いmedia要素が一瞬残ることがあるため、
    // 実際のプレイヤー内のメインvideoを最優先する。
    return (
      document.querySelector("#movie_player video.html5-main-video") ||
      document.querySelector("ytmusic-player video.html5-main-video") ||
      document.querySelector("video.html5-main-video") ||
      document.querySelector("#movie_player video") ||
      document.querySelector("ytmusic-player video") ||
      document.querySelector("video")
    );
  }

  function getVideoId() {
    try {
      return new URL(location.href).searchParams.get("v") || "";
    } catch (_) {
      return "";
    }
  }

  function getPlayerVideoIdFromDom() {
    // MAIN world のプレイヤー本体が最優先。自動次曲時に古い title-link/video がDOMへ
    // 残っていても、実際に再生中の video_id を取得できる。
    const stableVideoId = getStablePlaybackVideoId();
    if (stableVideoId) return stableVideoId;
    const snap = getFreshPlayerSnapshot();
    if (snap && snap.videoId) return snap.videoId;

    // URL は次曲を押した瞬間に先に切り替わることがある。
    // プレイヤー内タイトルリンクはブリッジが使えない環境でのフォールバック。
    const link =
      document.querySelector('#movie_player a.ytp-title-link[href*="watch?v="]') ||
      document.querySelector('ytmusic-player a.ytp-title-link[href*="watch?v="]');
    if (!link) return "";
    try {
      return new URL(link.href, location.origin).searchParams.get("v") || "";
    } catch (_) {
      return "";
    }
  }

  function titlesLikelySame(a, b) {
    const aa = normalizeForCompare(stripFeaturing(cleanTitle(a || "")));
    const bb = normalizeForCompare(stripFeaturing(cleanTitle(b || "")));
    if (!aa || !bb) return true;
    return aa === bb || aa.includes(bb) || bb.includes(aa);
  }

  function getTrackInfo() {
    const media = navigator.mediaSession && navigator.mediaSession.metadata
      ? navigator.mediaSession.metadata
      : null;

    const titleEl =
      document.querySelector("ytmusic-player-bar .title") ||
      document.querySelector(".title.ytmusic-player-bar");

    const bylineEl =
      document.querySelector("ytmusic-player-bar .byline") ||
      document.querySelector(".byline.ytmusic-player-bar");

    const domTitle = titleEl ? titleEl.textContent.trim() : "";
    const bylineText = bylineEl ? bylineEl.textContent.trim() : "";
    const parts = bylineText
      .split(/[•·]/)
      .map((x) => x.trim())
      .filter(Boolean);

    const mediaTitle = media && media.title ? String(media.title).trim() : "";
    const mediaArtist = media && media.artist ? String(media.artist).trim() : "";
    const playerSnap = getFreshPlayerSnapshot();
    const stableVideoId = getStablePlaybackVideoId();
    const rawSnapMatchesStable = Boolean(playerSnap && playerSnap.videoId && stableVideoId && String(playerSnap.videoId) === stableVideoId);
    const playerTitle = String(
      (rawSnapMatchesStable && playerSnap && playerSnap.title) || STATE.stablePlayerTitle || ""
    ).trim();
    const playerArtist = String(
      (rawSnapMatchesStable && playerSnap && playerSnap.artist) || STATE.stablePlayerArtist || ""
    ).trim();

    // v1.7.1: 自動次曲では「Player APIは次曲、DOM/MediaSessionは前曲」の期間がある。
    // これまでDOMとMediaSessionだけでタイトルを決めていたため、次曲videoId + 前曲タイトルで
    // 検索/キャッシュが走り、歌詞タブを開いた時に前曲歌詞へ戻ることがあった。
    // Player APIにタイトルがある時は、それを曲IDと同じ原子的なスナップショットとして最優先する。
    let title = playerTitle || domTitle || mediaTitle || "";
    let artist = playerArtist || parts[0] || mediaArtist || "";

    // Player APIのタイトルが取れないフォールバック時だけ、DOM/MediaSessionの混在を警戒する。
    if (!playerTitle && domTitle && mediaTitle && !titlesLikelySame(domTitle, mediaTitle)) return null;

    title = title.trim();
    artist = String(artist || "").trim();
    const album = (media && media.album ? media.album : (parts.length > 2 ? parts[1] : "")).trim();
    // Home等、URLが/watchでないページに移動するとgetVideoId()が空文字になる。
    // 再生自体は裏で続いているだけなので、これを「別の曲」として扱うと
    // 歌詞タブに戻った時に不要な再検索が走り、レース次第で別の候補が採用されて
    // 「同じ曲のはずなのに歌詞が変わる」原因になる。空の時は直前の有効なvideoIdを使う。
    const bridgeVideoId = getPlayerVideoIdFromDom();
    const rawVideoId = bridgeVideoId || getVideoId();

    // 高速曲送りでは「タイトルだけ次曲、URLのvは前曲」の混在状態が数百ms出ることがある。
    // その組み合わせで歌詞検索を始めると、前曲の再生時刻を新曲へ適用して最下部へ飛ぶため、
    // 直前に表示していた曲とタイトルが変わったのに動画IDが同じ/空なら更新完了まで待つ。
    const titleChangedFromDisplayed = Boolean(
      STATE.lastDisplayedTitle && !titlesLikelySame(title, STATE.lastDisplayedTitle)
    );
    if (
      titleChangedFromDisplayed &&
      STATE.lastDisplayedVideoId &&
      (!rawVideoId || rawVideoId === STATE.lastDisplayedVideoId)
    ) {
      return null;
    }

    if (rawVideoId) STATE.lastKnownVideoId = rawVideoId;
    const videoId = rawVideoId || STATE.lastKnownVideoId;

    if (!title) return null;
    return { title, artist, album, videoId };
  }

  async function getTrackDuration(trackKey) {
    // 歌詞検索の開始を再生時間取得で長く止めない。最大約300msだけ待つ。
    for (let i = 0; i < 4; i++) {
      if (trackKey !== STATE.lastTrackKey) return null;
      const video = getVideoElement();
      if (video) {
        const duration = getAuthoritativeDuration(video);
        if (Number.isFinite(duration) && duration > 0) return duration;
      }
      await sleep(75);
    }
    return null;
  }
