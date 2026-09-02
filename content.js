  // YT Music 歌詞シンクロ - content script v1.9.6
// YouTube Music の「歌詞」タブ内に同期歌詞を表示します。
// 同期歌詞だけを使用し、候補選択・手動検索・取得元の優先順位をサポートします。
// YouTube Music標準歌詞は原曲言語判定のヒントにのみ使用し、表示には使いません。

(function () {
  "use strict";

  const STATE = {
    enabled: true,
    fontSize: 32,
    trackingEnabled: true, // 歌詞ハイライト + 中央自動スクロール
    wordTrackingStyle: "smooth", // 単語ハイライト: smooth | silky
    focusFade: true,
    autoLyricsOnIdle: true, // 「次のコンテンツ」表示後、無操作なら歌詞タブへ移動
    lines: [],
    syncLevel: "none", // none | line | word | syllable
    hasSync: false,
    currentIndex: -1,
    currentWordIndex: -1,
    lastTrackKey: null,
    hasLyricsResult: false,
    statusText: "曲を検出中...",
    source: "",
    isSearching: false,
    searchGeneration: 0,
    observedVideoId: "",
    observedPlaybackVideoId: "", // 安定確認済みの実再生曲ID
    playbackIdCandidate: "",
    playbackIdCandidateSince: 0,
    playbackIdCandidateCount: 0,
    stablePlayerTitle: "",
    stablePlayerArtist: "",
    stablePlayerSnapshotAt: 0,
    videoIdChangedAt: 0,
    previousNativeSignature: "",
    lastDisplayedTrackKey: "",
    lastDisplayedTitle: "",
    lastDisplayedArtist: "",
    displayedVideoId: "",
    playbackTransitionPending: false,
    transitionStartedAt: 0,
    transitionOldTime: 0,
    transitionOldDuration: 0,
    transitionOldSrc: "",
    transitionTargetVideoId: "",
    // ended経由の自動次曲は、URL/タイトル/mediaの更新順が通常スキップと異なる。
    // 終了曲を一瞬再認識したり、旧曲の終端currentTimeを次曲へ適用しないための専用ガード。
    endedTransitionPending: false,
    endedVideoId: "",
    endedTitle: "",
    endedNextVideoId: "",
    endedNextReadySince: 0,
    // 自動次曲ではID/src/durationが先に更新されても、currentTimeが旧曲終端のまま残る。
    // 実際に0秒付近へ戻ったことを確認するまでは追跡を絶対に再開しない。
    endedTimeResetSeen: false,
    endedTimeResetSeenAt: 0,
    endedAt: 0,
    // 次曲開始直後は、YouTube Music 側から旧曲の currentTime が
    // 1サンプルだけ遅れて飛び込むことがある。0秒復帰後もしばらく
    // 実時間に対して不自然なジャンプを拒否するための開始時刻ガード。
    trackStartGuardActive: false,
    trackStartGuardVideoId: "",
    trackStartGuardWallAt: 0,
    trackStartGuardMediaAt: 0,
    trackStartGuardLastSafeTime: 0,
    trackStartGuardLastSafeAt: 0,
    trackCandidateKey: "",
    trackCandidateSince: 0,
    lastDisplayedVideoId: "",
    // 歌詞の有無に関係なく、450ms安定確認を通過した最後の曲を保持。
    // ended時にURLだけ次曲へ先行した場合でも「本当に終了した曲」を特定するために使う。
    stableTrackVideoId: "",
    stableTrackTitle: "",
    lastKnownVideoId: "",
    lyricsCache: new Map(), // 曲(タイトル+アーティスト)ごとの取得済み歌詞キャッシュ
    playerSnapshot: null, // MAIN world の YouTube Player API から取得した実再生状態
    lyricsAutoOpenToken: 0, // 曲切替時に「歌詞」タブを優先して開く再試行世代
    lyricsAutoOpenExpectedVideoId: "",
    lyricsAutoOpenUntil: 0,
    lyricsAutoOpenSelectedSince: 0,
    lyricsAutoOpenArmedAt: 0,
    lyricsAutoOpenLastClickAt: 0,
    lastUserInteractionAt: 0,
    trackTimingOffsets: {}, // videoIdごとの曲別歌詞補正
    trackTimingOffsetsLoaded: false,
    // v1.8.2: 取得/追跡状態と自己復旧。便利機能ではなく、曲切替時の
    // デッドロックや追跡停止からページ再読み込み無しで戻すための安全装置。
    recoveryActiveUntil: 0,
    recoveryReason: "",
    lastAutoRecoveryAt: 0,
    autoRecoveryVideoId: "",
    autoRecoveryCount: 0,
    lastTrackingPulseAt: 0,
    lyricsAppliedAt: 0,
    healthVideoId: "",
    healthPlaybackTime: null,
    healthPlaybackSampleAt: 0,
    healthLastAdvanceAt: 0,
    providerOrder: ["betterLyrics", "lrclib", "unison", "binilyrics", "karalyr"],
    providerEnabled: {
      betterLyrics: true,
      lrclib: true,
      unison: true,
      binilyrics: true,
      karalyr: true,
    },
    lyricCandidates: [],
    activeCandidateId: "",
    manualSelectedCandidateId: "",
    activeBaseInfo: null,
    activeSearchInfo: null,
    manualSearchOverrides: {},
    manualSearchOverridesLoaded: false,
  };

  let panelEl = null;
  let listEl = null;
  let statusEl = null;
  let lyricsRendererEl = null;
  let videoEl = null;
  let videoTimeUpdateHandler = null;
  let videoForceUpdateHandler = null;
  let videoEndedHandler = null;
  let videoMetadataHandler = null;
  let trackingRaf = null;
  let trackTimingButtonEl = null;
  let trackTimingButtonLabelEl = null;
  let trackTimingPopoverEl = null;
  let trackTimingPointsEl = null;
  let trackTimingAddPointEl = null;
  let trackTimingPointsSignature = '';
  let trackTimingTitleEl = null;
  let trackTimingTotalEl = null;
  let lyricsHealthEl = null;
  let resyncButtonEl = null;
  let lyricsToolsEl = null;
  let candidateButtonEl = null;
  let manualSearchButtonEl = null;
  let lyricsToolsPaneEl = null;
  let lyricsToolsPaneMode = "";

  // 手動スクロール後は追跡スクロールを一時停止。
  // 操作が止まってから少し待って現在行へ戻す。
  let manualScrollUntil = 0;
  let pendingReturnToCurrent = false;
  let autoScrollUntil = 0;
  let scrollInteractionBound = false;
  let lyricsWasVisible = false;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const PROVIDERS = [
    { key: "betterLyrics", label: "Better Lyrics" },
    { key: "lrclib", label: "LRCLIB" },
    { key: "unison", label: "Unison" },
    { key: "binilyrics", label: "BiniLyrics" },
    { key: "karalyr", label: "Karalyr" },
  ];
  const DEFAULT_PROVIDER_ORDER = PROVIDERS.map((provider) => provider.key);

  function normalizedProviderOrder(value) {
    const incoming = Array.isArray(value) ? value.map(String) : [];
    return [...new Set([...incoming, ...DEFAULT_PROVIDER_ORDER])]
      .filter((key) => DEFAULT_PROVIDER_ORDER.includes(key));
  }

  function normalizedProviderEnabled(value) {
    const raw = value && typeof value === "object" ? value : {};
    const enabled = {};
    for (const key of DEFAULT_PROVIDER_ORDER) enabled[key] = raw[key] !== false;
    if (!Object.values(enabled).some(Boolean)) enabled.lrclib = true;
    return enabled;
  }

  function providerPriority(providerKey) {
    const index = STATE.providerOrder.indexOf(String(providerKey || ""));
    return index >= 0 ? index : STATE.providerOrder.length + 1;
  }

  function providerConfigSignature() {
    return STATE.providerOrder
      .filter((key) => STATE.providerEnabled[key] !== false)
      .join(">");
  }

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

  // ---------- 設定 ----------
  function loadSettings() {
    try {
      chrome.storage.sync.get(
        {
          enabled: true,
          fontSize: 32,
          trackingEnabled: true,
          wordTrackingStyle: "smooth",
          focusFade: true,
          autoLyricsOnIdle: true,
          providerOrder: DEFAULT_PROVIDER_ORDER,
          providerEnabled: normalizedProviderEnabled({}),
          uiVersion: 0,
        },
        (data) => {
          STATE.enabled = data.enabled !== false;
          STATE.trackingEnabled = data.trackingEnabled !== false;
          STATE.autoLyricsOnIdle = data.autoLyricsOnIdle !== false;
          STATE.wordTrackingStyle = ["smooth", "silky"].includes(String(data.wordTrackingStyle))
            ? String(data.wordTrackingStyle)
            : "smooth";
          STATE.focusFade = data.focusFade !== false;
          STATE.providerOrder = normalizedProviderOrder(data.providerOrder);
          STATE.providerEnabled = normalizedProviderEnabled(data.providerEnabled);

          // 旧版の複雑な設定はv1.8.1では使用しない。
          // 古い値がstorageに残っていても動作へ影響させない。
          try {
            chrome.storage.sync.remove(["trackingMode", "scrollReturnDelay", "sourcePreference", "timingOffsetMs"]);
          } catch (_) {}

          if ((data.uiVersion || 0) < 6) {
            STATE.fontSize = 32;
            chrome.storage.sync.set({ fontSize: 32, uiVersion: 6 });
          } else {
            STATE.fontSize = Number(data.fontSize) || 32;
          }

          applySettings();
          if (STATE.enabled) {
            STATE.lastTrackKey = null;
            tick();
          }
        }
      );

      chrome.storage.onChanged.addListener((changes) => {
        if (changes.enabled) {
          STATE.enabled = changes.enabled.newValue !== false;
          if (STATE.enabled) STATE.lastTrackKey = null;
          applySettings();
          tick();
        }

        if (changes.fontSize) {
          STATE.fontSize = Number(changes.fontSize.newValue) || 32;
          applySettings();
        }

        if (changes.trackingEnabled) {
          STATE.trackingEnabled = changes.trackingEnabled.newValue !== false;
          manualScrollUntil = 0;
          pendingReturnToCurrent = false;
          applySettings();
          const media = getVideoElement();
          if (!STATE.trackingEnabled) clearTrackingVisuals();
          else if (media && STATE.hasSync) updateHighlight(getAuthoritativePlaybackTime(media) || 0, true);
        }

        if (changes.wordTrackingStyle) {
          const next = String(changes.wordTrackingStyle.newValue || "smooth");
          STATE.wordTrackingStyle = ["smooth", "silky"].includes(next) ? next : "smooth";
          STATE.currentWordIndex = -1;
          applySettings();
          const media = getVideoElement();
          if (media && STATE.hasSync && STATE.trackingEnabled) updateHighlight(getAuthoritativePlaybackTime(media) || 0, true);
        }

        if (changes.focusFade) {
          STATE.focusFade = changes.focusFade.newValue !== false;
          applySettings();
          const media = getVideoElement();
          if (media && STATE.hasSync && canTrackCurrentPlayback(media)) updateHighlight(getAuthoritativePlaybackTime(media) || 0, true);
        }

        if (changes.autoLyricsOnIdle) {
          STATE.autoLyricsOnIdle = changes.autoLyricsOnIdle.newValue !== false;
          if (!STATE.autoLyricsOnIdle) {
            cancelLyricsAutoOpen();
          } else {
              armLyricsAutoOpenIfNeeded(getAuthoritativeVideoId());
          }
        }

        if (changes.providerOrder || changes.providerEnabled) {
          STATE.providerOrder = normalizedProviderOrder(
            changes.providerOrder ? changes.providerOrder.newValue : STATE.providerOrder
          );
          STATE.providerEnabled = normalizedProviderEnabled(
            changes.providerEnabled ? changes.providerEnabled.newValue : STATE.providerEnabled
          );
          deleteLyricsCacheForVideoId(getAuthoritativeVideoId());
          restartLyricsSearch("提供元設定を反映して再検索中…");
        }
      });
    } catch (_) {
      // 拡張機能再読み込み直後などは無視
    }
  }

  // ---------- YouTube Music の「歌詞」タブ ----------
  function findLyricsRenderer() {
    return (
      document.querySelector('#side-panel #tab-renderer[page-type="MUSIC_PAGE_TYPE_TRACK_LYRICS"]') ||
      document.querySelector('ytmusic-tab-renderer[page-type="MUSIC_PAGE_TYPE_TRACK_LYRICS"]') ||
      document.querySelector('[page-type="MUSIC_PAGE_TYPE_TRACK_LYRICS"]')
    );
  }

  function isUsableTabElement(el) {
    if (!el || !(el instanceof Element)) return false;
    // 拡張自身の「歌詞 ±秒」ボタンやポップオーバーを、歌詞タブとして再検出しない。
    if (el.closest && el.closest('#ytmls-panel, #ytmls-track-offset-popover, [id^="ytmls-"]')) return false;
    try {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
    } catch (_) {}
    return true;
  }

  function getPlayerPageTabs() {
    const selectors = [
      'ytmusic-player-page #tabs tp-yt-paper-tab',
      'ytmusic-player-page #tabs paper-tab',
      'ytmusic-player-page tp-yt-paper-tabs tp-yt-paper-tab',
      'ytmusic-player-page paper-tabs paper-tab',
      'ytmusic-player-page #tabs [role="tab"]',
      '#side-panel tp-yt-paper-tab',
      '#side-panel paper-tab',
      '#side-panel [role="tab"]',
      'ytmusic-player-page [role="tab"]',
      'ytmusic-player-page tp-yt-paper-tab',
      'ytmusic-player-page paper-tab',
      'ytmusic-tab-renderer [role="tab"]',
    ];
    const out = [];
    const seen = new Set();
    for (const selector of selectors) {
      for (const el of document.querySelectorAll(selector)) {
        if (!isUsableTabElement(el) || seen.has(el)) continue;
        if (el.closest && el.closest('[page-type="MUSIC_PAGE_TYPE_TRACK_LYRICS"]')) continue;
        seen.add(el);
        out.push(el);
      }
    }
    return out;
  }

  function normalizedTabText(el) {
    if (!el) return '';
    return [
      el.textContent,
      el.getAttribute && el.getAttribute('aria-label'),
      el.getAttribute && el.getAttribute('title'),
      el.getAttribute && el.getAttribute('data-title'),
      el.dataset && el.dataset.title,
    ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function isLyricsLabelText(text) {
    const label = String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
    return label === '歌詞' || label === 'lyrics' || label.includes('歌詞') || /(^|\s)lyrics($|\s)/i.test(label);
  }

  function closestTabLikeElement(node) {
    if (!node || !(node instanceof Element)) return null;
    const strictSelector = 'tp-yt-paper-tab, paper-tab, [role="tab"]';
    let candidate = node.matches(strictSelector) ? node : node.closest(strictSelector);

    // UIによってタブがbuttonになる場合も、実際のタブコンテナ内だけを許可する。
    if (!candidate) {
      const button = node.matches('button, [aria-selected]') ? node : node.closest('button, [aria-selected]');
      const tabContainer = button && button.closest('#tabs, tp-yt-paper-tabs, paper-tabs, [role="tablist"]');
      if (button && tabContainer) candidate = button;
    }
    return isUsableTabElement(candidate) ? candidate : null;
  }

  function findLyricsTabButton() {
    const tabs = getPlayerPageTabs();

    // 1) 通常のタブ要素からラベルで特定。
    for (const el of tabs) {
      if (isLyricsLabelText(normalizedTabText(el))) return el;
    }

    // 2) 現行UIではラベルがyt-formatted-string等の子要素にだけ入ることがある。
    //    「歌詞 / Lyrics」という実テキストを探して、クリック可能な親タブまで戻る。
    const roots = [
      document.querySelector('ytmusic-player-page'),
      document.querySelector('#side-panel'),
      document
    ].filter(Boolean);
    const labelSelectors = [
      'yt-formatted-string', '.tab-content', '[aria-label]', '[title]',
      'span', 'div'
    ];
    const labelSeen = new Set();
    for (const root of roots) {
      for (const selector of labelSelectors) {
        for (const node of root.querySelectorAll(selector)) {
          if (!node || labelSeen.has(node)) continue;
          labelSeen.add(node);
          const text = normalizedTabText(node);
          if (!isLyricsLabelText(text)) continue;
          const tab = closestTabLikeElement(node);
          if (tab) return tab;
        }
      }
    }

    // 3) UI更新で文字列が取れない場合はrendererとタブの並び順を照合。
    const renderers = Array.from(document.querySelectorAll(
      '#side-panel ytmusic-tab-renderer[page-type], ytmusic-player-page #side-panel [page-type], ytmusic-player-page ytmusic-tab-renderer[page-type]'
    ));
    const uniqueRenderers = [];
    const rendererSeen = new Set();
    for (const renderer of renderers) {
      if (!renderer || rendererSeen.has(renderer)) continue;
      rendererSeen.add(renderer);
      uniqueRenderers.push(renderer);
    }
    const lyricsIndex = uniqueRenderers.findIndex((renderer) =>
      renderer.getAttribute('page-type') === 'MUSIC_PAGE_TYPE_TRACK_LYRICS'
    );
    if (lyricsIndex >= 0 && tabs[lyricsIndex]) return tabs[lyricsIndex];

    return null;
  }

  function isLyricsTabSelected(tab) {
    if (!tab) return false;
    if (isLyricsViewVisible()) return true;
    return tab.getAttribute('aria-selected') === 'true' ||
      tab.getAttribute('aria-current') === 'page' ||
      tab.hasAttribute('selected') ||
      tab.classList.contains('iron-selected') ||
      tab.classList.contains('selected') ||
      tab.classList.contains('active');
  }

  function isLyricsViewVisible() {
    const renderer = findLyricsRenderer();
    if (!renderer) return false;
    try {
      const style = getComputedStyle(renderer);
      return renderer.getClientRects().length > 0 && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    } catch (_) {
      return false;
    }
  }

  function clickLyricsTab(tab) {
    if (!tab) return false;
    const targets = [tab];
    const innerLabel = Array.from(tab.querySelectorAll ? tab.querySelectorAll('yt-formatted-string, .tab-content, span') : [])
      .find((el) => isLyricsLabelText(normalizedTabText(el)));
    if (innerLabel) targets.push(innerLabel);

    let attempted = false;
    for (const target of targets) {
      try { target.focus && target.focus({ preventScroll: true }); } catch (_) {}
      try {
        if (typeof PointerEvent === 'function') {
          target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, composed: true, button: 0, pointerType: 'mouse' }));
          target.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, composed: true, button: 0, pointerType: 'mouse' }));
        }
        target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, composed: true, button: 0 }));
        target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, composed: true, button: 0 }));
      } catch (_) {}
      try {
        target.click();
        attempted = true;
      } catch (_) {
        try {
          target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true, button: 0 }));
          attempted = true;
        } catch (_) {}
      }
      // YouTube MusicのPolymer系UI向け。標準clickが取りこぼされた場合の補助。
      try {
        target.dispatchEvent(new CustomEvent('tap', { bubbles: true, cancelable: true, composed: true }));
      } catch (_) {}
    }
    return attempted;
  }

  // v1.8.5: 「次のコンテンツ」が選択されている間だけ無操作時間を測る。
  // 操作したらその曲を永久キャンセルせず、最後の操作から2秒を数え直す。
  // YouTube MusicのタブDOM/selected属性の揺れに備えて、ラベル・paper-tabsのselected・
  // page-type renderer・タブ並びの4経路で現在タブを判定する。
  const AUTO_LYRICS_IDLE_DELAY_MS = 2000;
  const AUTO_LYRICS_RETRY_MS = 450;

  function isTabActive(tab) {
    if (!tab) return false;
    return tab.getAttribute('aria-selected') === 'true' ||
      tab.getAttribute('aria-current') === 'page' ||
      tab.hasAttribute('selected') ||
      tab.classList.contains('iron-selected') ||
      tab.classList.contains('selected') ||
      tab.classList.contains('active');
  }

  function getTabContainers() {
    const selectors = [
      'ytmusic-player-page #tabs',
      'ytmusic-player-page tp-yt-paper-tabs',
      'ytmusic-player-page paper-tabs',
      '#side-panel tp-yt-paper-tabs',
      '#side-panel paper-tabs'
    ];
    const out = [];
    const seen = new Set();
    for (const selector of selectors) {
      for (const el of document.querySelectorAll(selector)) {
        if (!el || seen.has(el)) continue;
        seen.add(el);
        out.push(el);
      }
    }
    return out;
  }

  function getTabsForContainer(container) {
    if (!container) return [];
    const selectors = [':scope > tp-yt-paper-tab', ':scope > paper-tab', ':scope > [role="tab"]'];
    for (const selector of selectors) {
      try {
        const tabs = Array.from(container.querySelectorAll(selector)).filter(isUsableTabElement);
        if (tabs.length) return tabs;
      } catch (_) {}
    }
    return [];
  }

  function getSelectedPlayerTab() {
    const allTabs = getPlayerPageTabs();
    for (const tab of allTabs) {
      if (isTabActive(tab)) return tab;
    }

    // Polymerのpaper-tabsは子tabではなく親側のselected="0"だけ更新するUIがある。
    for (const container of getTabContainers()) {
      const tabs = getTabsForContainer(container);
      if (!tabs.length) continue;
      let index = Number.parseInt(container.getAttribute('selected') || '', 10);
      if (!Number.isFinite(index)) {
        try { index = Number.parseInt(String(container.selected), 10); } catch (_) {}
      }
      if (Number.isFinite(index) && index >= 0 && index < tabs.length) return tabs[index];
      try {
        if (container.selectedItem && tabs.includes(container.selectedItem)) return container.selectedItem;
      } catch (_) {}
    }

    return null;
  }

  function tabLabel(tab) {
    return normalizedTabText(tab);
  }

  function isNextContentLabel(text) {
    const label = String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
    return label.includes('次のコンテンツ') ||
      label.includes('次に再生') ||
      label === 'up next' ||
      label.includes('up next') ||
      label === 'queue' ||
      label.includes('queue');
  }

  function isRelatedLabel(text) {
    const label = String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
    return label === '関連' || label.includes('関連') || label === 'related' || /(^|\s)related($|\s)/i.test(label);
  }

  function findNextContentTabButton() {
    const tabs = getPlayerPageTabs();

    // 1) ラベルで直接探す。
    for (const tab of tabs) {
      if (isNextContentLabel(tabLabel(tab))) return tab;
    }

    // 2) 子要素の文字しか取れないUI。
    const roots = [document.querySelector('ytmusic-player-page'), document.querySelector('#side-panel'), document].filter(Boolean);
    const selectors = ['yt-formatted-string', '.tab-content', '[aria-label]', '[title]', 'span'];
    const seen = new Set();
    for (const root of roots) {
      for (const selector of selectors) {
        for (const node of root.querySelectorAll(selector)) {
          if (!node || seen.has(node)) continue;
          seen.add(node);
          if (!isNextContentLabel(normalizedTabText(node))) continue;
          const tab = closestTabLikeElement(node);
          if (tab) return tab;
        }
      }
    }

    // 3) 現行YouTube Musicは「次のコンテンツ / 歌詞 / 関連」の順。
    //    Lyricsの直前をUp nextとして使うのは、文字列/page-typeが取れない時だけの最後のfallback。
    const lyricsTab = findLyricsTabButton();
    if (lyricsTab) {
      const index = tabs.indexOf(lyricsTab);
      if (index > 0 && tabs[index - 1]) return tabs[index - 1];
    }
    return null;
  }

  function findRelatedTabButton() {
    for (const tab of getPlayerPageTabs()) {
      if (isRelatedLabel(tabLabel(tab))) return tab;
    }
    return null;
  }

  function isVisibleRenderer(renderer) {
    if (!renderer) return false;
    try {
      const style = getComputedStyle(renderer);
      return renderer.getClientRects().length > 0 && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    } catch (_) {
      return false;
    }
  }

  function visiblePlayerPageType() {
    const renderers = document.querySelectorAll(
      '#side-panel ytmusic-tab-renderer[page-type], ytmusic-player-page ytmusic-tab-renderer[page-type], #side-panel [page-type]'
    );
    for (const renderer of renderers) {
      if (!isVisibleRenderer(renderer)) continue;
      const pageType = String(renderer.getAttribute('page-type') || '').toUpperCase();
      if (pageType) return pageType;
    }
    return '';
  }

  function isNextContentViewActive() {
    if (isLyricsViewVisible()) return false;

    const selected = getSelectedPlayerTab();
    if (selected) {
      const label = tabLabel(selected);
      if (isNextContentLabel(label)) return true;
      if (isLyricsLabelText(label) || isRelatedLabel(label)) return false;

      const nextTab = findNextContentTabButton();
      if (nextTab && selected === nextTab) return true;
      const relatedTab = findRelatedTabButton();
      if (relatedTab && selected === relatedTab) return false;
    }

    // page-typeが取れる場合はこちらを優先。実UIの内部名変更に備えて広めに見る。
    const pageType = visiblePlayerPageType();
    if (pageType) {
      if (pageType.includes('LYRICS')) return false;
      if (pageType.includes('RELATED')) return false;
      if (pageType.includes('UP_NEXT') || pageType.includes('UPNEXT') || pageType.includes('QUEUE') || pageType.includes('NEXT')) return true;
    }

    // 最終fallback: Lyrics/Relatedのどちらも選択されておらず、Up nextタブが存在する場合。
    // paper-tabsのselected属性が一切取れないYouTube Music UI向け。
    const nextTab = findNextContentTabButton();
    const lyricsTab = findLyricsTabButton();
    const relatedTab = findRelatedTabButton();
    if (nextTab && isTabActive(nextTab)) return true;
    if (lyricsTab && isTabActive(lyricsTab)) return false;
    if (relatedTab && isTabActive(relatedTab)) return false;
    return false;
  }

  function resetLyricsAutoOpenIdle() {
    STATE.lyricsAutoOpenToken += 1;
    STATE.lyricsAutoOpenExpectedVideoId = '';
    STATE.lyricsAutoOpenUntil = 0;
    STATE.lyricsAutoOpenSelectedSince = 0;
    STATE.lyricsAutoOpenArmedAt = 0;
    STATE.lyricsAutoOpenLastClickAt = 0;
  }

  function cancelLyricsAutoOpen() {
    resetLyricsAutoOpenIdle();
  }

  function noteUserInteraction(event) {
    if (!event || event.isTrusted !== true) return;
    const now = performance.now();
    STATE.lastUserInteractionAt = now;

    // 「次のコンテンツ」表示中の操作は永久キャンセルではなく、2秒タイマーをリセットするだけ。
    if (STATE.enabled && STATE.autoLyricsOnIdle && isNextContentViewActive()) {
      STATE.lyricsAutoOpenArmedAt = now;
      STATE.lyricsAutoOpenLastClickAt = 0;
      STATE.lyricsAutoOpenExpectedVideoId = String(getAuthoritativeVideoId() || '');
    }
  }

  function bindAutoLyricsIdleInteractionWatch() {
    document.addEventListener('pointerdown', noteUserInteraction, true);
    document.addEventListener('keydown', noteUserInteraction, true);
    document.addEventListener('wheel', noteUserInteraction, { capture: true, passive: true });
    document.addEventListener('touchstart', noteUserInteraction, { capture: true, passive: true });
  }

  function openLyricsTabForTrack(expectedVideoId = '') {
    if (!STATE.enabled || !STATE.autoLyricsOnIdle) return;
    // 曲変更側から呼ばれても即クリックしない。次のコンテンツが実際に表示されてから
    // maintainLyricsAutoOpen() が無操作2秒を数える。
    const activeVideoId = String(expectedVideoId || getAuthoritativeVideoId() || '');
    if (activeVideoId) STATE.lyricsAutoOpenExpectedVideoId = activeVideoId;
  }

  function armLyricsAutoOpenIfNeeded(expectedVideoId = '') {
    if (!STATE.enabled || !STATE.autoLyricsOnIdle) return;
    if (!isNextContentViewActive()) return;
    if (isLyricsViewVisible()) return;

    const now = performance.now();
    const activeVideoId = String(expectedVideoId || getAuthoritativeVideoId() || '');
    if (!STATE.lyricsAutoOpenArmedAt) {
      // 次のコンテンツを検出した瞬間から2秒。検出より前の操作は影響させない。
      STATE.lyricsAutoOpenArmedAt = now;
      STATE.lyricsAutoOpenExpectedVideoId = activeVideoId;
      STATE.lyricsAutoOpenLastClickAt = 0;
    } else if (activeVideoId && STATE.lyricsAutoOpenExpectedVideoId && activeVideoId !== STATE.lyricsAutoOpenExpectedVideoId) {
      // 曲が変わったら新しい曲として2秒を数え直す。
      STATE.lyricsAutoOpenArmedAt = now;
      STATE.lyricsAutoOpenExpectedVideoId = activeVideoId;
      STATE.lyricsAutoOpenLastClickAt = 0;
    }
  }

  function tryAutoOpenLyricsTab() {
    if (!STATE.enabled || !STATE.autoLyricsOnIdle || !STATE.lyricsAutoOpenArmedAt) return;
    if (!isNextContentViewActive()) {
      resetLyricsAutoOpenIdle();
      return;
    }

    const now = performance.now();
    const activeVideoId = String(getAuthoritativeVideoId() || '');
    if (STATE.lyricsAutoOpenExpectedVideoId && activeVideoId && activeVideoId !== STATE.lyricsAutoOpenExpectedVideoId) {
      STATE.lyricsAutoOpenExpectedVideoId = activeVideoId;
      STATE.lyricsAutoOpenArmedAt = now;
      STATE.lyricsAutoOpenLastClickAt = 0;
      return;
    }

    // 次のコンテンツを開いた後の「最後の実操作」から2秒。
    const idleStart = Math.max(STATE.lyricsAutoOpenArmedAt || 0, STATE.lastUserInteractionAt || 0);
    if (now - idleStart < AUTO_LYRICS_IDLE_DELAY_MS) return;

    const lyricsTab = findLyricsTabButton();
    if (!lyricsTab || lyricsTab.getAttribute('aria-disabled') === 'true' || lyricsTab.hasAttribute('disabled')) return;
    if (isLyricsTabSelected(lyricsTab) || isLyricsViewVisible()) {
      requestAnimationFrame(() => ensureLyricsMount());
      resetLyricsAutoOpenIdle();
      return;
    }

    // クリックが1回取りこぼされても、次tickで再試行する。
    if (STATE.lyricsAutoOpenLastClickAt && now - STATE.lyricsAutoOpenLastClickAt < AUTO_LYRICS_RETRY_MS) return;
    STATE.lyricsAutoOpenLastClickAt = now;
    clickLyricsTab(lyricsTab);

    setTimeout(() => {
      const latestLyricsTab = findLyricsTabButton();
      if ((latestLyricsTab && isLyricsTabSelected(latestLyricsTab)) || isLyricsViewVisible()) {
        requestAnimationFrame(() => ensureLyricsMount());
        resetLyricsAutoOpenIdle();
      }
    }, 140);
  }

  function maintainLyricsAutoOpen() {
    if (!STATE.enabled || !STATE.autoLyricsOnIdle) {
      if (STATE.lyricsAutoOpenArmedAt) resetLyricsAutoOpenIdle();
      return;
    }

    if (isLyricsViewVisible()) {
      if (STATE.lyricsAutoOpenArmedAt) resetLyricsAutoOpenIdle();
      return;
    }

    if (!isNextContentViewActive()) {
      if (STATE.lyricsAutoOpenArmedAt) resetLyricsAutoOpenIdle();
      return;
    }

    armLyricsAutoOpenIfNeeded(getAuthoritativeVideoId());
    tryAutoOpenLyricsTab();
  }

  function lyricCandidateIdentity(result) {
    if (result && result._candidateId) return String(result._candidateId);
    const preview = lyricsTextForLanguage(result).slice(0, 180);
    return `${result && result._providerKey || ""}::${result && result._source || ""}::${result && result.syncLevel || ""}::${preview}`;
  }

  function syncLevelShortLabel(syncLevel) {
    if (syncLevel === "syllable") return "音節";
    if (syncLevel === "word") return "単語";
    if (syncLevel === "line") return "行";
    return "同期なし";
  }

  function candidateRecommendationScore(result, info = null, expectedLanguage = "") {
    if (!result || !Array.isArray(result.lines) || !result.lines.length) return 0;

    const syncScore = result.syncLevel === "syllable"
      ? 40
      : result.syncLevel === "word"
        ? 32
        : result.syncLevel === "line"
          ? 22
          : 0;

    const expected = expectedLanguage || inferTrackLanguage(info || STATE.activeSearchInfo || STATE.activeBaseInfo);
    const fit = lyricsLanguageFit(result, info || STATE.activeSearchInfo, expected);
    const languageScore = fit >= 10 ? 25 : fit >= 0 ? 15 : 0;

    const priorityIndex = providerPriority(result._providerKey);
    const providerScore = Math.max(4, 20 - priorityIndex * 4);

    const lineCount = result.lines.length;
    const completenessScore = lineCount >= 40 ? 15 : lineCount >= 20 ? 12 : lineCount >= 8 ? 8 : 4;
    const sanitizedPenalty = Math.min(8, Number(result._translationRowsRemoved) || 0);

    return Math.max(0, Math.min(100,
      syncScore + languageScore + providerScore + completenessScore - sanitizedPenalty
    ));
  }

  function recommendationLabel(score) {
    if (score >= 85) return "最もおすすめ";
    if (score >= 70) return "おすすめ";
    if (score >= 55) return "良好";
    if (score >= 40) return "候補";
    return "要確認";
  }

  function upsertLyricsCandidate(result) {
    if (!result || !Array.isArray(result.lines) || !result.lines.length) return;
    if (!Number.isFinite(Number(result._recommendationScore))) {
      result._recommendationScore = candidateRecommendationScore(result);
    }
    const id = lyricCandidateIdentity(result);
    const entry = { id, result };
    const existingIndex = STATE.lyricCandidates.findIndex((item) => item.id === id);
    if (existingIndex >= 0) STATE.lyricCandidates[existingIndex] = entry;
    else STATE.lyricCandidates.push(entry);
    STATE.lyricCandidates.sort((a, b) =>
      (Number(b.result._recommendationScore || 0) - Number(a.result._recommendationScore || 0)) ||
      (providerPriority(a.result._providerKey) - providerPriority(b.result._providerKey)) ||
      (resultQuality(b.result) - resultQuality(a.result))
    );
    updateLyricsToolsUi();
  }

  function updateLyricsToolsUi() {
    if (candidateButtonEl) {
      const count = STATE.lyricCandidates.length;
      candidateButtonEl.textContent = `歌詞候補 ${count}`;
      candidateButtonEl.disabled = count === 0;
      candidateButtonEl.title = count ? "取得した同期歌詞から選択" : "候補を検索中です";
    }
    if (lyricsToolsEl) lyricsToolsEl.hidden = !STATE.enabled;
  }

  function closeLyricsToolsPane() {
    if (!lyricsToolsPaneEl) return;
    lyricsToolsPaneEl.hidden = true;
    lyricsToolsPaneEl.replaceChildren();
    lyricsToolsPaneMode = "";
    if (candidateButtonEl) candidateButtonEl.setAttribute("aria-pressed", "false");
    if (manualSearchButtonEl) manualSearchButtonEl.setAttribute("aria-pressed", "false");
  }

  function selectLyricsCandidate(candidateId) {
    const candidate = STATE.lyricCandidates.find((item) => item.id === candidateId);
    const info = STATE.activeSearchInfo || STATE.activeBaseInfo;
    if (!candidate || !info || !STATE.lastTrackKey) return;
    STATE.manualSelectedCandidateId = candidateId;
    STATE.activeCandidateId = candidateId;
    if (applyLyricsResult(candidate.result, info, STATE.lastTrackKey, STATE.searchGeneration)) {
      const baseCacheKey = lyricsCacheKey(STATE.activeBaseInfo || info);
      const searchCacheKey = lyricsCacheKey(info);
      if (baseCacheKey) rememberLyricsInCache(baseCacheKey, candidate.result);
      if (searchCacheKey && searchCacheKey !== baseCacheKey) rememberLyricsInCache(searchCacheKey, candidate.result);
    }
    closeLyricsToolsPane();
  }

  function renderCandidatePane() {
    if (!lyricsToolsPaneEl) return;
    if (!lyricsToolsPaneEl.hidden && lyricsToolsPaneMode === "candidates") {
      closeLyricsToolsPane();
      return;
    }
    lyricsToolsPaneMode = "candidates";
    if (candidateButtonEl) candidateButtonEl.setAttribute("aria-pressed", "true");
    if (manualSearchButtonEl) manualSearchButtonEl.setAttribute("aria-pressed", "false");
    lyricsToolsPaneEl.replaceChildren();
    lyricsToolsPaneEl.hidden = false;

    const heading = document.createElement("div");
    heading.className = "ytmls-tools-heading";
    heading.textContent = "同期歌詞を選択";
    lyricsToolsPaneEl.appendChild(heading);

    const recommendationNote = document.createElement("div");
    recommendationNote.className = "ytmls-recommendation-note";
    recommendationNote.textContent = "おすすめ度は、同期精度・言語一致・提供元の優先順位・歌詞行数から自動計算した目安です。";
    lyricsToolsPaneEl.appendChild(recommendationNote);

    for (const candidate of STATE.lyricCandidates) {
      const result = candidate.result;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ytmls-candidate-item";
      if (candidate.id === STATE.activeCandidateId) button.dataset.active = "true";

      const textWrap = document.createElement("span");
      textWrap.className = "ytmls-candidate-text";

      const label = document.createElement("span");
      label.className = "ytmls-candidate-label";
      label.textContent = result._source || "歌詞";

      const meta = document.createElement("span");
      meta.className = "ytmls-candidate-meta";
      const lineCount = Array.isArray(result.lines) ? result.lines.length : 0;
      meta.textContent = `${syncLevelShortLabel(result.syncLevel)}同期 • ${lineCount}行`;

      const score = Number(result._recommendationScore || candidateRecommendationScore(result));
      const badge = document.createElement("span");
      badge.className = "ytmls-recommendation-badge";
      badge.dataset.level = score >= 85 ? "top" : score >= 70 ? "high" : score >= 55 ? "mid" : "low";
      badge.textContent = `おすすめ度 ${score} • ${recommendationLabel(score)}`;

      textWrap.append(label, meta);
      button.append(textWrap, badge);
      button.addEventListener("click", () => selectLyricsCandidate(candidate.id));
      lyricsToolsPaneEl.appendChild(button);
    }

    const close = document.createElement("button");
    close.type = "button";
    close.className = "ytmls-tools-close";
    close.textContent = "閉じる";
    close.addEventListener("click", closeLyricsToolsPane);
    lyricsToolsPaneEl.appendChild(close);
  }

  function renderManualSearchPane() {
    if (!lyricsToolsPaneEl) return;
    if (!lyricsToolsPaneEl.hidden && lyricsToolsPaneMode === "manual") {
      closeLyricsToolsPane();
      return;
    }
    lyricsToolsPaneMode = "manual";
    if (candidateButtonEl) candidateButtonEl.setAttribute("aria-pressed", "false");
    if (manualSearchButtonEl) manualSearchButtonEl.setAttribute("aria-pressed", "true");
    lyricsToolsPaneEl.replaceChildren();
    lyricsToolsPaneEl.hidden = false;

    const baseInfo = STATE.activeBaseInfo || getTrackInfo();
    const effectiveInfo = effectiveSearchInfo(baseInfo) || baseInfo || { title: "", artist: "", videoId: "" };

    const heading = document.createElement("div");
    heading.className = "ytmls-tools-heading";
    heading.textContent = "検索条件を修正";

    const form = document.createElement("form");
    form.className = "ytmls-manual-form";

    const titleInput = document.createElement("input");
    titleInput.type = "text";
    titleInput.required = true;
    titleInput.placeholder = "曲名";
    titleInput.value = effectiveInfo.title || "";
    titleInput.setAttribute("aria-label", "曲名");

    const artistInput = document.createElement("input");
    artistInput.type = "text";
    artistInput.required = true;
    artistInput.placeholder = "アーティスト";
    artistInput.value = effectiveInfo.artist || "";
    artistInput.setAttribute("aria-label", "アーティスト");

    const actions = document.createElement("div");
    actions.className = "ytmls-manual-actions";

    const submit = document.createElement("button");
    submit.type = "submit";
    submit.className = "ytmls-tools-primary";
    submit.textContent = "この条件で検索";

    const auto = document.createElement("button");
    auto.type = "button";
    auto.className = "ytmls-tools-secondary";
    auto.textContent = "自動検出に戻す";
    auto.disabled = !effectiveInfo._manualSearch;
    auto.addEventListener("click", () => {
      const videoId = String((baseInfo && baseInfo.videoId) || getAuthoritativeVideoId() || "");
      if (!videoId) return;
      delete STATE.manualSearchOverrides[videoId];
      saveManualSearchOverrides();
      deleteLyricsCacheForVideoId(videoId);
      closeLyricsToolsPane();
      restartLyricsSearch("自動検出の曲情報で再検索中…");
    });

    actions.append(submit, auto);
    form.append(titleInput, artistInput, actions);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const videoId = String((baseInfo && baseInfo.videoId) || getAuthoritativeVideoId() || "");
      const title = titleInput.value.trim();
      const artist = artistInput.value.trim();
      if (!videoId || !title || !artist) return;
      STATE.manualSearchOverrides[videoId] = { title, artist, ts: Date.now() };
      saveManualSearchOverrides();
      deleteLyricsCacheForVideoId(videoId);
      closeLyricsToolsPane();
      restartLyricsSearch(`手動条件で再検索中… ${title} - ${artist}`);
    });

    const close = document.createElement("button");
    close.type = "button";
    close.className = "ytmls-tools-close";
    close.textContent = "閉じる";
    close.addEventListener("click", closeLyricsToolsPane);

    lyricsToolsPaneEl.append(heading, form, close);
    requestAnimationFrame(() => titleInput.focus());
  }

  function createPanel() {
    if (panelEl) return;

    panelEl = document.createElement("div");
    panelEl.id = "ytmls-panel";
    panelEl.setAttribute("aria-live", "polite");
    panelEl.dataset.sync = "none";

    statusEl = document.createElement("div");
    statusEl.id = "ytmls-status";
    statusEl.textContent = STATE.statusText;
    panelEl.appendChild(statusEl);

    lyricsToolsEl = document.createElement("div");
    lyricsToolsEl.id = "ytmls-tools";

    candidateButtonEl = document.createElement("button");
    candidateButtonEl.type = "button";
    candidateButtonEl.className = "ytmls-tool-button";
    candidateButtonEl.setAttribute("aria-pressed", "false");
    candidateButtonEl.addEventListener("click", renderCandidatePane);

    manualSearchButtonEl = document.createElement("button");
    manualSearchButtonEl.type = "button";
    manualSearchButtonEl.className = "ytmls-tool-button";
    manualSearchButtonEl.textContent = "手動検索";
    manualSearchButtonEl.setAttribute("aria-pressed", "false");
    manualSearchButtonEl.addEventListener("click", renderManualSearchPane);

    lyricsToolsEl.append(candidateButtonEl, manualSearchButtonEl);
    panelEl.appendChild(lyricsToolsEl);

    lyricsToolsPaneEl = document.createElement("div");
    lyricsToolsPaneEl.id = "ytmls-tools-pane";
    lyricsToolsPaneEl.hidden = true;
    panelEl.appendChild(lyricsToolsPaneEl);

    listEl = document.createElement("div");
    listEl.id = "ytmls-list";
    panelEl.appendChild(listEl);
    bindScrollInteraction();

    applySettings();
    updateLyricsToolsUi();
    renderLines();
  }

  function ensureLyricsMount() {
    const renderer = findLyricsRenderer();
    if (!renderer) {
      if (lyricsRendererEl) lyricsRendererEl.classList.remove("ytmls-replaced");
      lyricsRendererEl = null;
      return;
    }

    createPanel();

    if (lyricsRendererEl !== renderer) {
      if (lyricsRendererEl) lyricsRendererEl.classList.remove("ytmls-replaced");
      lyricsRendererEl = renderer;
    }

    if (panelEl && panelEl.parentElement !== renderer) {
      renderer.prepend(panelEl);
      renderLines();
    }

    // 歌詞タブを開き直した時、古いスクロール位置（特に最下部）をそのまま使わない。
    const isVisible = renderer.getClientRects().length > 0 && getComputedStyle(renderer).display !== "none";
    if (isVisible && !lyricsWasVisible) {
      // v1.7.1: 「歌詞」タブを開いた瞬間にも実再生曲と表示歌詞を照合する。
      // 前曲DOM/歌詞が裏で残っていても、そのまま見せず次曲検索へ切り替える。
      const activeVideoId = getAuthoritativeVideoId();
      if (STATE.hasLyricsResult && STATE.displayedVideoId && activeVideoId && STATE.displayedVideoId !== activeVideoId) {
        STATE.searchGeneration += 1;
        STATE.lastTrackKey = null;
        STATE.trackCandidateKey = "";
        STATE.trackCandidateSince = 0;
        setTimeout(() => {
          if (!STATE.enabled) return;
          clearLyricsForNewTrack("次の曲の歌詞を読み込み中…");
          tick();
        }, 0);
      } else if (STATE.hasLyricsResult) {
        requestAnimationFrame(() => {
          const media = getVideoElement();
          if (STATE.hasSync && media && canTrackCurrentPlayback(media)) {
            STATE.currentIndex = -1;
            STATE.currentWordIndex = -1;
            updateHighlight(getAuthoritativePlaybackTime(media) || 0, true);
          } else if (listEl) {
            listEl.scrollTop = 0;
          }
        });
      }
    }
    lyricsWasVisible = isVisible;

    applySettings();
  }

  function applySettings() {
    if (listEl) listEl.style.fontSize = STATE.fontSize + "px";
    if (panelEl) {
      panelEl.dataset.sync = STATE.syncLevel || "none";
      panelEl.dataset.trackingMode = STATE.trackingEnabled ? "auto" : "off";
      panelEl.dataset.wordTracking = STATE.wordTrackingStyle || "smooth";
      panelEl.dataset.focusFade = STATE.focusFade ? "on" : "off";
    }

    // v1.8.0: 拡張が有効な間はYouTube Music標準歌詞へフォールバックしない。
    // 外部同期歌詞が見つからない場合も、標準歌詞を露出させず拡張パネルに状態を表示する。
    const shouldReplaceNative = STATE.enabled;

    if (panelEl) panelEl.style.display = shouldReplaceNative ? "flex" : "none";
    if (lyricsRendererEl) {
      lyricsRendererEl.classList.toggle("ytmls-replaced", shouldReplaceNative);
    }
    if (document.documentElement) {
      document.documentElement.setAttribute("data-ytmls-enabled", STATE.enabled ? "true" : "false");
    }
    if (resyncButtonEl) resyncButtonEl.hidden = !STATE.enabled;
    if (trackTimingButtonEl) trackTimingButtonEl.hidden = !STATE.enabled;
    updateLyricsToolsUi();
    if (!STATE.enabled) {
      closeTrackTimingPopover();
      closeLyricsToolsPane();
    }
  }

  function setStatus(text) {
    // すでに歌詞を表示できている間は、裏検索の進捗表示で見出しを上書きしない。
    if (STATE.hasLyricsResult && STATE.isSearching &&
        /(探し中|検索中|確認中|準備中|探索中)/.test(String(text || ""))) {
      return;
    }
    STATE.statusText = text;
    if (statusEl) statusEl.textContent = text;
    updatePlayerBarHealth();
  }

  function sourceLabel(source, syncLevel) {
    if (syncLevel === "syllable") return `${source} • 音節追跡中`;
    if (syncLevel === "word") return `${source} • 単語追跡中`;
    if (syncLevel === "line") return `${source} • 行追跡中`;
    return `${source} • 同期なし`;
  }

  // ---------- v1.8.2 取得状態 / 再同期 / 自動復旧 ----------
  function lyricsHealthState() {
    const now = performance.now();
    if (!STATE.enabled) return { key: "off", label: "OFF", title: "歌詞シンクロは無効です" };
    if (STATE.recoveryActiveUntil > now) {
      return { key: "recovering", label: "再同期中", title: STATE.recoveryReason || "歌詞を再同期しています" };
    }
    if (STATE.isSearching) return { key: "searching", label: "取得中", title: STATE.statusText || "同期歌詞を探しています" };
    if (STATE.hasLyricsResult && STATE.hasSync) {
      const detail = STATE.source ? sourceLabel(STATE.source, STATE.syncLevel) : "同期歌詞";
      return { key: STATE.trackingEnabled ? "synced" : "paused", label: STATE.trackingEnabled ? "同期済み" : "追跡OFF", title: detail };
    }
    if (/見つかりません|表示できません/.test(String(STATE.statusText || ""))) {
      return { key: "missing", label: "同期歌詞なし", title: STATE.statusText };
    }
    return { key: "idle", label: "待機中", title: STATE.statusText || "曲を待っています" };
  }

  function updatePlayerBarHealth() {
    const state = lyricsHealthState();
    if (lyricsHealthEl) lyricsHealthEl.dataset.state = state.key;
    if (trackTimingButtonEl) trackTimingButtonEl.setAttribute("aria-label", `歌詞状態: ${state.label}。曲ごとの歌詞タイミングを調整`);
    if (resyncButtonEl) {
      const activeVideoId = getAuthoritativeVideoId();
      resyncButtonEl.disabled = !STATE.enabled || !activeVideoId || STATE.recoveryActiveUntil > performance.now();
      resyncButtonEl.hidden = !STATE.enabled;
      resyncButtonEl.setAttribute("aria-disabled", resyncButtonEl.disabled ? "true" : "false");
    }
  }

  function scheduleRecoveryTicks() {
    setTimeout(tick, 20);
    setTimeout(tick, 180);
    setTimeout(tick, 520);
    setTimeout(tick, 1100);
  }

  function performLyricsResync(reason = "歌詞を再同期中…", automatic = false) {
    if (!STATE.enabled) return false;
    const now = performance.now();
    const activeVideoId = getAuthoritativeVideoId();
    if (!activeVideoId) return false;

    if (automatic) {
      if (STATE.autoRecoveryVideoId !== activeVideoId) {
        STATE.autoRecoveryVideoId = activeVideoId;
        STATE.autoRecoveryCount = 0;
      }
      // 同じ曲で自己復旧を連打しない。最大2回、間隔12秒。
      if (STATE.autoRecoveryCount >= 2 || now - STATE.lastAutoRecoveryAt < 12000) return false;
      STATE.autoRecoveryCount += 1;
      STATE.lastAutoRecoveryAt = now;
    } else {
      // 手動再同期は回数制限しない。
      STATE.autoRecoveryVideoId = activeVideoId;
      STATE.autoRecoveryCount = 0;
    }

    STATE.recoveryActiveUntil = now + 4500;
    STATE.recoveryReason = String(reason || "歌詞を再同期中…");

    // 再同期は「同じ壊れたキャッシュを再表示」ではなく、本当に取り直す。
    // videoIdを含む現在曲のキャッシュだけを破棄し、他曲のキャッシュは維持する。
    let cacheChanged = false;
    for (const cacheKey of Array.from(STATE.lyricsCache.keys())) {
      if (String(cacheKey).endsWith(`::${activeVideoId}`)) {
        STATE.lyricsCache.delete(cacheKey);
        cacheChanged = true;
      }
    }
    if (cacheChanged) saveLyricsCacheToStorage();

    STATE.searchGeneration += 1;
    STATE.lastTrackKey = null;
    STATE.trackCandidateKey = "";
    STATE.trackCandidateSince = 0;
    STATE.currentIndex = -1;
    STATE.currentWordIndex = -1;
    STATE.playbackTransitionPending = false;
    STATE.transitionTargetVideoId = "";
    clearEndedTransitionGuard();
    clearTrackStartGuard();
    manualScrollUntil = 0;
    pendingReturnToCurrent = false;
    STATE.lastTrackingPulseAt = 0;
    clearLyricsForNewTrack(reason);
    openLyricsTabForTrack(activeVideoId);
    updatePlayerBarHealth();
    scheduleRecoveryTicks();
    return true;
  }

  function runAutoRecoveryWatchdog() {
    if (!STATE.enabled) return;
    const snap = getFreshPlayerSnapshot();
    const activeVideoId = getAuthoritativeVideoId();
    if (!activeVideoId) return;
    const now = performance.now();

    if (STATE.healthVideoId !== activeVideoId) {
      STATE.healthVideoId = activeVideoId;
      STATE.healthPlaybackTime = null;
      STATE.healthPlaybackSampleAt = now;
      STATE.healthLastAdvanceAt = now;
      STATE.autoRecoveryVideoId = activeVideoId;
      STATE.autoRecoveryCount = 0;
      STATE.lastAutoRecoveryAt = 0;
      return;
    }

    if (STATE.recoveryActiveUntil > now || STATE.isSearching) return;

    // 表示している歌詞が実再生曲と違う状態は、本来の曲変更処理が取りこぼした時だけ。
    if (STATE.hasLyricsResult && STATE.displayedVideoId && STATE.displayedVideoId !== activeVideoId) {
      performLyricsResync("曲が変わったため歌詞を再同期中…", true);
      return;
    }

    if (!STATE.hasSync || !STATE.trackingEnabled || !snap || snap.playerState !== 1 || !Number.isFinite(snap.currentTime)) return;

    const t = Number(snap.currentTime);
    if (Number.isFinite(STATE.healthPlaybackTime)) {
      const elapsed = Math.max(0.001, (now - STATE.healthPlaybackSampleAt) / 1000);
      const delta = t - Number(STATE.healthPlaybackTime);
      // 再生が実際に前へ進んでいることを確認。シークは監視基準を更新するだけで復旧判定には使わない。
      if (delta >= Math.min(0.20, elapsed * 0.35) && delta < 4.0) STATE.healthLastAdvanceAt = now;
      if (Math.abs(delta) >= 4.0) STATE.healthLastAdvanceAt = now;
    } else {
      STATE.healthLastAdvanceAt = now;
    }
    STATE.healthPlaybackTime = t;
    STATE.healthPlaybackSampleAt = now;

    const playbackAdvancing = now - STATE.healthLastAdvanceAt < 1600;
    const trackingPulseAge = STATE.lastTrackingPulseAt ? now - STATE.lastTrackingPulseAt : Infinity;
    const lyricsHaveSettled = STATE.lyricsAppliedAt > 0 && now - STATE.lyricsAppliedAt > 3600;
    if (lyricsHaveSettled && playbackAdvancing && trackingPulseAge > 3600) {
      performLyricsResync("歌詞追跡が止まったため自動復旧中…", true);
      return;
    }

    // 曲頭なのに最終付近を追っている場合は、旧曲時刻/スクロール状態の残留とみなす。
    // ユーザーが手動スクロール中は絶対に発動しない。
    if (t <= 12 && Math.abs(effectiveTimingOffsetMs()) < 50 && !isManualScrollPaused() && STATE.lines.length >= 8 && STATE.currentIndex >= Math.floor(STATE.lines.length * 0.72)) {
      performLyricsResync("曲頭の歌詞位置が不自然なため自動復旧中…", true);
    }
  }


  // ---------- 曲ごとの歌詞タイミング補正 ----------
  const TRACK_TIMING_OFFSETS_STORAGE_KEY = "ytmlsTrackTimingOffsetsV174";
  const TRACK_TIMING_OFFSETS_MAX_ENTRIES = 500;

  function clampTrackOffsetMs(value) {
    return Math.max(-10000, Math.min(10000, Math.round((Number(value) || 0) / 100) * 100));
  }

  function formatOffsetMs(value, withSign = true) {
    const ms = Number(value) || 0;
    const sec = ms / 1000;
    if (Math.abs(sec) < 0.0001) return '0.0秒';
    const sign = withSign && sec > 0 ? '+' : '';
    return `${sign}${sec.toFixed(1)}秒`;
  }

  function getTrackOffsetVideoId(forLyrics = false) {
    if (forLyrics && STATE.displayedVideoId) return String(STATE.displayedVideoId);
    return String(getAuthoritativeVideoId() || STATE.displayedVideoId || STATE.lastKnownVideoId || '');
  }

  function getTrackTimingOffsetMs(videoId = getTrackOffsetVideoId(true)) {
    return getTrackTimingPoints(videoId)[0].offsetMs;
  }

  function getTrackTimingPoints(videoId = getTrackOffsetVideoId(true)) {
    const id = String(videoId || '');
    if (!id) return [{ position: 0, offsetMs: 0 }];
    const entry = STATE.trackTimingOffsets && STATE.trackTimingOffsets[id];
    if (entry && typeof entry === 'object') {
      if (Array.isArray(entry.points) && entry.points.length) {
        const byPosition = new Map();
        for (const point of entry.points) {
          const rawPosition = Number(point && (point.position ?? point.progress ?? point.ratio));
          if (!Number.isFinite(rawPosition)) continue;
          const position = Math.max(0, Math.min(1, rawPosition));
          // v1.9.3までは曲末の欄を必ず作っていた。v1.9.4では最初は1欄だけにし、
          // 必要な再生位置へユーザーがポイントを足す方式なので、旧来の強制曲末点は移行しない。
          if (position >= 1) continue;
          byPosition.set(Math.round(position * 1000000), {
            position,
            offsetMs: clampTrackOffsetMs(point && point.offsetMs),
          });
        }
        const points = Array.from(byPosition.values()).sort((a, b) => a.position - b.position);
        if (points.length) {
          if (points[0].position > 0) points.unshift({ position: 0, offsetMs: points[0].offsetMs });
          return points;
        }
      }
      const startMs = clampTrackOffsetMs(entry.offsetMs);
      return [{ position: 0, offsetMs: startMs }];
    }
    const legacyMs = clampTrackOffsetMs(entry);
    return [{ position: 0, offsetMs: legacyMs }];
  }

  function getTrackTimingOffsets(videoId = getTrackOffsetVideoId(true)) {
    const points = getTrackTimingPoints(videoId);
    return {
      startMs: points[0].offsetMs,
      endMs: points[points.length - 1].offsetMs,
    };
  }

  function effectiveTimingOffsetMs(playbackTime = null, duration = null) {
    const points = getTrackTimingPoints(getTrackOffsetVideoId(true));
    const media = getVideoElement();
    const time = playbackTime != null && Number.isFinite(Number(playbackTime))
      ? Number(playbackTime)
      : getAuthoritativePlaybackTime(media);
    const total = duration != null && Number.isFinite(Number(duration)) && Number(duration) > 0
      ? Number(duration)
      : getAuthoritativeDuration(media);
    if (!Number.isFinite(time) || !Number.isFinite(total) || total <= 0) return points[0].offsetMs;
    const progress = Math.max(0, Math.min(1, time / total));
    if (progress <= points[0].position) return points[0].offsetMs;
    for (let index = 1; index < points.length; index++) {
      const next = points[index];
      if (progress > next.position) continue;
      const previous = points[index - 1];
      const span = next.position - previous.position;
      if (span <= 0) return next.offsetMs;
      const localProgress = (progress - previous.position) / span;
      return previous.offsetMs + (next.offsetMs - previous.offsetMs) * localProgress;
    }
    return points[points.length - 1].offsetMs;
  }

  function timingOffsetSeconds(playbackTime = null, duration = null) {
    return effectiveTimingOffsetMs(playbackTime, duration) / 1000;
  }

  function playbackTimeForLyricsTime(lyricsTime, duration = null) {
    const lyricsSeconds = Number(lyricsTime);
    if (!Number.isFinite(lyricsSeconds)) return 0;
    // 表示時刻 = 再生時刻 + 位置別補正。補正量も再生位置で変わるため、
    // 歌詞クリック時は数回の逆算で正しい実再生位置を求める。
    let target = Math.max(0, lyricsSeconds - timingOffsetSeconds(lyricsSeconds, duration));
    for (let i = 0; i < 3; i++) {
      target = Math.max(0, lyricsSeconds - timingOffsetSeconds(target, duration));
    }
    return target;
  }

  function loadTrackTimingOffsets() {
    try {
      chrome.storage.local.get({ [TRACK_TIMING_OFFSETS_STORAGE_KEY]: {} }, (data) => {
        const stored = data && data[TRACK_TIMING_OFFSETS_STORAGE_KEY];
        STATE.trackTimingOffsets = stored && typeof stored === 'object' ? stored : {};
        STATE.trackTimingOffsetsLoaded = true;
        updateTrackTimingControl();
        const media = getVideoElement();
        if (media && STATE.hasSync && canTrackCurrentPlayback(media)) {
          STATE.currentIndex = -1;
          STATE.currentWordIndex = -1;
          updateHighlight(getAuthoritativePlaybackTime(media) || 0, true);
        }
      });
    } catch (_) {
      STATE.trackTimingOffsetsLoaded = true;
    }
  }

  function saveTrackTimingOffsets() {
    try {
      const entries = Object.entries(STATE.trackTimingOffsets || {});
      if (entries.length > TRACK_TIMING_OFFSETS_MAX_ENTRIES) {
        entries.sort((a, b) => Number((b[1] && b[1].updatedAt) || 0) - Number((a[1] && a[1].updatedAt) || 0));
        STATE.trackTimingOffsets = Object.fromEntries(entries.slice(0, TRACK_TIMING_OFFSETS_MAX_ENTRIES));
      }
      chrome.storage.local.set({ [TRACK_TIMING_OFFSETS_STORAGE_KEY]: STATE.trackTimingOffsets });
    } catch (_) {}
  }

  function saveCurrentTrackTimingPoints(points, renderPoints = true) {
    const videoId = getTrackOffsetVideoId(false);
    if (!videoId) return;
    const normalized = Array.from(points || [])
      .map((point) => ({
        position: Math.max(0, Math.min(1, Number(point.position) || 0)),
        offsetMs: clampTrackOffsetMs(point.offsetMs),
      }))
      .sort((a, b) => a.position - b.position);
    if (!normalized.length || normalized[0].position > 0) normalized.unshift({ position: 0, offsetMs: 0 });
    if (!STATE.trackTimingOffsets || typeof STATE.trackTimingOffsets !== 'object') STATE.trackTimingOffsets = {};
    const isDefault = normalized.length === 1 && normalized[0].offsetMs === 0;
    if (isDefault) {
      delete STATE.trackTimingOffsets[videoId];
    } else {
      STATE.trackTimingOffsets[videoId] = {
        points: normalized,
        // 古いバージョンへ戻した場合にも曲頭・曲末の値を読めるよう残す。
        offsetMs: normalized[0].offsetMs,
        endOffsetMs: normalized[normalized.length - 1].offsetMs,
        title: String(STATE.stablePlayerTitle || STATE.lastDisplayedTitle || ''),
        artist: String(STATE.stablePlayerArtist || STATE.lastDisplayedArtist || ''),
        updatedAt: Date.now(),
      };
    }
    saveTrackTimingOffsets();
    STATE.currentIndex = -1;
    STATE.currentWordIndex = -1;
    updateTrackTimingControl(renderPoints);
    const media = getVideoElement();
    if (media && STATE.hasSync && canTrackCurrentPlayback(media)) {
      updateHighlight(getAuthoritativePlaybackTime(media) || 0, true);
    }
  }

  function setCurrentTrackTimingPointOffset(position, value, renderPoints = true) {
    const points = getTrackTimingPoints(getTrackOffsetVideoId(false));
    const target = Math.max(0, Math.min(1, Number(position) || 0));
    let closestIndex = 0;
    for (let index = 1; index < points.length; index++) {
      if (Math.abs(points[index].position - target) < Math.abs(points[closestIndex].position - target)) closestIndex = index;
    }
    points[closestIndex] = { ...points[closestIndex], offsetMs: clampTrackOffsetMs(value) };
    saveCurrentTrackTimingPoints(points, renderPoints);
  }

  function addCurrentTrackTimingPoint() {
    const videoId = getTrackOffsetVideoId(false);
    const media = getVideoElement();
    const currentTime = getAuthoritativePlaybackTime(media);
    const duration = getAuthoritativeDuration(media);
    if (!videoId || !Number.isFinite(currentTime) || !Number.isFinite(duration) || duration <= 0) return;
    const position = Math.max(0, Math.min(0.999999, currentTime / duration));
    const points = getTrackTimingPoints(videoId);
    const duplicate = points.find((point) => Math.abs(point.position - position) <= Math.max(0.0005, 0.5 / duration));
    if (!duplicate) {
      points.push({ position, offsetMs: clampTrackOffsetMs(effectiveTimingOffsetMs(currentTime, duration)) });
      saveCurrentTrackTimingPoints(points);
    }
  }

  function removeCurrentTrackTimingPoint(position) {
    const target = Number(position);
    if (!Number.isFinite(target) || target <= 0) return;
    const points = getTrackTimingPoints(getTrackOffsetVideoId(false)).filter((point) => Math.abs(point.position - target) > 0.000001);
    saveCurrentTrackTimingPoints(points);
  }

  function resetCurrentTrackTimingPoints() {
    saveCurrentTrackTimingPoints([{ position: 0, offsetMs: 0 }]);
  }

  function formatTrackPosition(position, duration) {
    if (position <= 0) return '曲の最初';
    const seconds = Number.isFinite(duration) && duration > 0 ? Math.max(0, position * duration) : 0;
    const minutes = Math.floor(seconds / 60);
    const remainder = Math.floor(seconds % 60);
    return `${minutes}:${String(remainder).padStart(2, '0')} から`;
  }

  function renderTrackTimingPoints() {
    if (!trackTimingPointsEl) return;
    const points = getTrackTimingPoints(getTrackOffsetVideoId(false));
    const duration = getAuthoritativeDuration(getVideoElement());
    const signature = `${getTrackOffsetVideoId(false)}|${Math.round(Number(duration) || 0)}|${points.map((point) => `${point.position.toFixed(6)}:${point.offsetMs}`).join(',')}`;
    if (signature === trackTimingPointsSignature && trackTimingPointsEl.childElementCount === points.length) return;
    trackTimingPointsSignature = signature;
    trackTimingPointsEl.replaceChildren();
    const fragment = document.createDocumentFragment();
    for (const point of points) {
      const group = document.createElement('div');
      group.className = 'ytmls-track-offset-group';
      group.dataset.position = String(point.position);
      group.innerHTML = `
        <div class="ytmls-track-offset-row">
          <span class="ytmls-track-offset-point-label"></span>
          <span class="ytmls-track-offset-point-actions">
            <button type="button" class="ytmls-track-offset-delete" aria-label="この補正ポイントを削除" hidden>削除</button>
            <strong class="ytmls-track-offset-value">0.0秒</strong>
          </span>
        </div>
        <input class="ytmls-track-offset-range" type="range" min="-10000" max="10000" step="100" value="0" aria-label="歌詞タイミング補正" />
        <div class="ytmls-track-offset-quick">
          <button type="button" data-delta="-500">−0.5</button><button type="button" data-delta="-100">−0.1</button>
          <button type="button" data-reset-point="1">0</button>
          <button type="button" data-delta="100">＋0.1</button><button type="button" data-delta="500">＋0.5</button>
        </div>`;
      group.querySelector('.ytmls-track-offset-point-label').textContent = formatTrackPosition(point.position, duration);
      group.querySelector('.ytmls-track-offset-value').textContent = formatOffsetMs(point.offsetMs);
      const range = group.querySelector('.ytmls-track-offset-range');
      range.value = String(point.offsetMs);
      range.setAttribute('aria-label', `${formatTrackPosition(point.position, duration)}の歌詞タイミング補正`);
      range.addEventListener('input', () => {
        group.querySelector('.ytmls-track-offset-value').textContent = formatOffsetMs(range.value);
        setCurrentTrackTimingPointOffset(point.position, range.value, false);
      });
      for (const button of group.querySelectorAll('[data-delta]')) {
        button.addEventListener('click', () => {
          const latest = getTrackTimingPoints(getTrackOffsetVideoId(false));
          const current = latest.find((candidate) => Math.abs(candidate.position - point.position) < 0.000001);
          setCurrentTrackTimingPointOffset(point.position, Number((current && current.offsetMs) || 0) + Number(button.dataset.delta || 0));
        });
      }
      group.querySelector('[data-reset-point]').addEventListener('click', () => setCurrentTrackTimingPointOffset(point.position, 0));
      const deleteButton = group.querySelector('.ytmls-track-offset-delete');
      if (point.position > 0) {
        deleteButton.hidden = false;
        deleteButton.addEventListener('click', () => removeCurrentTrackTimingPoint(point.position));
      }
      fragment.appendChild(group);
    }
    trackTimingPointsEl.appendChild(fragment);
  }

  function positionTrackTimingPopover() {
    if (!trackTimingPopoverEl || !trackTimingButtonEl || trackTimingPopoverEl.hidden) return;
    const rect = trackTimingButtonEl.getBoundingClientRect();
    const width = trackTimingPopoverEl.offsetWidth || 330;
    const height = trackTimingPopoverEl.offsetHeight || 230;
    const left = Math.max(12, Math.min(window.innerWidth - width - 12, rect.left + rect.width / 2 - width / 2));
    let top = rect.top - height - 12;
    if (top < 12) top = Math.min(window.innerHeight - height - 12, rect.bottom + 12);
    trackTimingPopoverEl.style.left = `${Math.round(left)}px`;
    trackTimingPopoverEl.style.top = `${Math.round(Math.max(12, top))}px`;
  }

  function updateTrackTimingControl(renderPoints = true) {
    if (!trackTimingButtonEl) return;
    const videoId = getTrackOffsetVideoId(false);
    const points = getTrackTimingPoints(videoId);
    const enabled = Boolean(STATE.enabled && videoId && STATE.trackTimingOffsetsLoaded);
    trackTimingButtonEl.disabled = !enabled;
    trackTimingButtonEl.hidden = !STATE.enabled;
    trackTimingButtonEl.setAttribute('aria-disabled', enabled ? 'false' : 'true');
    const currentMs = effectiveTimingOffsetMs();
    const customPointCount = Math.max(0, points.length - 1);
    const offsetSummary = formatOffsetMs(currentMs);
    if (trackTimingButtonLabelEl) trackTimingButtonLabelEl.textContent = `歌詞 ${offsetSummary}`;
    const health = lyricsHealthState();
    trackTimingButtonEl.title = enabled
      ? `歌詞状態: ${health.label}\n現在位置の補正: ${offsetSummary}（途中の補正ポイント ${customPointCount}個）`
      : `歌詞状態: ${health.label}\n曲を検出すると歌詞タイミングを調整できます`;

    if (trackTimingTitleEl) trackTimingTitleEl.textContent = String(STATE.stablePlayerTitle || STATE.lastDisplayedTitle || '現在の曲');
    if (trackTimingAddPointEl) {
      const media = getVideoElement();
      const time = getAuthoritativePlaybackTime(media);
      const duration = getAuthoritativeDuration(media);
      trackTimingAddPointEl.disabled = !enabled || !Number.isFinite(time) || !Number.isFinite(duration) || duration <= 0;
    }
    if (renderPoints && trackTimingPopoverEl && !trackTimingPopoverEl.hidden) renderTrackTimingPoints();
    if (trackTimingTotalEl) {
      trackTimingTotalEl.textContent = `現在位置の補正: ${formatOffsetMs(currentMs)} ・ 途中のポイント ${customPointCount}個 ・ この曲だけに保存`;
    }
    if (renderPoints) positionTrackTimingPopover();
  }

  function closeTrackTimingPopover() {
    if (trackTimingPopoverEl) trackTimingPopoverEl.hidden = true;
    if (trackTimingButtonEl) trackTimingButtonEl.setAttribute('aria-expanded', 'false');
  }

  function ensurePlayerBarTimingControl() {
    const playerBar = document.querySelector('ytmusic-player-bar');
    if (!playerBar) return;
    const host = playerBar.querySelector('.middle-controls .middle-controls-buttons') ||
      playerBar.querySelector('.middle-controls-buttons');
    if (!host) return;


    if (!resyncButtonEl || !resyncButtonEl.isConnected) {
      const button = document.createElement('button');
      button.id = 'ytmls-resync-button';
      button.type = 'button';
      button.title = '現在の曲の歌詞を再取得・再同期';
      button.setAttribute('aria-label', '歌詞を再同期');
      button.innerHTML = `
        <svg class="ytmls-resync-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M17.65 6.35A7.95 7.95 0 0 0 12 4a8 8 0 1 0 7.75 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35Z"/>
        </svg>`;
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (button.disabled) return;
        performLyricsResync('手動で歌詞を再同期中…', false);
      });
      host.appendChild(button);
      resyncButtonEl = button;
    } else if (resyncButtonEl.parentElement !== host) {
      host.appendChild(resyncButtonEl);
    }

    if (!trackTimingButtonEl || !trackTimingButtonEl.isConnected) {
      const button = document.createElement('button');
      button.id = 'ytmls-track-offset-button';
      button.type = 'button';
      button.setAttribute('aria-haspopup', 'dialog');
      button.setAttribute('aria-expanded', 'false');
      button.innerHTML = `
        <span class="ytmls-track-health" data-state="idle" aria-hidden="true"></span>
        <svg class="ytmls-track-offset-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 2a10 10 0 1 0 10 10A10.011 10.011 0 0 0 12 2Zm0 18a8 8 0 1 1 8-8 8.009 8.009 0 0 1-8 8Zm1-13h-2v6l5.2 3.1 1-1.7-4.2-2.5Z"/>
        </svg>
        <span class="ytmls-track-offset-label">歌詞 0.0秒</span>`;
      host.appendChild(button);
      trackTimingButtonEl = button;
      trackTimingButtonLabelEl = button.querySelector('.ytmls-track-offset-label');
      lyricsHealthEl = button.querySelector('.ytmls-track-health');

      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (button.disabled) return;
        ensureTrackTimingPopover();
        const willOpen = trackTimingPopoverEl.hidden;
        trackTimingPopoverEl.hidden = !willOpen;
        button.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
        updateTrackTimingControl();
        if (willOpen) requestAnimationFrame(positionTrackTimingPopover);
      });
    } else if (trackTimingButtonEl.parentElement !== host) {
      host.appendChild(trackTimingButtonEl);
    }

    ensureTrackTimingPopover();
    // tick()から300msごとに呼ばれるため、一覧DOMは変更せず現在値だけ更新する。
    updateTrackTimingControl(false);
    updatePlayerBarHealth();
  }

  function ensureTrackTimingPopover() {
    if (trackTimingPopoverEl && trackTimingPopoverEl.isConnected) return;
    const pop = document.createElement('div');
    pop.id = 'ytmls-track-offset-popover';
    pop.hidden = true;
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', '曲ごとの歌詞タイミング補正');
    pop.innerHTML = `
      <div class="ytmls-track-offset-head">
        <div>
          <div class="ytmls-track-offset-heading">この曲の歌詞タイミング</div>
          <div class="ytmls-track-offset-track">現在の曲</div>
        </div>
        <button type="button" class="ytmls-track-offset-close" aria-label="閉じる">×</button>
      </div>
      <div class="ytmls-track-offset-help ytmls-track-offset-intro">最初は補正欄が1つだけです。合わせたい場所まで再生してポイントを追加すると、その位置以降の補正を変更できます。ポイントは何個でも追加できます。</div>
      <button type="button" class="ytmls-track-offset-add">＋ 現在位置に補正ポイントを追加</button>
      <div class="ytmls-track-offset-points"></div>
      <button type="button" class="ytmls-track-offset-reset-all" data-reset="1">すべての補正を削除</button>
      <div class="ytmls-track-offset-total"></div>`;
    document.body.appendChild(pop);
    trackTimingPopoverEl = pop;
    trackTimingPointsEl = pop.querySelector('.ytmls-track-offset-points');
    trackTimingAddPointEl = pop.querySelector('.ytmls-track-offset-add');
    trackTimingTitleEl = pop.querySelector('.ytmls-track-offset-track');
    trackTimingTotalEl = pop.querySelector('.ytmls-track-offset-total');

    pop.addEventListener('click', (event) => event.stopPropagation());
    pop.querySelector('.ytmls-track-offset-close').addEventListener('click', closeTrackTimingPopover);
    trackTimingAddPointEl.addEventListener('click', addCurrentTrackTimingPoint);
    const resetButton = pop.querySelector('[data-reset]');
    if (resetButton) {
      resetButton.addEventListener('click', () => {
        const confirmed = window.confirm('この曲の補正ポイントと補正値をすべて削除します。\n本当に削除しますか？');
        if (confirmed) resetCurrentTrackTimingPoints();
      });
    }
    renderTrackTimingPoints();

    document.addEventListener('click', (event) => {
      if (!trackTimingPopoverEl || trackTimingPopoverEl.hidden) return;
      if (trackTimingPopoverEl.contains(event.target) || (trackTimingButtonEl && trackTimingButtonEl.contains(event.target))) return;
      closeTrackTimingPopover();
    });
    window.addEventListener('resize', positionTrackTimingPopover, { passive: true });
  }

  function resetLyricsScrollPosition() {
    if (!listEl) return;

    // 旧曲で開始済みの smooth scroll を確実に打ち切る。
    // CSS の scroll-behavior:smooth が有効なまま scrollTop=0 だけを行うと、
    // 高速な曲送り時に前のスクロールアニメーションが残って新曲を下へ引っ張ることがある。
    listEl.style.scrollBehavior = "auto";
    autoScrollUntil = performance.now() + 300;
    try {
      listEl.scrollTo({ top: 0, behavior: "auto" });
    } catch (_) {
      listEl.scrollTop = 0;
    }
    listEl.scrollTop = 0;
    if (lyricsRendererEl) lyricsRendererEl.scrollTop = 0;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!listEl) return;
        listEl.style.removeProperty("scroll-behavior");
      });
    });
  }

  function renderLines(options = {}) {
    if (!listEl) return;

    const resetScroll = Boolean(options.resetScroll);
    if (resetScroll) {
      resetLyricsScrollPosition();
    }

    listEl.innerHTML = "";
    STATE.currentIndex = -1;
    STATE.currentWordIndex = -1;

    if (!STATE.lines.length) {
      if (STATE.isSearching) {
        const searching = document.createElement("div");
        searching.id = "ytmls-searching";

        const spinner = document.createElement("span");
        spinner.className = "ytmls-spinner";
        spinner.setAttribute("aria-hidden", "true");

        const textWrap = document.createElement("div");
        textWrap.className = "ytmls-searching-text";

        const main = document.createElement("div");
        main.className = "ytmls-searching-main";
        main.textContent = "歌詞を探し中…";

        const sub = document.createElement("div");
        sub.className = "ytmls-searching-sub";
        sub.textContent = STATE.statusText;

        textWrap.appendChild(main);
        textWrap.appendChild(sub);
        searching.appendChild(spinner);
        searching.appendChild(textWrap);
        listEl.appendChild(searching);
      } else {
        const empty = document.createElement("div");
        empty.id = "ytmls-empty";
        const main = document.createElement("div");
        main.className = "ytmls-empty-main";
        main.textContent = "カスタム歌詞を表示できませんでした";
        const sub = document.createElement("div");
        sub.className = "ytmls-empty-sub";
        sub.textContent = STATE.statusText || "追跡できる同期歌詞が見つかりませんでした";
        empty.appendChild(main);
        empty.appendChild(sub);
        listEl.appendChild(empty);
      }
      return;
    }

    STATE.lines.forEach((line, i) => {
      const div = document.createElement("div");
      div.className = "ytmls-line";
      div.dataset.index = String(i);
      if (line.agent) div.dataset.agent = line.agent;
      if (line.dir) div.dir = line.dir;

      if (Array.isArray(line.words) && line.words.length) {
        div.classList.add("ytmls-rich-line");
        line.words.forEach((word, wi) => {
          const span = document.createElement("span");
          span.className = "ytmls-word";
          if (word.background) span.classList.add("ytmls-background-word");
          span.dataset.wordIndex = String(wi);
          span.textContent = word.text || "";
          div.appendChild(span);
        });
      } else {
        div.textContent = line.text || "♪";
      }

      if (line.time != null) {
        div.title = "クリックでこの位置へ移動";
        const renderedTrackKey = STATE.lastDisplayedTrackKey;
        const renderedVideoId = STATE.displayedVideoId;
        div.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          // 古い曲の歌詞DOMが一瞬残っていても、前曲へ誤シークしない。
          const currentVideoId = getAuthoritativeVideoId();
          if (!STATE.enabled || renderedTrackKey !== STATE.lastDisplayedTrackKey) return;
          if (!renderedVideoId || !currentVideoId || renderedVideoId !== currentVideoId) {
            detectImmediateTrackTransition();
            tick();
            return;
          }

          const video = getVideoElement();
          // 曲切り替え中は旧media要素のcurrentTimeを直接触らない。
          if (!Number.isFinite(line.time) || !canTrackCurrentPlayback(video)) return;
          // 表示側は currentTime + offset で追跡するため、クリック時は逆算して実再生位置へシーク。
          const duration = getAuthoritativeDuration(video);
          let target = playbackTimeForLyricsTime(line.time, duration);
          if (Number.isFinite(duration) && duration > 0) {
            target = Math.min(target, Math.max(0, duration - 0.05));
          }
          // v1.7.2: DOMのvideoが前曲要素でも、現在のYouTubeプレイヤー本体だけをseekする。
          // bridge側でもvideoId一致を再確認するため、前曲へ誤シークできない。
          if (requestPlayerSeek(currentVideoId, target)) {
            updateHighlight(target, true);
          }
        });
      }

      listEl.appendChild(div);
    });

    const video = getVideoElement();
    if (video && STATE.hasSync && canTrackCurrentPlayback(video)) {
      updateHighlight(getAuthoritativePlaybackTime(video) || 0, true);
    }
  }

  function refreshSearchingSubtext() {
    if (!listEl || !STATE.isSearching) return;
    const sub = listEl.querySelector(".ytmls-searching-sub");
    if (sub) sub.textContent = STATE.statusText;
  }

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

  // ---------- 文字列正規化・検索候補 ----------
  function uniq(values) {
    return [...new Set(values.map((v) => (v || "").trim()).filter(Boolean))];
  }

  function normalizeForCompare(value) {
    return (value || "")
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[’'`]/g, "")
      .replace(/[\s\-‐‑‒–—―_・･·•:：/\\|,，.。!?！？()（）\[\]【】{}「」『』]/g, "");
  }

  function cleanTitle(value) {
    let s = (value || "").normalize("NFKC").trim();
    s = s.replace(
      /[\s　]*[\(\[【（][^\)\]】）]*(official|music\s*video|mv|pv|audio|visualizer|lyric|lyrics|歌詞|full|short|remaster(?:ed)?|live|字幕|和訳)[^\)\]】）]*[\)\]】）]/gi,
      ""
    );
    s = s.replace(/[\s　]+(?:official\s*)?(?:music\s*)?(?:video|mv|pv|audio|visualizer|lyrics?)\s*$/gi, "");
    s = s.replace(/[\s　]*[-–—｜|]\s*(?:official\s*)?(?:music\s*)?(?:video|mv|pv|audio|visualizer|lyrics?).*$/gi, "");
    return s.replace(/\s{2,}/g, " ").trim();
  }

  function stripFeaturing(value) {
    return (value || "")
      .replace(/[\s　]*[\(\[【（]?\s*(?:feat\.?|ft\.?|featuring)\s+[^\)\]】）]+[\)\]】）]?/gi, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  function stripAllBrackets(value) {
    return (value || "")
      .replace(/\s*[\(（\[【][^\)）\]】]*[\)）\]】]\s*/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  function cleanArtist(value) {
    return (value || "")
      .normalize("NFKC")
      .replace(/\s*[-–—]\s*Topic\s*$/i, "")
      .replace(/\s*VEVO\s*$/i, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  function titleVariants(title) {
    const cleaned = cleanTitle(title);
    const noFeat = stripFeaturing(cleaned);
    const noBrackets = stripAllBrackets(noFeat);
    const beforeSlash = noBrackets.split(/\s+[\/｜|]\s+/)[0]?.trim();
    return uniq([title, cleaned, noFeat, noBrackets, beforeSlash]);
  }

  function artistVariants(artist) {
    const cleaned = cleanArtist(artist);
    const firstArtist = cleaned.split(/\s*(?:,|、|&|＆|×| x |\/|／)\s*/i)[0]?.trim();
    return uniq([artist, cleaned, firstArtist]);
  }

  // ---------- LRC ----------
  function parseLRC(lrcText) {
    const lines = [];
    let globalOffset = 0;
    const offsetMatch = (lrcText || "").match(/\[offset:([+-]?\d+(?:\.\d+)?)\]/i);
    if (offsetMatch) {
      const raw = Number(offsetMatch[1]);
      // LRC標準はms。ただし一部ソースは秒小数を返すため、小さい小数は秒として扱う。
      globalOffset = Number.isFinite(raw) ? (Math.abs(raw) < 20 && String(offsetMatch[1]).includes(".") ? raw : raw / 1000) : 0;
    }

    const timeTagRe = /\[(\d{1,2}):(\d{2}(?:\.\d{1,3})?)\]/g;

    (lrcText || "").split(/\r?\n/).forEach((rawLine) => {
      const tags = [...rawLine.matchAll(timeTagRe)];
      if (!tags.length) return;

      // BetterLyrics/Musixmatch系の拡張ワードタグは表示本文から除去。
      const text = rawLine
        .replace(timeTagRe, "")
        .replace(/<[^>]+>/g, "")
        .trim();

      tags.forEach((m) => {
        const minutes = parseInt(m[1], 10);
        const seconds = parseFloat(m[2]);
        lines.push({
          time: Math.max(0, minutes * 60 + seconds + globalOffset),
          end: null,
          text,
          words: [],
        });
      });
    });

    lines.sort((a, b) => a.time - b.time);
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].end == null) lines[i].end = lines[i + 1]?.time ?? null;
    }
    return lines;
  }

  // ---------- TTML (Better Lyrics / BiniLyrics / Unison) ----------
  function parseTtmlTime(value) {
    if (!value) return null;
    const s = String(value).trim();
    if (!s) return null;

    if (/^\d+(?:\.\d+)?ms$/i.test(s)) return Number.parseFloat(s) / 1000;
    if (/^\d+(?:\.\d+)?s$/i.test(s)) return Number.parseFloat(s);

    const parts = s.split(":");
    if (parts.length === 3) {
      const h = Number(parts[0]);
      const m = Number(parts[1]);
      const sec = Number(parts[2]);
      if ([h, m, sec].every(Number.isFinite)) return h * 3600 + m * 60 + sec;
    }
    if (parts.length === 2) {
      const m = Number(parts[0]);
      const sec = Number(parts[1]);
      if ([m, sec].every(Number.isFinite)) return m * 60 + sec;
    }

    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  function detectDirection(lang) {
    const base = (lang || "").toLowerCase().split(/[-_]/)[0];
    return ["ar", "he", "fa", "ur"].includes(base) ? "rtl" : "auto";
  }

  function getAttrAny(el, names) {
    for (const name of names) {
      const value = el.getAttribute(name);
      if (value != null) return value;
    }
    return null;
  }

  function collectTimedSpans(element, inheritedBackground, output) {
    for (const node of element.childNodes) {
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      const el = node;
      const localName = (el.localName || el.tagName || "").toLowerCase();
      if (localName !== "span") continue;

      const role = getAttrAny(el, ["ttm:role", "role"]);
      const isBackground = inheritedBackground || role === "x-bg";
      const begin = parseTtmlTime(el.getAttribute("begin"));
      const end = parseTtmlTime(el.getAttribute("end"));
      const hasTimedChild = Array.from(el.children).some(
        (child) => (child.localName || child.tagName || "").toLowerCase() === "span" && child.getAttribute("begin")
      );

      if (begin != null && !hasTimedChild) {
        output.push({
          text: el.textContent || "",
          time: begin,
          end: end != null ? end : begin,
          background: isBackground,
        });
      } else {
        collectTimedSpans(el, isBackground, output);
      }
    }
  }

  function parseTTML(ttmlString) {
    if (!ttmlString || typeof ttmlString !== "string") return { lines: [], syncLevel: "none" };

    const parser = new DOMParser();
    const doc = parser.parseFromString(ttmlString, "text/xml");
    if (doc.querySelector("parsererror")) return { lines: [], syncLevel: "none" };

    const root = doc.documentElement;
    const lang = getAttrAny(root, ["xml:lang", "lang"]) || "";
    const dir = detectDirection(lang);
    const lines = [];
    let hasWords = false;

    doc.querySelectorAll("p").forEach((p) => {
      const begin = parseTtmlTime(p.getAttribute("begin"));
      const end = parseTtmlTime(p.getAttribute("end"));
      if (begin == null) return;

      const words = [];
      collectTimedSpans(p, false, words);
      const text = (p.textContent || "").trim();
      if (!text && !words.length) return;

      if (words.length) hasWords = true;
      lines.push({
        time: begin,
        end: end != null ? end : (words.length ? words[words.length - 1].end : null),
        text: text || words.map((w) => w.text).join(""),
        words,
        agent: getAttrAny(p, ["ttm:agent", "agent"]) || "",
        dir,
      });
    });

    lines.sort((a, b) => a.time - b.time);
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].end == null) lines[i].end = lines[i + 1]?.time ?? null;
    }

    // TTMLのspanタイミングは実質ワード/音節同期。Better Lyrics本体は音節同期として扱う。
    return { lines, syncLevel: hasWords ? "syllable" : (lines.length ? "line" : "none") };
  }

  function parseRichLrcWithWordRows(lrcText) {
    // Bini/YouLy+系で [mm:ss]行の次に <word:start:end|...> が来る形式を軽くサポート。
    const rows = (lrcText || "").split(/\r?\n/);
    const base = parseLRC(lrcText);
    if (!base.length) return { lines: [], syncLevel: "none" };

    let baseCursor = 0;
    let pendingLineIndices = [];
    for (const raw of rows) {
      const tags = [...raw.matchAll(/\[(\d{1,2}):(\d{2}(?:\.\d{1,3})?)\]/g)];
      if (tags.length) {
        pendingLineIndices = Array.from({ length: tags.length }, (_, index) => baseCursor + index);
        baseCursor += tags.length;
        continue;
      }
      if (!pendingLineIndices.length || !/^<.*>$/.test(raw.trim())) continue;
      const body = raw.trim().slice(1, -1);
      const pieces = body.split("|");
      const words = [];
      for (const piece of pieces) {
        const m = piece.match(/^(.*?):([0-9.]+):([0-9.]+)$/);
        if (!m) continue;
        words.push({
          text: m[1],
          time: Number(m[2]),
          end: Number(m[3]),
          background: false,
        });
      }
      if (words.length) {
        const firstLine = base[pendingLineIndices[0]];
        for (const lineIndex of pendingLineIndices) {
          const line = base[lineIndex];
          if (!line) continue;
          const shift = firstLine && Number.isFinite(firstLine.time) && Number.isFinite(line.time)
            ? line.time - firstLine.time
            : 0;
          line.words = words.map((word) => ({
            ...word,
            time: word.time + shift,
            end: word.end + shift,
          }));
        }
      }
      pendingLineIndices = [];
    }

    const hasWords = base.some((line) => line.words && line.words.length);
    return { lines: base, syncLevel: hasWords ? "word" : "line" };
  }

  // ---------- バックグラウンド経由HTTP ----------
  async function fetchRemote(url, responseType = "json", options = {}) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const result = await chrome.runtime.sendMessage({
          type: "YTMLS_FETCH",
          url,
          responseType,
          method: options.method || "GET",
          body: options.body ?? null,
          headers: options.headers || null,
          credentials: options.credentials || "omit",
          timeoutMs: options.timeoutMs || 25000,
        });
        if (!result) return { ok: false, status: 0, data: null };

        if (result.status === 429) {
          const retrySeconds = Math.max(1, Number(result.retryAfter) || 1);
          await sleep(Math.min(retrySeconds * 1000, 8000));
          continue;
        }
        return result;
      } catch (_) {
        if (attempt < 2) {
          await sleep(350 * (attempt + 1));
          continue;
        }
        return { ok: false, status: 0, data: null };
      }
    }
    return { ok: false, status: 429, data: null };
  }

  async function fetchJson(url, options = {}) {
    return fetchRemote(url, "json", options);
  }

  async function fetchText(url, options = {}) {
    return fetchRemote(url, "text", options);
  }

  function scoreResult(item, title, artist, duration) {
    if (!item) return -999;
    const wantedTitle = normalizeForCompare(title);
    const gotTitle = normalizeForCompare(item.trackName || item.track_name || item.song || item.name || "");
    const wantedArtist = normalizeForCompare(artist);
    const gotArtist = normalizeForCompare(item.artistName || item.artist_name || item.artist || "");

    // 曲名だけが同じ別アーティストを採用しない。以前はタイトル完全一致だけで
    // 100点になり、Queenなど有名曲の歌詞が同名の日本語曲へ入ることがあった。
    if (!searchResultMatchesTrack(item, title, artist, duration)) return -999;

    let score = 0;
    if (gotTitle === wantedTitle) score += 100;
    else if (gotTitle && (gotTitle.includes(wantedTitle) || wantedTitle.includes(gotTitle))) score += 55;

    if (wantedArtist && gotArtist === wantedArtist) score += 60;
    else if (wantedArtist && gotArtist && artistsLikelySame(artist, item.artistName || item.artist_name || item.artist || "")) score += 45;

    if (item.syncedLyrics || item.synced_lyrics || item.ttml) score += 35;
    else if (item.plainLyrics || item.plain_lyrics || item.lyrics) score += 10;

    if (duration && Number.isFinite(Number(item.duration))) {
      const diff = Math.abs(Number(item.duration) - duration);
      if (diff <= 2) score += 45;
      else if (diff <= 5) score += 25;
      else if (diff <= 12) score += 8;
      else score -= Math.min(35, diff / 5);
    }

    return score;
  }

  function normalizedArtistForCompare(value) {
    return normalizeForCompare(
      cleanArtist(value || "")
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
    );
  }

  function artistTokens(value) {
    return cleanArtist(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/\b(?:official|music|channel|topic|vevo)\b/g, " ")
      .match(/[\p{L}\p{N}]+/gu) || [];
  }

  function singleArtistLikelySame(wanted, got) {
    const a = normalizedArtistForCompare(wanted);
    const b = normalizedArtistForCompare(got);
    if (!a || !b) return false;
    if (a === b) return true;
    if (Math.min(a.length, b.length) >= 3 && (a.includes(b) || b.includes(a))) return true;

    // "Masayoshi Oishi" と "Oishi Masayoshi" のような語順違いを許可する。
    const aTokens = [...new Set(artistTokens(wanted))];
    const bTokens = [...new Set(artistTokens(got))];
    if (aTokens.length < 2 || bTokens.length < 2) return false;
    const shorter = aTokens.length <= bTokens.length ? aTokens : bTokens;
    const longer = aTokens.length <= bTokens.length ? bTokens : aTokens;
    return shorter.every((token) => longer.includes(token));
  }

  function artistsLikelySame(wanted, got) {
    const splitArtists = (value) => uniq(
      cleanArtist(value || "").split(/\s*(?:,|、|&|＆|×|\bx\b|\/|／|;|；)\s*/i)
    );
    const wantedParts = splitArtists(wanted);
    const gotParts = splitArtists(got);
    if (!wantedParts.length || !gotParts.length) return false;
    return wantedParts.some((a) => gotParts.some((b) => singleArtistLikelySame(a, b)));
  }

  function titlesLikelySameForSearch(wanted, got) {
    const a = normalizeForCompare(stripFeaturing(cleanTitle(wanted || "")));
    const b = normalizeForCompare(stripFeaturing(cleanTitle(got || "")));
    if (!a || !b) return false;
    return a === b || (Math.min(a.length, b.length) >= 5 && (a.includes(b) || b.includes(a)));
  }

  function searchResultMatchesTrack(item, title, artist, duration) {
    if (!item) return false;
    const gotTitle = item.trackName || item.track_name || item.song || item.name || "";
    const gotArtist = item.artistName || item.artist_name || item.artist || "";
    if (!titlesLikelySameForSearch(title, gotTitle)) return false;

    // 検索対象に歌手名がある場合、結果側の歌手名も必須とし、不一致なら拒否する。
    // 「見つからない」方を「別人の同名曲」より優先する安全側の判定。
    if (String(artist || "").trim()) {
      if (!String(gotArtist || "").trim() || !artistsLikelySame(artist, gotArtist)) return false;
    }

    const wantedDuration = Number(duration);
    const gotDuration = Number(item.duration);
    if (Number.isFinite(wantedDuration) && wantedDuration > 0 && Number.isFinite(gotDuration) && gotDuration > 0) {
      const maxDifference = Math.max(12, wantedDuration * 0.06);
      if (Math.abs(gotDuration - wantedDuration) > maxDifference) return false;
    }
    return true;
  }

  function hasSearchResultMetadata(item) {
    if (!item || typeof item !== "object") return false;
    const title = item.trackName || item.track_name || item.song || item.name || "";
    const artist = item.artistName || item.artist_name || item.artist || "";
    return Boolean(String(title).trim() || String(artist).trim());
  }

  function bestSearchResult(arr, title, artist, duration) {
    if (!Array.isArray(arr) || !arr.length) return null;
    const scored = arr
      .map((item) => ({ item, score: scoreResult(item, title, artist, duration) }))
      .sort((a, b) => b.score - a.score);
    return scored[0] && scored[0].score >= 120 ? scored[0].item : null;
  }

  function buildBoiduParams(info, duration) {
    const p = new URLSearchParams({ s: cleanTitle(info.title), a: cleanArtist(info.artist) });
    if (info.album) p.set("al", info.album);
    if (duration) p.set("d", String(Math.round(duration)));
    return p;
  }

  // ---------- Better Lyrics 2.3.3 現行バックエンド ----------
  const BETTER_LYRICS_V2_BASE = "https://lyrics.api.dacubeking.com/";
  const BETTER_LYRICS_JWT_KEY = "ytmlsBetterLyricsJwt";

  function parseJwtExpiry(token) {
    try {
      const payload = token.split(".")[1];
      if (!payload) return 0;
      const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
      const padded = normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), "=");
      const data = JSON.parse(atob(padded));
      return Number(data.exp || 0);
    } catch (_) {
      return 0;
    }
  }

  function storageLocalGet(key) {
    return new Promise((resolve) => {
      try { chrome.storage.local.get([key], (data) => resolve(data ? data[key] : null)); }
      catch (_) { resolve(null); }
    });
  }

  function storageLocalSet(obj) {
    return new Promise((resolve) => {
      try { chrome.storage.local.set(obj, () => resolve()); }
      catch (_) { resolve(); }
    });
  }

  function getTurnstileToken(trackKey) {
    return new Promise((resolve) => {
      if (trackKey !== STATE.lastTrackKey) return resolve(null);
      const iframe = document.createElement("iframe");
      iframe.src = BETTER_LYRICS_V2_BASE + "challenge";
      iframe.style.cssText = "position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:.01;pointer-events:none;z-index:-1";
      iframe.setAttribute("aria-hidden", "true");

      let done = false;
      const finish = (token) => {
        if (done) return;
        done = true;
        window.removeEventListener("message", onMessage);
        clearTimeout(timer);
        try { iframe.remove(); } catch (_) {}
        resolve(token || null);
      };
      const onMessage = (event) => {
        if (event.source !== iframe.contentWindow) return;
        if (event.origin !== "https://lyrics.api.dacubeking.com") return;
        if (event.data && event.data.type === "turnstile-token") finish(String(event.data.token || ""));
        else if (event.data && (event.data.type === "turnstile-error" || event.data.type === "turnstile-timeout")) finish(null);
      };
      const timer = setTimeout(() => finish(null), 12000);
      window.addEventListener("message", onMessage);
      document.body.appendChild(iframe);
    });
  }

  async function getBetterLyricsJwt(trackKey, forceNew = false) {
    if (!forceNew) {
      const saved = await storageLocalGet(BETTER_LYRICS_JWT_KEY);
      if (typeof saved === "string" && saved) {
        const exp = parseJwtExpiry(saved);
        if (exp > Date.now() / 1000 + 60) return saved;
      }
    }

    setStatus("Better Lyrics本体と同じ認証を準備中…");
    refreshSearchingSubtext();
    const challengeToken = await getTurnstileToken(trackKey);
    if (!challengeToken || trackKey !== STATE.lastTrackKey) return null;

    const res = await fetchJson(BETTER_LYRICS_V2_BASE + "verify-turnstile", {
      method: "POST",
      body: JSON.stringify({ token: challengeToken }),
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      timeoutMs: 15000,
    });
    const jwt = res.ok && res.data && typeof res.data.jwt === "string" ? res.data.jwt : null;
    if (jwt) await storageLocalSet({ [BETTER_LYRICS_JWT_KEY]: jwt });
    return jwt;
  }

  function angleTimeToSeconds(tag) {
    const m = String(tag || "").match(/^(\d{1,2}):(\d{2}(?:\.\d+)?)$/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  }

  function parseInlineTimedLrc(lrcText) {
    const base = parseLRC(lrcText);
    if (!base.length) return { lines: [], syncLevel: "none" };
    const rawRows = String(lrcText || "").split(/\r?\n/).filter((x) => /\[\d{1,2}:\d{2}/.test(x));
    let bi = 0;
    for (const raw of rawRows) {
      if (!base[bi]) break;
      const lineTags = [...raw.matchAll(/\[(\d{1,2}):(\d{2}(?:\.\d{1,3})?)\]/g)];
      const expandedCount = Math.max(1, lineTags.length);
      const content = raw.replace(/^\s*(?:\[\d{1,2}:\d{2}(?:\.\d{1,3})?\])+\s*/, "");
      const tagRe = /<(\d{1,2}:\d{2}(?:\.\d+)?)>/g;
      const matches = [...content.matchAll(tagRe)];
      if (matches.length >= 2) {
        const words = [];
        for (let i = 0; i < matches.length - 1; i++) {
          const start = angleTimeToSeconds(matches[i][1]);
          const end = angleTimeToSeconds(matches[i + 1][1]);
          const text = content.slice(matches[i].index + matches[i][0].length, matches[i + 1].index).trim();
          if (text && start != null && end != null && end >= start) {
            words.push({ text, time: start, end, background: false });
          }
        }
        if (words.length) {
          const firstLineTime = Number(base[bi].time);
          for (let copyIndex = 0; copyIndex < expandedCount; copyIndex++) {
            const line = base[bi + copyIndex];
            if (!line) continue;
            const shift = Number.isFinite(firstLineTime) && Number.isFinite(line.time)
              ? line.time - firstLineTime
              : 0;
            line.words = words.map((word) => ({
              ...word,
              time: word.time + shift,
              end: word.end + shift,
            }));
            line.time = line.words[0].time;
            line.end = line.words[line.words.length - 1].end;
            line.text = line.words.map((x) => x.text).join("");
          }
        }
      }
      bi += expandedCount;
    }
    const hasWords = base.some((line) => line.words && line.words.length);
    return { lines: base, syncLevel: hasWords ? "word" : "line" };
  }

  function parseQrc(qrcText) {
    const lines = [];
    for (const raw of String(qrcText || "").split(/\r?\n/)) {
      const head = raw.match(/^\[(\d+),(\d+)\](.*)$/);
      if (!head) continue;
      const lineStart = Number(head[1]) / 1000;
      const lineEnd = (Number(head[1]) + Number(head[2])) / 1000;
      const body = head[3] || "";
      const words = [];
      const wordRe = /([^()]+?)\((\d+),(\d+)\)/g;
      let m;
      while ((m = wordRe.exec(body))) {
        const text = m[1];
        const start = Number(m[2]) / 1000;
        const end = (Number(m[2]) + Number(m[3])) / 1000;
        if (text) words.push({ text, time: start, end, background: false });
      }
      const text = words.length ? words.map((x) => x.text).join("") : body.replace(/\(\d+,\d+\)/g, "").trim();
      if (text) lines.push({ time: lineStart, end: lineEnd, text, words });
    }
    return { lines, syncLevel: lines.some((x) => x.words.length) ? "word" : (lines.length ? "line" : "none") };
  }


  function parseBetterLyricsSse(raw, duration, info) {
    const candidates = [];
    const add = (result, priority) => {
      if (result && result.lines && result.lines.length) candidates.push({ ...result, priority });
    };

    const blocks = String(raw || "").split(/\n\n|\r\n\r\n/);
    for (const block of blocks) {
      let eventName = "";
      let dataText = "";
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith("event:")) eventName = line.slice(6).trim();
        else if (line.startsWith("data:")) dataText += line.slice(5).trim();
      }
      if (eventName !== "provider" || !dataText || dataText === "[DONE]") continue;
      let data;
      try { data = JSON.parse(dataText); } catch (_) { continue; }
      const provider = String(data && data.provider || "").toLowerCase();
      const results = data && data.results;
      if (!provider || !results) continue;

      if (provider === "golyrics" && results.lyrics) {
        let ttml = results.lyrics;
        try { const parsed = JSON.parse(ttml); if (parsed && parsed.ttml) ttml = parsed.ttml; } catch (_) {}
        const p = parseTTML(ttml);
        add({ lines: p.lines, syncLevel: p.syncLevel, _source: "Better Lyrics" }, p.syncLevel === "syllable" ? 100 : 80);
      }

      if (provider === "binimum" && results.lyrics) {
        const p = String(results.lyrics).includes("<tt") ? parseTTML(results.lyrics) : parseInlineTimedLrc(results.lyrics);
        const timing = String(results.timingType || "").toLowerCase();
        const level = timing === "syllable" ? "syllable" : p.syncLevel;
        add({ lines: p.lines, syncLevel: level, _source: "BiniLyrics (Better Lyrics経由)" }, level === "syllable" ? 95 : 75);
      }

      if (provider === "musixmatch") {
        if (typeof results.wordByWord === "string" && results.wordByWord.trim()) {
          const p = parseInlineTimedLrc(results.wordByWord);
          add({ lines: p.lines, syncLevel: p.syncLevel === "word" ? "word" : "line", _source: "Musixmatch (Better Lyrics経由)" }, p.syncLevel === "word" ? 90 : 58);
        }
        if (typeof results.synced === "string" && results.synced.trim()) {
          add({ lines: parseLRC(results.synced), syncLevel: "line", _source: "Musixmatch (Better Lyrics経由)" }, 60);
        }
      }

      if (provider === "lrclib") {
        if (typeof results.synced === "string" && results.synced.trim()) {
          add({ lines: parseLRC(results.synced), syncLevel: "line", _source: "LRCLIB (Better Lyrics経由)" }, 70);
        }
      }

      if (provider === "qq" && results.lyrics) {
        let decoded = results.lyrics;
        try { const x = JSON.parse(decoded); if (x && x.lyrics) decoded = x.lyrics; } catch (_) {}
        const p = parseQrc(decoded);
        add({ lines: p.lines, syncLevel: p.syncLevel, _source: "Better Lyrics Portato" }, p.syncLevel === "word" ? 88 : 62);
      }

      if (provider === "kugou" && results.lyrics) {
        let decoded = results.lyrics;
        try { const x = JSON.parse(decoded); if (x && x.lyrics) decoded = x.lyrics; } catch (_) {}
        const p = parseInlineTimedLrc(decoded);
        add({ lines: p.lines, syncLevel: p.syncLevel, _source: "Better Lyrics Legato" }, p.syncLevel === "word" ? 84 : 65);
      }

    }

    candidates.sort((a, b) => {
      const langA = lyricsLanguageFit(a, info);
      const langB = lyricsLanguageFit(b, info);
      if (langA !== langB) return langB - langA;
      return (b.priority || 0) - (a.priority || 0);
    });
    return candidates.find((candidate) => lyricsLanguageFit(candidate, info) >= 0) || null;
  }

  async function fetchFromBetterLyricsV2(info, duration, trackKey) {
    if (!info.videoId) return null;
    for (let authAttempt = 0; authAttempt < 2; authAttempt++) {
      if (trackKey !== STATE.lastTrackKey) return null;
      setStatus("Better Lyrics 2.3.3と同じ同期ソースを検索中…");
      refreshSearchingSubtext();
      const jwt = await getBetterLyricsJwt(trackKey, authAttempt > 0);
      if (!jwt || trackKey !== STATE.lastTrackKey) return null;

      const body = new URLSearchParams();
      body.set("videoId", info.videoId);
      if (info.title) body.set("song", cleanTitle(info.title));
      if (info.artist) body.set("artist", cleanArtist(info.artist));
      if (duration) body.set("duration", String(Math.round(duration)));
      if (info.album) body.set("album", info.album);
      body.set("alwaysFetchMetadata", "true");
      body.set("token", jwt);

      const res = await fetchText(BETTER_LYRICS_V2_BASE + "v2/lyrics", {
        method: "POST",
        body: body.toString(),
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
        credentials: "include",
        timeoutMs: 22000,
      });
      if (res.status === 403 && authAttempt === 0) continue;
      if (!res.ok || typeof res.data !== "string") return null;
      return parseBetterLyricsSse(res.data, duration, info);
    }
    return null;
  }

  // ---------- Better Lyrics統合API: 同期JSONフォールバック ----------
  async function fetchFromBetterLyricsJson(info, duration, trackKey) {
    if (trackKey !== STATE.lastTrackKey) return null;
    setStatus("Better Lyricsの同期歌詞を追加確認中…");
    refreshSearchingSubtext();

    const p = new URLSearchParams();
    if (info.videoId) p.set("videoId", info.videoId);
    if (info.title) p.set("song", cleanTitle(info.title));
    if (info.artist) p.set("artist", cleanArtist(info.artist));
    if (info.album) p.set("album", info.album);
    if (duration) p.set("duration", String(Math.round(duration)));
    p.set("alwaysFetchMetadata", "true");

    const savedJwt = await storageLocalGet(BETTER_LYRICS_JWT_KEY);
    if (typeof savedJwt === "string" && savedJwt) p.set("token", savedJwt);

    const res = await fetchJson(BETTER_LYRICS_V2_BASE + "lyrics?" + p.toString(), {
      credentials: "include",
      timeoutMs: 18000,
    });
    if (!res.ok || !res.data || typeof res.data !== "object") return null;

    const data = res.data;
    const rich = data.musixmatchWordByWordLyrics;
    if (typeof rich === "string" && rich.trim()) {
      const parsed = parseInlineTimedLrc(rich);
      if (parsed.lines.length) return { lines: parsed.lines, syncLevel: parsed.syncLevel, _source: "Musixmatch (Better Lyrics経由)" };
    }

    const syncedCandidates = [
      [data.goLyricsApiTtml, "Better Lyrics"],
      [data.musixmatchSyncedLyrics, "Musixmatch (Better Lyrics経由)"],
      [data.lrclibSyncedLyrics, "LRCLIB (Better Lyrics経由)"],
      [data.lyrics, "Better Lyrics"],
    ];
    for (const [raw, source] of syncedCandidates) {
      if (typeof raw !== "string" || !raw.trim()) continue;
      if (raw.includes("<tt")) {
        let ttml = raw;
        try { const x = JSON.parse(raw); if (x && x.ttml) ttml = x.ttml; } catch (_) {}
        const parsed = parseTTML(ttml);
        if (parsed.lines.length) return { lines: parsed.lines, syncLevel: parsed.syncLevel, _source: source };
      }
      if (/\[\d{1,2}:\d{2}/.test(raw)) {
        const parsed = parseInlineTimedLrc(raw);
        if (parsed.lines.length) return { lines: parsed.lines, syncLevel: parsed.syncLevel, _source: source };
      }
    }

    return null;
  }

  // ---------- Better Lyrics公式: 音節同期TTML ----------
  async function fetchFromBetterLyrics(info, duration, trackKey) {
    const titles = titleVariants(info.title).slice(0, 3);
    const artists = artistVariants(info.artist).slice(0, 2);
    const attempts = [];
    for (const title of titles) {
      for (const artist of artists) attempts.push({ title, artist });
    }

    for (let i = 0; i < attempts.length; i++) {
      if (trackKey !== STATE.lastTrackKey) return null;
      const x = attempts[i];
      setStatus(`Better Lyricsで音節同期を探し中… ${i + 1}/${attempts.length}`);
      refreshSearchingSubtext();

      const p = new URLSearchParams({ s: x.title, a: x.artist });
      if (info.album) p.set("al", info.album);
      if (duration) p.set("d", String(Math.round(duration)));

      const res = await fetchJson(`https://lyrics-api.boidu.dev/getLyrics?${p.toString()}`);
      if (res.ok && res.data && typeof res.data.ttml === "string") {
        if (hasSearchResultMetadata(res.data) && !searchResultMatchesTrack(res.data, x.title, x.artist, duration)) {
          await sleep(120);
          continue;
        }
        const parsed = parseTTML(res.data.ttml);
        if (parsed.lines.length) {
          return {
            lines: parsed.lines,
            syncLevel: parsed.syncLevel,
            _source: "Better Lyrics",
          };
        }
      }
      await sleep(120);
    }
    return null;
  }

  // ---------- Unison: Better Lyricsコミュニティ ----------
  function parseUnisonData(data) {
    if (!data) return null;
    const entry = data.success && data.data ? data.data : data.data || data;
    if (!entry || typeof entry.lyrics !== "string" || !entry.lyrics.trim()) return null;

    const format = String(entry.format || "").toLowerCase();
    const syncType = String(entry.syncType || entry.sync_type || "").toLowerCase();

    if (format === "ttml" || entry.lyrics.includes("<tt")) {
      const parsed = parseTTML(entry.lyrics);
      if (parsed.lines.length) {
        return {
          lines: parsed.lines,
          syncLevel: syncType === "richsync" ? "syllable" : parsed.syncLevel,
          _source: "Unison",
        };
      }
    }

    if (format === "lrc" || syncType === "linesync" || /\[\d{1,2}:\d{2}/.test(entry.lyrics)) {
      const parsed = parseRichLrcWithWordRows(entry.lyrics);
      if (parsed.lines.length) {
        return {
          lines: parsed.lines,
          syncLevel: syncType === "richsync" ? "word" : parsed.syncLevel,
          _source: "Unison",
        };
      }
    }

    return null;
  }

  async function fetchFromUnison(info, duration, trackKey) {
    const urls = [];
    if (info.videoId) {
      urls.push(`https://unison.boidu.dev/lyrics?v=${encodeURIComponent(info.videoId)}`);
    }

    const p = new URLSearchParams({ song: cleanTitle(info.title), artist: cleanArtist(info.artist) });
    if (info.album) p.set("album", info.album);
    if (duration) p.set("duration", String(Math.round(duration)));
    urls.push(`https://unison.boidu.dev/lyrics?${p.toString()}`);

    for (let i = 0; i < urls.length; i++) {
      if (trackKey !== STATE.lastTrackKey) return null;
      setStatus(`Unisonでも同期歌詞を探し中… ${i + 1}/${urls.length}`);
      refreshSearchingSubtext();
      const res = await fetchJson(urls[i]);
      if (res.ok) {
        const parsed = parseUnisonData(res.data);
        if (parsed) return parsed;
      }
      await sleep(100);
    }
    return null;
  }

  // ---------- BiniLyrics: TTML/ワード同期 ----------
  async function fetchFromBiniLyrics(info, duration, trackKey) {
    const titles = titleVariants(info.title).slice(0, 3);
    const artists = artistVariants(info.artist).slice(0, 2);
    const attempts = [];
    for (const title of titles) {
      for (const artist of artists) attempts.push({ title, artist });
    }

    for (let i = 0; i < attempts.length; i++) {
      if (trackKey !== STATE.lastTrackKey) return null;
      const x = attempts[i];
      setStatus(`BiniLyricsでワード同期を探し中… ${i + 1}/${attempts.length}`);
      refreshSearchingSubtext();

      const p = new URLSearchParams({ track: x.title, artist: x.artist });
      if (info.album) p.set("album", info.album);
      if (duration) p.set("duration", String(Math.round(duration)));
      const res = await fetchJson(`https://lyrics-api.binimum.org/?${p.toString()}`);
      if (!res.ok || !res.data || !Array.isArray(res.data.results) || !res.data.results.length) {
        await sleep(100);
        continue;
      }

      const best = res.data.results[0];
      if (scoreResult(best, x.title, x.artist, duration) < 120) {
        await sleep(100);
        continue;
      }

      const lyricsUrl = best.lyricsUrl || best.lyrics_url || "";
      if (!/^https:\/\/lyrics-storage\.binimum\.org\//i.test(lyricsUrl)) {
        await sleep(100);
        continue;
      }

      const textRes = await fetchText(lyricsUrl);
      if (!textRes.ok || typeof textRes.data !== "string" || !textRes.data.trim()) {
        await sleep(100);
        continue;
      }

      const raw = textRes.data.trim();
      if (raw.includes("<tt")) {
        const parsed = parseTTML(raw);
        if (parsed.lines.length) {
          return {
            lines: parsed.lines,
            syncLevel: String(best.timing_type || best.timingType || "").toLowerCase() === "word"
              ? "word"
              : parsed.syncLevel,
            _source: "BiniLyrics",
          };
        }
      }

      if (/\[\d{1,2}:\d{2}/.test(raw)) {
        const parsed = parseRichLrcWithWordRows(raw);
        if (parsed.lines.length) {
          return { lines: parsed.lines, syncLevel: parsed.syncLevel, _source: "BiniLyrics" };
        }
      }

      await sleep(100);
    }
    return null;
  }

  // ---------- LRCLIB: 絶対残す/粘り強く検索 ----------
  async function fetchFromLrclib(info, duration, trackKey) {
    const titles = titleVariants(info.title);
    const artists = artistVariants(info.artist);

    // 取得条件のartist表記がYouTubeチャンネル名になっている場合でも、
    // 曲名中心の全文検索ならLRCLIB上の正式アーティスト表記を見つけられる。
    // 多数の厳密GETを順番に試す前に実行し、「存在する歌詞」の初回表示を速くする。
    const fastQueries = uniq([
      `${titles[0] || info.title} ${artists[0] || ""}`,
      titles[0] || info.title,
      titles[titles.length - 1] || info.title,
    ]);
    for (let i = 0; i < fastQueries.length; i++) {
      if (trackKey !== STATE.lastTrackKey) return null;
      setStatus(`LRCLIBで同期歌詞を高速検索中… ${i + 1}/${fastQueries.length}`);
      refreshSearchingSubtext();
      const p = new URLSearchParams({ q: fastQueries[i] });
      const res = await fetchJson(`https://lrclib.net/api/search?${p.toString()}`);
      if (res.ok && Array.isArray(res.data)) {
        const candidate = bestSearchResult(res.data, info.title, info.artist, duration);
        if (candidate && candidate.syncedLyrics) {
          const lines = parseLRC(candidate.syncedLyrics);
          if (lines.length) return { lines, syncLevel: "line", _source: "LRCLIB" };
        }
      }
      await sleep(80);
    }

    const getAttempts = [];
    for (const t of titles.slice(0, 3)) {
      for (const a of artists.slice(0, 2)) {
        getAttempts.push({ t, a, album: info.album, duration });
        getAttempts.push({ t, a, album: "", duration });
        getAttempts.push({ t, a, album: "", duration: null });
      }
    }

    for (let i = 0; i < getAttempts.length; i++) {
      if (trackKey !== STATE.lastTrackKey) return null;
      const x = getAttempts[i];
      setStatus(`LRCLIBで同期歌詞を探し中… ${i + 1}/${getAttempts.length}`);
      refreshSearchingSubtext();
      const p = new URLSearchParams({ track_name: x.t, artist_name: x.a });
      if (x.album) p.set("album_name", x.album);
      if (x.duration) p.set("duration", String(Math.round(x.duration)));
      const res = await fetchJson(`https://lrclib.net/api/get?${p.toString()}`);
      if (res.ok && res.data && (res.data.syncedLyrics || res.data.plainLyrics)) {
        if (res.data.syncedLyrics && scoreResult(res.data, x.t, x.a, x.duration) >= 120) {
          return {
            lines: parseLRC(res.data.syncedLyrics),
            syncLevel: "line",
            _source: "LRCLIB",
          };
        }
      }
      await sleep(150);
    }

    const structuredAttempts = [];
    for (const t of titles) {
      for (const a of artists) structuredAttempts.push({ t, a });
    }

    for (let i = 0; i < structuredAttempts.length; i++) {
      if (trackKey !== STATE.lastTrackKey) return null;
      const x = structuredAttempts[i];
      setStatus(`LRCLIBで表記を変えて探し中… ${i + 1}/${structuredAttempts.length}`);
      refreshSearchingSubtext();
      const p = new URLSearchParams({ track_name: x.t, artist_name: x.a });
      const res = await fetchJson(`https://lrclib.net/api/search?${p.toString()}`);
      if (res.ok && Array.isArray(res.data)) {
        const candidate = bestSearchResult(res.data, x.t, x.a, duration);
        if (candidate) {
          if (candidate.syncedLyrics) {
            return {
              lines: parseLRC(candidate.syncedLyrics),
              syncLevel: "line",
              _source: "LRCLIB",
            };
          }
        }
      }
      await sleep(130);
    }

    const queries = uniq([
      `${titles[0]} ${artists[0] || ""}`,
      `${titles[titles.length - 1]} ${artists[artists.length - 1] || ""}`,
      titles[titles.length - 1],
    ]);

    for (let i = 0; i < queries.length; i++) {
      if (trackKey !== STATE.lastTrackKey) return null;
      setStatus(`LRCLIBの広い検索で探し中… ${i + 1}/${queries.length}`);
      refreshSearchingSubtext();
      const p = new URLSearchParams({ q: queries[i] });
      const res = await fetchJson(`https://lrclib.net/api/search?${p.toString()}`);
      if (res.ok && Array.isArray(res.data)) {
        const candidate = bestSearchResult(res.data, info.title, info.artist, duration);
        if (candidate) {
          if (candidate.syncedLyrics) {
            return {
              lines: parseLRC(candidate.syncedLyrics),
              syncLevel: "line",
              _source: "LRCLIB",
            };
          }
        }
      }
      await sleep(130);
    }

    return null;
  }

  // ---------- Better Lyrics Kugou / QQ系 ----------
  async function fetchFromBoiduProvider(info, duration, trackKey, provider) {
    if (trackKey !== STATE.lastTrackKey) return null;
    const label = provider === "kugou" ? "Better Lyrics / Kugou" : "Better Lyrics / QQ";
    setStatus(`${label}でも同期歌詞を探し中…`);
    refreshSearchingSubtext();

    const p = buildBoiduParams(info, duration);
    const res = await fetchJson(`https://lyrics-api.boidu.dev/${provider}/getLyrics?${p.toString()}`);
    if (!res.ok || !res.data) return null;
    if (hasSearchResultMetadata(res.data) && !searchResultMatchesTrack(res.data, info.title, info.artist, duration)) return null;

    if (typeof res.data.ttml === "string") {
      const parsed = parseTTML(res.data.ttml);
      if (parsed.lines.length) {
        return {
          lines: parsed.lines,
          syncLevel: provider === "kugou" ? "line" : parsed.syncLevel,
          _source: label,
        };
      }
    }

    const lrc = res.data.syncedLyrics || res.data.lyrics || res.data.lrc;
    if (typeof lrc === "string" && /\[\d{1,2}:\d{2}/.test(lrc)) {
      const parsed = parseRichLrcWithWordRows(lrc);
      if (parsed.lines.length) {
        return { lines: parsed.lines, syncLevel: parsed.syncLevel, _source: label };
      }
    }
    return null;
  }

  // ---------- Karalyr: 追加同期候補 ----------
  async function fetchFromKaralyr(info, duration, trackKey) {
    const titles = titleVariants(info.title).slice(0, 3);
    const artists = artistVariants(info.artist).slice(0, 2);
    let attempt = 0;
    const total = titles.length * artists.length;

    for (const t of titles) {
      for (const a of artists) {
        if (trackKey !== STATE.lastTrackKey) return null;
        attempt++;
        setStatus(`別の同期歌詞DBも検索中… ${attempt}/${total}`);
        refreshSearchingSubtext();
        const p = new URLSearchParams({ track_name: t, artist_name: a });
        if (info.album) p.set("album_name", info.album);
        if (duration) p.set("duration", String(Math.round(duration)));
        const res = await fetchJson(`https://www.karalyr.com/api/get?${p.toString()}`);
        if (res.ok && res.data && (res.data.syncedLyrics || res.data.plainLyrics)) {
          if (res.data.syncedLyrics && (!hasSearchResultMetadata(res.data) || searchResultMatchesTrack(res.data, t, a, duration))) {
            return { lines: parseLRC(res.data.syncedLyrics), syncLevel: "line", _source: "Karalyr" };
          }
        }
        await sleep(100);
      }
    }
    return null;
  }

  // ---------- YouTube Music 標準歌詞 ----------
  function extractNativeLyrics() {
    const renderer = findLyricsRenderer();
    if (!renderer) return null;

    const candidates = [
      renderer.querySelector("ytmusic-description-shelf-renderer #description"),
      renderer.querySelector("ytmusic-description-shelf-renderer yt-formatted-string#description"),
      renderer.querySelector("yt-formatted-string.description"),
      renderer.querySelector("#description"),
      renderer.querySelector("ytmusic-description-shelf-renderer"),
    ].filter(Boolean);

    // YouTube Music側のDOM名が変わっても、歌詞タブ内で一番長い複数行テキストを拾う。
    renderer.querySelectorAll("yt-formatted-string").forEach((el) => {
      if (!candidates.includes(el)) candidates.push(el);
    });

    let best = null;
    for (const el of candidates) {
      if (panelEl && panelEl.contains(el)) continue;
      const text = (el.innerText || el.textContent || "").trim();
      const lines = text
        .split(/\r?\n/)
        .map((x) => x.trim())
        .filter(Boolean);
      if (lines.length < 2 || text.length < 20) continue;
      // タブ名や短い説明ではなく、最も歌詞らしい長文を優先する。
      const score = text.length + lines.length * 12;
      if (!best || score > best.score) best = { lines, score };
    }

    return best ? best.lines : null;
  }

  async function waitForNativeLyrics(trackKey, searchGeneration, ignoreSignature = "") {
    // YouTube Music標準歌詞は曲切り替え直後に前曲DOMが少し残るため、少し待ってから読む。
    await sleep(650);
    for (let i = 0; i < 14; i++) {
      if (trackKey !== STATE.lastTrackKey || searchGeneration !== STATE.searchGeneration) return null;
      ensureLyricsMount();
      const nativeLines = extractNativeLyrics();
      if (nativeLines && nativeLines.length) {
        const signature = nativeLines.join("\n").trim();
        if (!ignoreSignature || signature !== ignoreSignature) return nativeLines;
      }
      await sleep(250);
    }
    return null;
  }

  function getScriptStats(text) {
    const value = String(text || "");
    const count = (re) => (value.match(re) || []).length;
    return {
      kana: count(/[ぁ-ゖァ-ヺー]/gu),
      hangul: count(/[가-힣]/gu),
      han: count(/[一-龯々〆ヵヶ]/gu),
      latin: count(/[A-Za-z]/g),
      cyrillic: count(/[\u0400-\u04FF]/gu),
      thai: count(/[\u0E00-\u0E7F]/gu),
      arabic: count(/[\u0600-\u06FF]/gu),
      hebrew: count(/[\u0590-\u05FF]/gu),
    };
  }

  // 日本語では通常使わない簡体字/繁体字を中心にしたヒント。
  // CJK統合漢字だけでは日本語と中国語を完全判定できないため、
  // 「かなの有無」を最重要にし、この集合は補助判定だけに使う。
  const CHINESE_HINT_RE = /[这這们們为说說吗嗎么麼没沒还還过裡时发發见听聽让讓从從对對给边邊欢歡乐樂]/u;

  function detectLyricsLanguageFromText(text) {
    const value = String(text || "").trim();
    if (!value) return "unknown";
    const s = getScriptStats(value);
    const total = s.kana + s.hangul + s.han + s.latin + s.cyrillic + s.thai + s.arabic + s.hebrew;
    if (!total) return "unknown";

    if (s.hangul >= 3 && s.hangul >= s.kana * 2) return "ko";
    // 日本語歌詞は漢字だけでなく、助詞・送り仮名等のかなをほぼ必ず含む。
    if (s.kana >= 3 || (s.kana >= 1 && s.han >= 2 && s.kana >= Math.ceil((s.kana + s.han) * 0.025))) return "ja";
    if (s.thai >= 3) return "th";
    if (s.arabic >= 3) return "ar";
    if (s.hebrew >= 3) return "he";
    if (s.cyrillic >= 3) return "ru";

    // かな/ハングル無しで漢字がまとまっている歌詞は中国語候補として扱う。
    // 日本語の漢字だけの短い掛け声等を誤判定しないよう、本文量も見る。
    if (s.han >= 6 && s.kana === 0 && s.hangul === 0) {
      if (CHINESE_HINT_RE.test(value) || s.han >= Math.max(10, s.latin * 2)) return "zh";
    }

    if (s.latin >= 8 && s.han + s.kana + s.hangul <= Math.max(2, Math.floor(s.latin * 0.08))) return "en";
    return "unknown";
  }

  function inferTrackLanguage(info) {
    const meta = `${info && info.title || ""} ${info && info.artist || ""} ${info && info.album || ""}`;
    const s = getScriptStats(meta);

    if (s.hangul >= 1) return "ko";
    if (s.kana >= 1) return "ja";
    if (s.thai >= 1) return "th";
    if (s.arabic >= 1) return "ar";
    if (s.hebrew >= 1) return "he";
    if (s.cyrillic >= 1) return "ru";

    // 中国語固有寄りの字体がメタデータに含まれる場合は中国語を優先。
    if (s.han >= 1 && CHINESE_HINT_RE.test(meta)) return "zh";

    // 「群青」「怪物」のような漢字だけの日本語タイトルと中国語タイトルは、
    // メタデータだけでは安全に区別できない。ここでは断定せず、
    // YouTube Music標準歌詞の本文言語をヒントに最終決定する。
    // ラテン文字だけの日本曲も同様に、英語とは断定しない。
    return "unknown";
  }

  function lyricsTextForLanguage(result) {
    if (!result || !Array.isArray(result.lines)) return "";
    return result.lines.map((line) => {
      if (line && typeof line.text === "string" && line.text) return line.text;
      if (line && Array.isArray(line.words)) return line.words.map((word) => word && word.text || "").join("");
      return "";
    }).join("\n");
  }

  // 曲の言語と歌詞本文の言語を合わせる。
  // 日本語曲では中国語・韓国語・ローマ字/英訳を「同期品質が高い」という理由だけで採用しない。
  function lyricsLanguageFit(result, info, expectedOverride = "") {
    const expected = expectedOverride || inferTrackLanguage(info);
    const text = lyricsTextForLanguage(result);
    if (!text) return 0;

    const detected = detectLyricsLanguageFromText(text);
    const s = getScriptStats(text);
    const meaningful = s.kana + s.hangul + s.han + s.latin + s.cyrillic + s.thai + s.arabic + s.hebrew;

    if (expected === "ja") {
      if (detected === "ja") return 10;
      if (detected === "ko" || detected === "zh") return -10;
      // 日本語曲で本文量があるのにかなが無い場合は、ローマ字・英訳・中国語版を拒否する。
      if (meaningful >= 12 && s.kana === 0) return -8;
      // ごく短いイントロ表記等は判断不能として保留。
      return 0;
    }

    if (expected === "ko") {
      if (detected === "ko") return 10;
      if (meaningful >= 12 && s.hangul === 0) return -8;
      return 0;
    }

    if (expected === "zh") {
      if (detected === "zh") return 10;
      if (detected === "ja" || detected === "ko") return -10;
      if (meaningful >= 12 && s.han === 0) return -7;
      return 0;
    }

    if (["th", "ar", "he", "ru"].includes(expected)) {
      if (detected === expected) return 10;
      if (meaningful >= 12 && detected !== "unknown") return -7;
      return 0;
    }

    // 曲言語をメタデータから断定できない場合でも、歌詞本文の言語は記録できる。
    // この場合は取得元/同期品質の優先順位を壊さないよう同点扱いにする。
    return 1;
  }

  // ---------- 行単位の翻訳除去 ----------
  // 日本語原文 + 中国語訳 / ローマ字併記のような多言語LRC/TTMLを、
  // 曲の原言語に合わせて「行ごと + 前後関係」で整理する。
  // v1.7.7: 漢字だけの中国語、短い中国語、カタカナ直後のローマ字併記も除去する。
  // 日本語側に旧字体（與/會/數など）が混ざる歌詞は実在するため、旧字体1文字だけでは中国語扱いしない。
  const CHINESE_DISTINCT_CHAR_RE = /[这這们們说說吗嗎么麼没沒还還时時发發见見听聽让讓从從对對边邊欢歡乐樂岁歲转轉睜睁双雙该該啰囉艳艷丰豐继繼续續尽盡]/gu;
  const CHINESE_STRONG_PHRASE_RE = /(等下|不行|太喜歡|太喜欢|喜歡|喜欢|一個人|一个人|期盼|給了|给了|讓我|让我|為了|为了|因為|因为|所以|但是|可是|沒有|没有|還是|还是|這樣|这样|那樣|那样|怎麼|怎么|什麼|什么|都該|都该|睜大|睁大|雙眼|双眼|仔細|仔细|看看|那個|那个|這個|这个|女孩|男孩|預備|预备|看情況|看情况|保持社交距離|保持社交距离|大家一起|一起來|一起来|幹杯|干杯|要上啰|要上囉|你看|開始豐富多彩|开始丰富多彩|豐富多彩|丰富多彩|照亮日常生活的|生活的|鮮艷|鲜艳|繼續支持|继续支持|支持你|感激不盡|感激不尽|來吧|来吧|真的非常|非常感謝|非常感谢)/gu;
  const CHINESE_GRAMMAR_TOKEN_RE = /(你|妳|您|我們|我们|你們|你们|他們|他们|這|这|那|哪|誰|谁|的|了|著|着|過|过|嗎|吗|吧|呢|呀|啊|哦|嘛|很|都|也|就|還|还|在|從|从|對|对|給|给|讓|让|把|被|為|为|可以|不要|真的|非常)/gu;

  function lineTextForLanguage(line) {
    if (!line) return "";
    if (typeof line.text === "string" && line.text.trim()) return line.text.trim();
    if (Array.isArray(line.words)) {
      return line.words.map((word) => word && word.text || "").join("").trim();
    }
    return "";
  }

  function chineseLineScore(text) {
    const value = String(text || "").trim();
    if (!value) return 0;
    const s = getScriptStats(value);

    // かなが1文字でもある行は日本語原文として守る。
    if (s.kana >= 1 || s.hangul >= 1) return 0;
    if (s.han < 1) return 0;

    let score = 0;
    const distinct = value.match(CHINESE_DISTINCT_CHAR_RE) || [];
    const phrases = value.match(CHINESE_STRONG_PHRASE_RE) || [];
    const grammar = value.match(CHINESE_GRAMMAR_TOKEN_RE) || [];

    score += Math.min(8, distinct.length * 3);
    score += Math.min(10, phrases.length * 5);

    // 中国語の機能語が複数ある漢字文はかなり強い中国語ヒント。
    if (grammar.length >= 2) score += 4 + Math.min(4, grammar.length - 2);
    else if (grammar.length === 1 && s.han >= 6) score += 1;

    // 長めの「かな無し漢字文」で中国語らしい語が1つ以上ある場合を補強。
    if (s.han >= 7 && (distinct.length >= 1 || phrases.length >= 1 || grammar.length >= 1)) score += 2;

    return score;
  }

  function detectStrongLineLanguage(text) {
    const value = String(text || "").trim();
    if (!value) return "unknown";
    const s = getScriptStats(value);

    if (s.hangul >= 1) return "ko";
    if (s.kana >= 1) return "ja";
    if (s.thai >= 2) return "th";
    if (s.arabic >= 2) return "ar";
    if (s.hebrew >= 2) return "he";
    if (s.cyrillic >= 2) return "ru";

    if (s.han >= 1 && chineseLineScore(value) >= 4) return "zh";

    if (s.latin >= 4 && s.han + s.kana + s.hangul === 0) return "en";
    return "unknown";
  }

  function shouldDropTranslatedLine(lineLanguage, expectedLanguage) {
    if (!lineLanguage || lineLanguage === "unknown" || !expectedLanguage || expectedLanguage === "unknown") return false;
    if (lineLanguage === expectedLanguage) return false;

    // 東アジア言語どうしの翻訳行は安全に除去しやすい。
    if (expectedLanguage === "ja") return lineLanguage === "zh" || lineLanguage === "ko";
    if (expectedLanguage === "ko") return lineLanguage === "ja" || lineLanguage === "zh";
    if (expectedLanguage === "zh") return lineLanguage === "ja" || lineLanguage === "ko";

    // その他の原曲言語では、明確なCJK翻訳が混ざった場合だけ除去する。
    if (["en", "th", "ar", "he", "ru"].includes(expectedLanguage)) {
      return lineLanguage === "ja" || lineLanguage === "ko" || lineLanguage === "zh";
    }
    return false;
  }

  function katakanaHeavy(text) {
    const value = String(text || "");
    const katakana = (value.match(/[ァ-ヺー]/gu) || []).length;
    const hiragana = (value.match(/[ぁ-ゖ]/gu) || []).length;
    return katakana >= 3 && katakana >= Math.max(3, hiragana * 2);
  }

  function parenShape(text) {
    const value = String(text || "").trim();
    return {
      open: /^[\(（]/u.test(value),
      close: /[\)）]$/u.test(value),
    };
  }

  // 「(タイガー ファイヤー」→「(Tiger Fire」のような、
  // カタカナ原文の直後/直前にある短いローマ字併記だけを除去する。
  // 普通の英語歌詞を全部消すのは避けるため、カタカナ量と括弧形状を条件にする。
  function isLikelyRomanizedTranslationLine(classified, index, expectedLanguage) {
    if (expectedLanguage !== "ja") return false;
    const current = classified[index];
    if (!current || current.language !== "en") return false;
    const text = lineTextForLanguage(current.line);
    if (!text || text.length > 42) return false;

    const shape = parenShape(text);
    for (const neighborIndex of [index - 1, index + 1]) {
      const neighbor = classified[neighborIndex];
      if (!neighbor || neighbor.language !== "ja") continue;
      const neighborText = lineTextForLanguage(neighbor.line);
      if (!katakanaHeavy(neighborText)) continue;
      const neighborShape = parenShape(neighborText);
      if ((shape.open && neighborShape.open) || (shape.close && neighborShape.close)) return true;
    }
    return false;
  }

  function rebuildFilteredLineEnds(lines, syncLevel) {
    if (!Array.isArray(lines) || !lines.length) return lines || [];
    const out = lines.map((line) => ({
      ...line,
      words: Array.isArray(line && line.words) ? line.words.map((word) => ({ ...word })) : [],
    }));

    for (let i = 0; i < out.length; i++) {
      const line = out[i];
      const nextTime = out[i + 1] && Number.isFinite(out[i + 1].time) ? out[i + 1].time : null;
      if (!Number.isFinite(line.time)) continue;

      // 翻訳行が同時刻/直後に入っていたLRCでは、原文line.endが翻訳行の時刻を指して
      // 0秒長になることがある。行同期は次の「残した原文行」まで伸ばし直す。
      if (syncLevel === "line" || !Array.isArray(line.words) || !line.words.length) {
        if (nextTime != null && nextTime > line.time) line.end = nextTime;
        else if (line.end != null && line.end <= line.time) line.end = null;
      } else if (line.end != null && line.end <= line.time) {
        const lastWordEnd = line.words.reduce((max, word) => {
          const end = Number(word && word.end);
          return Number.isFinite(end) ? Math.max(max, end) : max;
        }, line.time);
        line.end = lastWordEnd > line.time ? lastWordEnd : nextTime;
      }
    }
    return out;
  }

  function filterTranslationRows(result, expectedLanguage) {
    if (!result || !Array.isArray(result.lines) || !result.lines.length) return result;
    const expected = String(expectedLanguage || "unknown");
    if (!expected || expected === "unknown") return result;

    const classified = result.lines.map((line) => ({
      line,
      language: detectStrongLineLanguage(lineTextForLanguage(line)),
    }));
    const expectedCount = classified.filter((x) => x.language === expected).length;

    // 原曲言語の行が1つも確認できない候補を無理に削らない。
    if (expectedCount < 1) return result;

    const kept = [];
    let removed = 0;
    for (let i = 0; i < classified.length; i++) {
      const item = classified[i];
      let drop = shouldDropTranslatedLine(item.language, expected);

      // v1.7.7: 短い/漢字だけで unknown に落ちた中国語もスコアで再判定。
      if (!drop && expected === "ja" && item.language === "unknown") {
        drop = chineseLineScore(lineTextForLanguage(item.line)) >= 4;
      }

      // v1.7.7: 日本語カタカナ行に併記されたローマ字/英字行を除去。
      if (!drop && isLikelyRomanizedTranslationLine(classified, i, expected)) drop = true;

      if (drop) removed++;
      else kept.push(item.line);
    }

    if (!removed || !kept.length) return result;

    return {
      ...result,
      lines: rebuildFilteredLineEnds(kept, result.syncLevel || "none"),
      _translationRowsRemoved: removed,
    };
  }

  function languageLabel(code) {
    return ({
      ja: "日本語",
      ko: "韓国語",
      zh: "中国語",
      en: "英語",
      th: "タイ語",
      ar: "アラビア語",
      he: "ヘブライ語",
      ru: "ロシア語",
      unknown: "自動判定",
    })[code] || "自動判定";
  }

  // v1.8.0: 原曲言語以外の「独立した翻訳行」を表示候補から除外する。
  // 候補そのものを捨てて同期情報を失うのではなく、原文行のタイムスタンプを維持する。
  // 日本語曲では、中国語/韓国語などに加えて、ローマ字・英訳だけの独立行も表示しない。
  function sanitizeCandidateForTrackLanguage(result, expectedLanguage) {
    if (!result || !Array.isArray(result.lines) || !result.lines.length) return null;
    const expected = String(expectedLanguage || "unknown");
    if (!expected || expected === "unknown") return result;

    const firstPass = filterTranslationRows(result, expected);
    const sourceLines = firstPass && Array.isArray(firstPass.lines) ? firstPass.lines : result.lines;
    const kept = [];
    let removed = Number(firstPass && firstPass._translationRowsRemoved) || 0;

    for (const line of sourceLines) {
      const text = lineTextForLanguage(line);
      if (!text) continue;
      const stats = getScriptStats(text);
      let language = detectStrongLineLanguage(text);
      if (expected === "ja" && language === "unknown" && chineseLineScore(text) >= 4) language = "zh";

      let foreign = false;
      if (expected === "ja") {
        // かなを含む行は、日本語原文中の英単語なども含めて原文として守る。
        if (stats.kana < 1) {
          if (["zh", "ko", "th", "ar", "he", "ru", "en"].includes(language)) foreign = true;
          // 明確な別スクリプトは行判定がunknownでも落とす。
          if (stats.hangul || stats.thai || stats.arabic || stats.hebrew || stats.cyrillic) foreign = true;
          // 英字だけの独立行（Tiger Fire等）は日本語曲では表示しない。
          if (stats.latin >= 2 && stats.han + stats.kana + stats.hangul === 0) foreign = true;
        }
      } else if (language !== "unknown" && language !== expected) {
        foreign = true;
      }

      if (foreign) removed += 1;
      else kept.push(line);
    }

    if (!kept.length) return null;
    const sanitized = {
      ...result,
      lines: rebuildFilteredLineEnds(kept, result.syncLevel || "none"),
      _translationRowsRemoved: removed,
      _languageSanitized: removed > 0,
    };

    // 原曲言語と明確に食い違う候補は使わない。
    if (lyricsLanguageFit(sanitized, null, expected) < 0) return null;
    return sanitized;
  }

  function resultQuality(result) {
    if (!result || !result.lines || !result.lines.length) return 0;
    if (result.syncLevel === "syllable") return 4;
    if (result.syncLevel === "word") return 3;
    if (result.syncLevel === "line") return 2;
    return 1;
  }

  // ---------- 歌詞キャッシュ（同じ曲は保存済みを使い回す） ----------
  // v1.8.0: 言語処理と標準歌詞フォールバックを作り直したため旧キャッシュを引き継がない。
  // 壊れた永続キャッシュを新コードへ持ち込まないため、保存キーを更新して完全に分離する。
  // v1.9.8: 同名別アーティストを採用していた旧キャッシュを引き継がない。
  const LYRICS_CACHE_STORAGE_KEY = "ytmlsLyricsCacheV198";
  const LYRICS_CACHE_MAX_ENTRIES = 150;
  const MANUAL_SEARCH_STORAGE_KEY = "ytmlsManualSearchOverridesV190";
  const MANUAL_SEARCH_MAX_ENTRIES = 200;

  function loadManualSearchOverrides() {
    try {
      chrome.storage.local.get({ [MANUAL_SEARCH_STORAGE_KEY]: {} }, (data) => {
        const stored = data && data[MANUAL_SEARCH_STORAGE_KEY];
        STATE.manualSearchOverrides = stored && typeof stored === "object" ? stored : {};
        STATE.manualSearchOverridesLoaded = true;
        tick();
      });
    } catch (_) {
      STATE.manualSearchOverridesLoaded = true;
    }
  }

  function saveManualSearchOverrides() {
    const entries = Object.entries(STATE.manualSearchOverrides || {})
      .filter(([videoId, value]) => videoId && value && value.title && value.artist)
      .sort((a, b) => Number(b[1].ts || 0) - Number(a[1].ts || 0))
      .slice(0, MANUAL_SEARCH_MAX_ENTRIES);
    STATE.manualSearchOverrides = Object.fromEntries(entries);
    try {
      chrome.storage.local.set({ [MANUAL_SEARCH_STORAGE_KEY]: STATE.manualSearchOverrides });
    } catch (_) {}
  }

  function effectiveSearchInfo(baseInfo) {
    if (!baseInfo) return null;
    const videoId = String(baseInfo.videoId || "");
    const override = videoId && STATE.manualSearchOverrides
      ? STATE.manualSearchOverrides[videoId]
      : null;
    if (!override || !override.title || !override.artist) return { ...baseInfo };
    return {
      ...baseInfo,
      title: String(override.title).trim(),
      artist: String(override.artist).trim(),
      _manualSearch: true,
      _baseTitle: baseInfo.title || "",
      _baseArtist: baseInfo.artist || "",
    };
  }

  function deleteLyricsCacheForVideoId(videoId) {
    const suffix = `::${String(videoId || "").trim()}`;
    if (suffix === "::") return;
    let changed = false;
    for (const key of [...STATE.lyricsCache.keys()]) {
      if (String(key).endsWith(suffix)) {
        STATE.lyricsCache.delete(key);
        changed = true;
      }
    }
    if (changed) saveLyricsCacheToStorage();
  }

  function lyricsCacheKey(info) {
    const t = normalizeForCompare(stripFeaturing(cleanTitle((info && info.title) || "")));
    if (!t) return "";
    const cleanedArtist = cleanArtist((info && info.artist) || "");
    const firstArtist = cleanedArtist.split(/\s*(?:,|、|&|＆|×| x |\/|／)\s*/i)[0] || cleanedArtist;
    const a = normalizeForCompare(firstArtist);
    // 同じ曲名/歌手でも MV・アルバム版・ライブ版ではイントロ長が違い、
    // 別版の同期歌詞キャッシュを使うと曲頭から一定量ずれる。videoIdを分離キーにする。
    const v = String((info && info.videoId) || "").trim();
    return `${t}::${a}::${v || "no-video-id"}`;
  }

  function loadLyricsCacheFromStorage() {
    try {
      chrome.storage.local.get({ [LYRICS_CACHE_STORAGE_KEY]: {} }, (data) => {
        const stored = data && data[LYRICS_CACHE_STORAGE_KEY];
        if (!stored || typeof stored !== "object") return;
        for (const [k, v] of Object.entries(stored)) {
          if (v && Array.isArray(v.lines) && v.lines.length) STATE.lyricsCache.set(k, v);
        }
      });
    } catch (_) {
      // ストレージ利用不可時は無視。キャッシュ無しで通常通り検索する。
    }
  }

  function saveLyricsCacheToStorage() {
    try {
      const obj = {};
      for (const [k, v] of STATE.lyricsCache.entries()) obj[k] = v;
      chrome.storage.local.set({ [LYRICS_CACHE_STORAGE_KEY]: obj });
    } catch (_) {}
  }

  function rememberLyricsInCache(cacheKey, result) {
    if (!cacheKey || !result || !Array.isArray(result.lines) || !result.lines.length) return;
    STATE.lyricsCache.delete(cacheKey); // 挿入順を更新して簡易LRUとして扱う
    STATE.lyricsCache.set(cacheKey, {
      lines: result.lines,
      syncLevel: result.syncLevel || "none",
      _source: result._source || "",
      _providerKey: result._providerKey || "",
      _providerSignature: providerConfigSignature(),
      ts: Date.now(),
    });
    while (STATE.lyricsCache.size > LYRICS_CACHE_MAX_ENTRIES) {
      const oldestKey = STATE.lyricsCache.keys().next().value;
      STATE.lyricsCache.delete(oldestKey);
    }
    saveLyricsCacheToStorage();
  }

  function applyLyricsResult(result, info, trackKey, searchGeneration) {
    if (!result || !Array.isArray(result.lines) || !result.lines.length) return false;
    // v1.8.1: 同期情報のない通常歌詞は表示しない。追跡できる歌詞だけを採用する。
    if (String(result.syncLevel || "none") === "none" || !result.lines.some((line) => line && line.time != null)) return false;
    if (trackKey !== STATE.lastTrackKey || searchGeneration !== STATE.searchGeneration) return false;

    // v1.7.2: 検索開始後にプレイヤーが別曲へ進んだ/一瞬戻った場合、
    // 世代番号だけでは同じ検索の古い結果を防げないケースがあるため、表示直前にも
    // 安定確認済みの実再生videoIdと一致することを必須にする。
    const resultVideoId = String((info && info.videoId) || "");
    if (resultVideoId) {
      const snapshot = getFreshPlayerSnapshot();
      const snapshotVideoId = String((snapshot && snapshot.videoId) || "");
      const urlVideoId = String(getVideoId() || "");
      const stableVideoId = String(getStablePlaybackVideoId() || "");
      // stableVideoIdは曲切替直後に前曲の値が短時間残る。新しいURLまたは新鮮な
      // Playerスナップショットのどちらかが検索対象と一致していれば、取得済み歌詞を拒否しない。
      const liveIds = [snapshotVideoId, urlVideoId].filter(Boolean);
      if (liveIds.length) {
        if (!liveIds.includes(resultVideoId)) return false;
      } else if (stableVideoId && stableVideoId !== resultVideoId) {
        return false;
      }
    }

    const firstResultForTrack = !STATE.hasLyricsResult || STATE.lastDisplayedTrackKey !== trackKey;
    STATE.lines = result.lines;
    STATE.syncLevel = result.syncLevel || "none";
    STATE.hasSync = STATE.syncLevel !== "none" && STATE.lines.some((line) => line.time != null);
    STATE.hasLyricsResult = true;
    STATE.source = result._source || "歌詞";
    STATE.activeCandidateId = lyricCandidateIdentity(result);
    STATE.lyricsAppliedAt = performance.now();
    STATE.recoveryActiveUntil = 0;
    STATE.recoveryReason = "";
    STATE.lastTrackingPulseAt = 0;
    STATE.lastDisplayedTrackKey = trackKey;
    const displayInfo = STATE.activeBaseInfo && STATE.activeBaseInfo.videoId === info.videoId
      ? STATE.activeBaseInfo
      : info;
    STATE.lastDisplayedTitle = displayInfo.title || "";
    STATE.lastDisplayedArtist = displayInfo.artist || "";
    STATE.displayedVideoId = info.videoId || getVideoId() || "";
    if (STATE.displayedVideoId) STATE.lastDisplayedVideoId = STATE.displayedVideoId;
    const inferredLanguage = inferTrackLanguage(info);
    const langSuffix = inferredLanguage !== "unknown" ? `  •  ${languageLabel(inferredLanguage)}` : "";
    const manualSuffix = info._manualSearch ? "  •  手動検索" : "";
    setStatus(`${info.title} - ${info.artist}  •  ${sourceLabel(STATE.source, STATE.syncLevel)}${langSuffix}${manualSuffix}`);
    ensureLyricsMount();
    // 新曲の最初の歌詞では必ず先頭から開始。旧曲のscrollTopを持ち越さない。
    renderLines({ resetScroll: firstResultForTrack });
    applySettings();
    updateTrackTimingControl();
    // 最初の歌詞取得完了時にもタブを開く。曲変更直後にタブDOMがまだ無かったケースを救済する。
    // 後続プロバイダの品質アップグレードでは、ユーザーが後から選んだタブを奪わない。
    if (firstResultForTrack) openLyricsTabForTrack(STATE.displayedVideoId);

    return true;
  }

  function clearLyricsForNewTrack(status = "歌詞を探し中…") {
    STATE.lines = [];
    STATE.syncLevel = "none";
    STATE.hasSync = false;
    STATE.hasLyricsResult = false;
    STATE.source = "";
    STATE.lyricCandidates = [];
    STATE.activeCandidateId = "";
    STATE.manualSelectedCandidateId = "";
    STATE.lyricsAppliedAt = 0;
    STATE.displayedVideoId = "";
    STATE.currentIndex = -1;
    STATE.currentWordIndex = -1;
    STATE.isSearching = true;
    manualScrollUntil = 0;
    pendingReturnToCurrent = false;
    autoScrollUntil = 0;
    setStatus(status);
    ensureLyricsMount();
    updateLyricsToolsUi();
    renderLines({ resetScroll: true });
    applySettings();
  }

  function beginEndedPlaybackTransition() {
    const now = performance.now();
    const media = getVideoElement();
    clearTrackStartGuard();
    // ended 発火時は YouTube Music 側が「次曲のURL/タイトルリンク」だけを
    // 先に更新していることがある。player/URLを先に採用すると、次曲IDを
    // 「終了した曲」と誤記録して永久待機になるため、実際に表示していた
    // 歌詞のvideoIdを最優先する。
    const endingVideoId =
      STATE.displayedVideoId ||
      STATE.stableTrackVideoId ||
      STATE.lastDisplayedVideoId ||
      STATE.observedVideoId ||
      getVideoId() ||
      getPlayerVideoIdFromDom() ||
      "";

    STATE.endedTransitionPending = true;
    STATE.endedVideoId = String(endingVideoId || "");
    STATE.endedTitle = String(STATE.stableTrackTitle || STATE.lastDisplayedTitle || "");
    STATE.endedNextVideoId = "";
    STATE.endedNextReadySince = 0;
    STATE.endedTimeResetSeen = false;
    STATE.endedTimeResetSeenAt = 0;
    STATE.endedAt = now;

    // 通常の遷移ガードも同時に立てるが、targetには「次曲」をまだ入れない。
    // ended直後はURLが終了曲のままなので、ここで旧videoIdを次曲扱いしないことが重要。
    STATE.playbackTransitionPending = true;
    STATE.transitionStartedAt = now;
    STATE.transitionTargetVideoId = "";
    STATE.transitionOldTime = getAuthoritativePlaybackTime(media) ?? 0;
    STATE.transitionOldDuration = getAuthoritativeDuration(media) ?? 0;
    STATE.transitionOldSrc = media && media.currentSrc ? String(media.currentSrc) : "";
    STATE.currentIndex = -1;
    STATE.currentWordIndex = -1;
    resetLyricsScrollPosition();
  }

  function clearEndedTransitionGuard() {
    STATE.endedTransitionPending = false;
    STATE.endedVideoId = "";
    STATE.endedTitle = "";
    STATE.endedNextVideoId = "";
    STATE.endedNextReadySince = 0;
    STATE.endedTimeResetSeen = false;
    STATE.endedTimeResetSeenAt = 0;
    STATE.endedAt = 0;
  }

  function markPlaybackTransition(targetVideoId = "") {
    const now = performance.now();
    const target = String(targetVideoId || getVideoId() || "");

    // 同じ遷移に対する ended / URL変化の重複通知では基準値を上書きしない。
    // ただし高速でさらに次曲へ送られ、targetVideoId 自体が変わった場合は
    // 新しい遷移として基準値を取り直す。これで A→B→C の連打にも追従する。
    if (
      STATE.playbackTransitionPending &&
      now - STATE.transitionStartedAt < 8000 &&
      (!target || !STATE.transitionTargetVideoId || target === STATE.transitionTargetVideoId)
    ) {
      return;
    }

    const media = getVideoElement();
    STATE.playbackTransitionPending = true;
    STATE.transitionStartedAt = now;
    STATE.transitionTargetVideoId = target;
    STATE.transitionOldTime = getAuthoritativePlaybackTime(media) ?? 0;
    STATE.transitionOldDuration = getAuthoritativeDuration(media) ?? 0;
    STATE.transitionOldSrc = media && media.currentSrc ? String(media.currentSrc) : "";
    resetLyricsScrollPosition();
  }

  function armTrackStartGuard(videoId = "", mediaTime = 0) {
    const now = performance.now();
    const t = Number(mediaTime);
    const safeStart = Number.isFinite(t) ? Math.max(0, Math.min(t, 6)) : 0;
    STATE.trackStartGuardActive = true;
    STATE.trackStartGuardVideoId = String(videoId || getPlayerVideoIdFromDom() || getVideoId() || "");
    STATE.trackStartGuardWallAt = now;
    STATE.trackStartGuardMediaAt = safeStart;
    STATE.trackStartGuardLastSafeTime = safeStart;
    STATE.trackStartGuardLastSafeAt = now;
  }

  function clearTrackStartGuard() {
    STATE.trackStartGuardActive = false;
    STATE.trackStartGuardVideoId = "";
    STATE.trackStartGuardWallAt = 0;
    STATE.trackStartGuardMediaAt = 0;
    STATE.trackStartGuardLastSafeTime = 0;
    STATE.trackStartGuardLastSafeAt = 0;
  }

  function getGuardedPlaybackTime(media = getVideoElement()) {
    const authoritative = getAuthoritativePlaybackTime(media);
    const raw = Number(authoritative);
    if (!Number.isFinite(raw) || raw < 0) return null;
    if (!STATE.trackStartGuardActive) return raw;

    const now = performance.now();
    const guardAgeMs = Math.max(0, now - STATE.trackStartGuardWallAt);

    // v1.6.6 の追跡停止原因:
    // YouTube Music の #movie_player 内タイトルリンクは次曲開始後もしばらく前曲IDを
    // 返すことがある。ここでID不一致を即returnすると、ガード解除処理まで到達できず
    // 正常な timeupdate まで永久に捨て続けてしまう。
    // 開始ガードは「時刻の異常値を短時間だけ落とす」役目に限定し、ID不一致では止めない。
    // さらに必ずタイムアウトさせ、何があっても追跡が永久停止しないようにする。
    if (guardAgeMs >= 2800) {
      clearTrackStartGuard();
      return raw;
    }

    const elapsed = guardAgeMs / 1000;
    const lastSafe = Number(STATE.trackStartGuardLastSafeTime) || 0;
    const sinceLastSafe = Math.max(0, (now - STATE.trackStartGuardLastSafeAt) / 1000);

    // 曲開始からの実時間より大幅に先へ飛んだ値だけを、前曲の残留 currentTime とみなす。
    // 0〜10秒台の正常な開始追跡は優先して通し、旧曲の数十秒〜終端への瞬間移動を落とす。
    const maxFromStart = STATE.trackStartGuardMediaAt + elapsed * 3.0 + 4.5;
    const maxFromLast = lastSafe + sinceLastSafe * 3.0 + 4.5;
    const implausibleForwardJump = raw > 12 && raw > maxFromStart && raw > maxFromLast;
    if (implausibleForwardJump) return null;

    // 自然に進んだ値を安全値として採用。小さな巻き戻りはイベントの揺れとして許容する。
    if (raw >= lastSafe - 1.25 || raw <= 4.0) {
      STATE.trackStartGuardLastSafeTime = raw;
      STATE.trackStartGuardLastSafeAt = now;
    }

    // 1秒強、自然な時刻だけで進めたら早めに通常追跡へ戻す。
    if (guardAgeMs >= 1200 && raw <= maxFromStart + 2.0) {
      clearTrackStartGuard();
    }
    return raw;
  }

  function canTrackCurrentPlayback(media = getVideoElement()) {
    const playerSnap = getFreshPlayerSnapshot();
    const playerHasPlayback = Boolean(
      playerSnap && playerSnap.videoId && Number.isFinite(playerSnap.currentTime) && playerSnap.playerState !== 0
    );
    // 古いvideo要素が ended=true のまま残っていても、Player API が次曲を示していれば追跡する。
    if ((!media || media.ended) && !playerHasPlayback) return false;

    const currentVideoId = getVideoId();
    const playerVideoId = getPlayerVideoIdFromDom();

    // v1.6.8: Player API の videoId と表示中歌詞が一致しているなら、これを最優先する。
    // 自動次曲時に古い <video> や title-link がDOMへ残っていても、その時刻を追跡へ使わない。
    if (playerSnap && playerSnap.videoId && STATE.displayedVideoId) {
      if (playerSnap.videoId !== STATE.displayedVideoId) {
        return false;
      }
      // ended遷移中でも、プレイヤー本体が「表示中歌詞の次曲」を示していれば遷移完了。
      if (STATE.endedTransitionPending && playerSnap.videoId !== STATE.endedVideoId) {
        clearEndedTransitionGuard();
        STATE.playbackTransitionPending = false;
        STATE.transitionTargetVideoId = "";
        STATE.currentIndex = -1;
        STATE.currentWordIndex = -1;
        clearTrackStartGuard();
        resetLyricsScrollPosition();
      } else if (STATE.playbackTransitionPending) {
        STATE.playbackTransitionPending = false;
        STATE.transitionTargetVideoId = "";
        STATE.currentIndex = -1;
        STATE.currentWordIndex = -1;
        clearTrackStartGuard();
        resetLyricsScrollPosition();
      }
      return true;
    }

    // 再生バーを末尾へ移動して ended -> 自動次曲になった場合は、
    // 旧曲の終端時刻が同じvideo要素に一瞬残ることがある。
    // v1.6.4では「IDが変わったこと」だけに依存しない。YouTube Musicは
    // ended発火より先に次曲IDだけ更新する場合があるため、IDを取り違えても
    // currentTimeの先頭復帰・タイトル・src/durationの変化から自己復旧する。
    if (STATE.endedTransitionPending) {
      const now = performance.now();
      const age = now - STATE.endedAt;
      const t = Number(getAuthoritativePlaybackTime(media));
      const duration = Number(getAuthoritativeDuration(media));
      const currentSrc = media.currentSrc ? String(media.currentSrc) : "";
      const oldTime = Number(STATE.transitionOldTime);
      const oldDuration = Number(STATE.transitionOldDuration);

      if (!Number.isFinite(t)) {
        STATE.endedNextReadySince = 0;
        return false;
      }

      // URLとプレイヤー内リンクが食い違う瞬間は、まだ混在状態なので待つ。
      if (currentVideoId && playerVideoId && currentVideoId !== playerVideoId) {
        STATE.endedNextReadySince = 0;
        return false;
      }

      const nextVideoId = String(playerVideoId || currentVideoId || "");
      const idChanged = Boolean(nextVideoId && (!STATE.endedVideoId || nextVideoId !== STATE.endedVideoId));

      const titleEl =
        document.querySelector("ytmusic-player-bar .title") ||
        document.querySelector(".title.ytmusic-player-bar");
      const currentTitle = titleEl ? String(titleEl.textContent || "").trim() : "";
      const titleChanged = Boolean(
        STATE.endedTitle && currentTitle && !titlesLikelySame(currentTitle, STATE.endedTitle)
      );

      const nearOldTime = Number.isFinite(oldTime) && oldTime > 2 && Math.abs(t - oldTime) <= 2.5;
      const nearOldEnd = Number.isFinite(oldDuration) && oldDuration > 4 && t >= oldDuration - 2.5;
      const timeReset = Boolean(
        t <= 8 ||
        (Number.isFinite(oldTime) && oldTime > 7 && t <= oldTime - 4)
      );
      const srcChanged = Boolean(currentSrc && STATE.transitionOldSrc && currentSrc !== STATE.transitionOldSrc);
      const durationChanged = Boolean(
        Number.isFinite(duration) && duration > 0 && oldDuration > 0 && Math.abs(duration - oldDuration) > 0.75
      );

      // v1.6.4 の本当の抜け:
      // YouTube Music の自動次曲では「次曲のID/src/duration」が先に更新され、
      // currentTimeだけ前曲の終端値を数百ms保持することがある。
      // その状態を srcChanged/durationChanged だけで許可すると、新曲歌詞に
      // 前曲の終端時刻を適用して最終行へ飛ぶ。
      // したがって ended 後は、まず currentTime が実際に先頭へ戻った事実を必須条件にする。
      const definiteTimeReset = Boolean(
        timeReset &&
        t <= 6.0 &&
        !(nearOldTime || nearOldEnd)
      );

      if (!STATE.endedTimeResetSeen) {
        if (!definiteTimeReset) {
          STATE.endedNextReadySince = 0;
          return false;
        }
        STATE.endedTimeResetSeen = true;
        STATE.endedTimeResetSeenAt = now;
        STATE.endedNextReadySince = 0;
        // 0秒へ戻った1サンプルだけではまだ追跡を再開しない。
        return false;
      }

      // 一度0秒付近を確認した後でも、古い終端値へ戻る揺れが見えたら再度待機する。
      if (nearOldTime || nearOldEnd) {
        STATE.endedTimeResetSeen = false;
        STATE.endedTimeResetSeenAt = 0;
        STATE.endedNextReadySince = 0;
        return false;
      }

      // IDを正常に取得できたケースを優先。IDを取り違えた/同一IDリピートでも、
      // 0秒付近への復帰を確認済みなら、一定時間後に自己復旧できる。
      const nextPlaybackEvidence = Boolean(
        idChanged ||
        srcChanged ||
        durationChanged ||
        (titleChanged && age >= 350) ||
        (age >= 650 && STATE.endedTimeResetSeen)
      );

      if (!nextPlaybackEvidence) {
        STATE.endedNextReadySince = 0;
        return false;
      }

      // 次曲の同期歌詞が既に表示済みなら、取得できたIDとも整合することを確認。
      // ただしID取り違え自己復旧中は time/title/src の証拠を優先する。
      if (
        STATE.hasSync &&
        STATE.displayedVideoId &&
        nextVideoId &&
        STATE.displayedVideoId !== nextVideoId &&
        !titleChanged &&
        !srcChanged &&
        !durationChanged
      ) {
        STATE.endedNextReadySince = 0;
        return false;
      }

      const stabilityKey = nextVideoId || `${currentTitle}::${Math.floor(duration || 0)}` || "playback-reset";
      if (STATE.endedNextVideoId !== stabilityKey) {
        STATE.endedNextVideoId = stabilityKey;
        STATE.endedNextReadySince = now;
        return false;
      }
      if (!STATE.endedNextReadySince) {
        STATE.endedNextReadySince = now;
        return false;
      }

      // 1フレームだけ0秒へ戻る揺れを拾わない。tickから歌詞未取得時にも
      // この判定を進めるため、ここで解除されないまま永久停止することはない。
      if (now - STATE.endedNextReadySince < 260) return false;
      if (STATE.endedTimeResetSeenAt && now - STATE.endedTimeResetSeenAt < 260) return false;

      // 0秒復帰を確認しても、解除直後に旧曲の終端currentTimeが
      // 1サンプルだけ戻ることがあるため、次曲開始ガードを引き継ぐ。
      armTrackStartGuard(nextVideoId, t);
      clearEndedTransitionGuard();
      STATE.playbackTransitionPending = false;
      STATE.transitionTargetVideoId = "";
      STATE.currentIndex = -1;
      STATE.currentWordIndex = -1;
      resetLyricsScrollPosition();
      return true;
    }

    const idMismatch = Boolean(STATE.displayedVideoId && currentVideoId && STATE.displayedVideoId !== currentVideoId);
    const playerVsUrlMismatch = Boolean(playerVideoId && currentVideoId && playerVideoId !== currentVideoId);
    const playerVsLyricsMismatch = Boolean(STATE.displayedVideoId && playerVideoId && STATE.displayedVideoId !== playerVideoId);
    const lyricsMatchesUrl = Boolean(STATE.displayedVideoId && currentVideoId && STATE.displayedVideoId === currentVideoId);
    const lyricsMatchesPlayer = Boolean(STATE.displayedVideoId && playerVideoId && STATE.displayedVideoId === playerVideoId);

    // v1.6.6では player 内タイトルリンクのIDを常に正しいものとして扱っていたため、
    // URLと表示中歌詞がすでに次曲で一致していても、リンクだけ前曲のままだと毎フレーム停止した。
    // URL + 表示中歌詞が一致している場合は playerVideoId を「遅れている補助情報」として無視する。
    if (playerVsUrlMismatch) {
      if (!lyricsMatchesUrl) {
        // 表示歌詞がまだ前曲(player側)なら、本当にURLだけ先行した遷移なので待つ。
        if (lyricsMatchesPlayer || !STATE.displayedVideoId) {
          markPlaybackTransition(currentVideoId || STATE.displayedVideoId);
          return false;
        }
      }
    }

    if (playerVsLyricsMismatch && !lyricsMatchesUrl) {
      markPlaybackTransition(currentVideoId || STATE.displayedVideoId);
      return false;
    }

    // 表示中の歌詞のvideoIdと実際の再生videoIdが食い違っているのに、
    // 遷移中フラグが立っていないケースは遷移処理へ合流させる。
    if (idMismatch && !STATE.playbackTransitionPending) {
      markPlaybackTransition(currentVideoId);
    }

    if (!STATE.playbackTransitionPending) return !idMismatch;

    const now = performance.now();
    const currentTime = Number(getAuthoritativePlaybackTime(media));
    const duration = Number(getAuthoritativeDuration(media));
    const currentSrc = media.currentSrc ? String(media.currentSrc) : "";

    const transitionAge = now - STATE.transitionStartedAt;
    const resetNearStart = transitionAge >= 650 && Number.isFinite(currentTime) && currentTime <= 5.0;
    const resetFromOldTime = Number.isFinite(currentTime) && STATE.transitionOldTime > 7 && currentTime <= STATE.transitionOldTime - 4;
    const srcChanged = Boolean(currentSrc && STATE.transitionOldSrc && currentSrc !== STATE.transitionOldSrc);
    const durationChanged = Number.isFinite(duration) && duration > 0 && STATE.transitionOldDuration > 0 && Math.abs(duration - STATE.transitionOldDuration) > 0.75;

    if (resetNearStart || resetFromOldTime || srcChanged || durationChanged) {
      STATE.playbackTransitionPending = false;
      STATE.currentIndex = -1;
      STATE.currentWordIndex = -1;
      STATE.transitionTargetVideoId = "";
      if (Number.isFinite(currentTime) && currentTime <= 6.0) {
        armTrackStartGuard(playerVideoId || currentVideoId, currentTime);
      }
      resetLyricsScrollPosition();
      return true;
    }

    if (now - STATE.transitionStartedAt > 6000 && Number.isFinite(currentTime) && currentTime < STATE.transitionOldTime) {
      STATE.playbackTransitionPending = false;
      STATE.currentIndex = -1;
      STATE.currentWordIndex = -1;
      STATE.transitionTargetVideoId = "";
      resetLyricsScrollPosition();
      return true;
    }

    if (now - STATE.transitionStartedAt > 10000) {
      STATE.playbackTransitionPending = false;
      STATE.currentIndex = -1;
      STATE.currentWordIndex = -1;
      STATE.transitionTargetVideoId = "";
      resetLyricsScrollPosition();
      return true;
    }

    return false;
  }

  function detectImmediateTrackTransition() {
    const activeVideoId = getAuthoritativeVideoId();
    const urlVideoId = getVideoId();
    if (!activeVideoId) return;

    // observedPlaybackVideoId は bridge側で安定確認済み。ここでは生の1フレーム値を
    // 直接採用しないため、歌詞タブ開閉時の一瞬の前曲IDで巻き戻らない。
    const observed = String(STATE.lastKnownVideoId || STATE.observedVideoId || "");
    if (!observed) {
      STATE.lastKnownVideoId = activeVideoId;
      if (urlVideoId) STATE.observedVideoId = urlVideoId;
      return;
    }

    if (activeVideoId === observed) {
      if (urlVideoId) STATE.observedVideoId = urlVideoId;

      // 表示中歌詞だけが前曲なら即破棄。
      if (STATE.displayedVideoId && STATE.displayedVideoId !== activeVideoId) {
        STATE.searchGeneration += 1;
        STATE.lastTrackKey = null;
        STATE.trackCandidateKey = "";
        STATE.trackCandidateSince = 0;
        clearLyricsForNewTrack("次の曲の歌詞を読み込み中…");
        openLyricsTabForTrack(activeVideoId);
      }
      return;
    }

    // 安定済み実再生IDが変わった時だけ本当の曲変更として確定する。
    const oldNative = extractNativeLyrics();
    STATE.previousNativeSignature = oldNative && oldNative.length ? oldNative.join("\n").trim() : "";

    markPlaybackTransition(activeVideoId);
    STATE.lastKnownVideoId = activeVideoId;
    if (urlVideoId) STATE.observedVideoId = urlVideoId;
    updateTrackTimingControl();
    STATE.videoIdChangedAt = performance.now();
    STATE.searchGeneration += 1;
    STATE.lastTrackKey = null;
    STATE.trackCandidateKey = "";
    STATE.trackCandidateSince = 0;
    clearLyricsForNewTrack("歌詞を探し中…");
    openLyricsTabForTrack(activeVideoId);
  }

  // ---------- 曲切り替え / マルチプロバイダ ----------
  async function checkTrackChange() {
    // ended直後はURL/MediaSessionが前曲のまま残るため、旧曲を再検索しない。
    const playback = getVideoElement();
    const liveSnap = getFreshPlayerSnapshot();
    if (liveSnap && liveSnap.videoId) {
      if (liveSnap.playerState === 0) return;
    } else if (playback && playback.ended) {
      return;
    }

    // ended後、同じvideo要素が先に ended=false / currentTime=0 へ戻っても、
    // URL/プレイヤーIDが終了曲のままなら旧曲を再検索しない。
    if (STATE.endedTransitionPending) {
      const urlVideoId = getVideoId();
      const playerVideoId = getPlayerVideoIdFromDom();
      if (urlVideoId && playerVideoId && urlVideoId !== playerVideoId) return;
      const activeVideoId = String(playerVideoId || urlVideoId || "");
      if (!activeVideoId || (STATE.endedVideoId && activeVideoId === STATE.endedVideoId)) return;
    }

    let info = getTrackInfo();
    if (!info) return;
    if (!STATE.manualSearchOverridesLoaded) return;

    // 自動次曲ではvideoIdだけ先に次曲へ変わり、タイトルだけ終了曲のまま残る場合がある。
    // その混在情報で検索しない。1.2秒以上同じなら同名曲の可能性を考慮して先へ進める。
    if (
      STATE.endedTransitionPending &&
      STATE.endedVideoId &&
      info.videoId &&
      info.videoId !== STATE.endedVideoId &&
      STATE.lastDisplayedTitle &&
      titlesLikelySame(info.title, STATE.lastDisplayedTitle) &&
      performance.now() - STATE.videoIdChangedAt < 1200
    ) {
      return;
    }

    // URL(videoId)切り替え直後はメタデータ更新が追いつくまでごく短時間だけ待つ。
    if (info.videoId && info.videoId === STATE.observedVideoId &&
        performance.now() - STATE.videoIdChangedAt < 300) return;

    const baseInfo = info;
    info = effectiveSearchInfo(baseInfo) || baseInfo;
    STATE.activeBaseInfo = baseInfo;
    STATE.activeSearchInfo = info;

    const key = `${info.videoId || ""}::${info.title}::${info.artist}`;
    if (key === STATE.lastTrackKey) {
      STATE.trackCandidateKey = key;
      STATE.trackCandidateSince = performance.now();
      return;
    }

    // 高速な次曲連打では URL / DOMタイトル / MediaSession が別々の順で更新される。
    // 同じ組み合わせが少しの間安定してから検索を開始し、一瞬だけ存在する混在状態を捨てる。
    const now = performance.now();
    if (STATE.trackCandidateKey !== key) {
      STATE.trackCandidateKey = key;
      STATE.trackCandidateSince = now;
      return;
    }
    if (now - STATE.trackCandidateSince < 450) return;

    STATE.lastTrackKey = key;
    // 曲変更検知経路に関係なく、検索開始が確定した時点でLyricsタブを優先する。
    // endedイベントを取りこぼした場合でも「次のコンテンツ」のままにならない。
    openLyricsTabForTrack(info.videoId || getAuthoritativeVideoId());
    if (info.videoId) STATE.stableTrackVideoId = info.videoId;
    STATE.stableTrackTitle = info.title || STATE.stableTrackTitle;
    const myGeneration = ++STATE.searchGeneration;
    STATE.lyricCandidates = [];
    STATE.activeCandidateId = "";
    STATE.manualSelectedCandidateId = "";
    updateLyricsToolsUi();
    const oldNativeSignature = STATE.previousNativeSignature;
    STATE.previousNativeSignature = "";

    // 同じ曲(タイトル+アーティスト)なら、保存済みの歌詞をすぐ表示して
    // プロバイダへの再検索をスキップする。表示が速くなり、
    // Homeへ戻って歌詞タブに戻った時などの余計な再検索も避けられる。
    const cacheKey = lyricsCacheKey(info);
    let cachedResult = cacheKey ? STATE.lyricsCache.get(cacheKey) : null;
    if (cachedResult && cachedResult._providerSignature !== providerConfigSignature()) {
      STATE.lyricsCache.delete(cacheKey);
      saveLyricsCacheToStorage();
      cachedResult = null;
    }
    if (cachedResult) {
      const cachedExpectedLanguage = inferTrackLanguage(info);
      const cleanedCachedResult = sanitizeCandidateForTrackLanguage(cachedResult, cachedExpectedLanguage);
      const cleanedUsable = Boolean(
        cleanedCachedResult &&
        String(cleanedCachedResult.syncLevel || "none") !== "none" &&
        cleanedCachedResult.lines.some((line) => line && line.time != null) &&
        lyricsLanguageFit(cleanedCachedResult, info, cachedExpectedLanguage) >= 0
      );
      const rawUsable = Boolean(
        String(cachedResult.syncLevel || "none") !== "none" &&
        Array.isArray(cachedResult.lines) &&
        cachedResult.lines.some((line) => line && line.time != null)
      );
      const cachedToApply = cleanedUsable ? cleanedCachedResult : (rawUsable ? cachedResult : null);
      if (cachedToApply) {
        upsertLyricsCandidate(cachedToApply);
        if (applyLyricsResult(cachedToApply, info, key, myGeneration)) {
          STATE.isSearching = false;
          return;
        }
        // 曲IDの更新途中などでキャッシュを適用できなかった場合は、ここで検索を
        // 打ち切らず通常検索へ続ける。以前は空表示のまま永久に止まることがあった。
      }
      STATE.lyricsCache.delete(cacheKey);
      saveLyricsCacheToStorage();
    }

    clearLyricsForNewTrack("歌詞を探し中…");

    const duration = await getTrackDuration(key);
    if (key !== STATE.lastTrackKey || myGeneration !== STATE.searchGeneration) return;

    let foundAny = false;
    let appliedCandidate = null;
    const collectedResults = [];
    const metadataLanguage = inferTrackLanguage(info);
    let nativeLanguageHint = "unknown";
    const ambiguousLanguageGateUntil = performance.now() + 1350;

    // メタデータの文字種より、実際の同一曲に表示された標準歌詞本文を優先する。
    // 日本語名のアーティストが英語詞を歌うケースなどで、有効な同期候補を全除外しない。
    const resolvedTrackLanguage = () =>
      nativeLanguageHint !== "unknown" ? nativeLanguageHint : metadataLanguage;

    const candidateIdentity = (result) => lyricCandidateIdentity(result);

    const reevaluateCandidates = (force = false) => {
      if (key !== STATE.lastTrackKey || myGeneration !== STATE.searchGeneration) return;

      const expected = resolvedTrackLanguage();
      // 曲名がローマ字/漢字だけ等で言語を断定できない場合は、標準歌詞の言語が
      // 取得できる余地を少しだけ残す。これで日本曲の中国語候補を先に表示しにくくする。
      if (
        !force &&
        metadataLanguage === "unknown" &&
        nativeLanguageHint === "unknown" &&
        performance.now() < ambiguousLanguageGateUntil
      ) return;

      const ranked = collectedResults
        .map((rawResult) => {
          const result = sanitizeCandidateForTrackLanguage(rawResult, expected);
          if (!result) return null;
          result._recommendationScore = candidateRecommendationScore(result, info, expected);
          return {
            result,
            languageFit: lyricsLanguageFit(result, info, expected),
            recommendationScore: result._recommendationScore,
            quality: resultQuality(result),
            purity: result._languageSanitized ? 0 : 1,
          };
        })
        .filter((x) => x && x.languageFit >= 0)
        .sort((a, b) =>
          (b.languageFit - a.languageFit) ||
          (b.recommendationScore - a.recommendationScore) ||
          (b.quality - a.quality) ||
          (b.purity - a.purity)
        );

      let best = ranked[0];
      // 言語判定はヒューリスティックなので、同期候補そのものがある場合は
      // 「見つかりません」にせず、最終的に最も品質の高い候補を表示する。
      // 翻訳行除外に成功した候補がある場合は、従来どおりそちらを優先する。
      if (!best && force) {
        best = collectedResults
          .filter((result) => result && Array.isArray(result.lines) && result.lines.length)
          .map((result) => {
            result._recommendationScore = candidateRecommendationScore(result, info, expected);
            return {
              result,
              languageFit: 0,
              recommendationScore: result._recommendationScore,
              quality: resultQuality(result),
              purity: 0,
            };
          })
          .sort((a, b) =>
            (b.recommendationScore - a.recommendationScore) ||
            (b.quality - a.quality)
          )[0];
      }
      if (!best) return;
      if (STATE.manualSelectedCandidateId) return;
      if (appliedCandidate && candidateIdentity(appliedCandidate) === candidateIdentity(best.result)) return;

      upsertLyricsCandidate(best.result);
      if (applyLyricsResult(best.result, info, key, myGeneration)) {
        foundAny = true;
        appliedCandidate = best.result;
      }
    };

    const acceptResult = (result) => {
      if (key !== STATE.lastTrackKey || myGeneration !== STATE.searchGeneration) return;
      if (!result || !Array.isArray(result.lines) || !result.lines.length) return;
      if (String(result.syncLevel || "none") === "none" || !result.lines.some((line) => line && line.time != null)) return;

      const id = candidateIdentity(result);
      result._candidateId = id;
      if (!collectedResults.some((x) => candidateIdentity(x) === id)) collectedResults.push(result);
      upsertLyricsCandidate(result);

      reevaluateCandidates(false);
    };

    const ambiguousGateTimer = setTimeout(() => {
      if (key === STATE.lastTrackKey && myGeneration === STATE.searchGeneration) {
        reevaluateCandidates(true);
      }
    }, 1400);

    const providerTasks = [
      { key: "betterLyrics", run: () => fetchFromBetterLyricsV2(info, duration, key) },
      { key: "betterLyrics", run: () => fetchFromBetterLyricsJson(info, duration, key) },
      { key: "betterLyrics", run: () => fetchFromBetterLyrics(info, duration, key) },
      { key: "betterLyrics", run: () => fetchFromBoiduProvider(info, duration, key, "qq") },
      { key: "betterLyrics", run: () => fetchFromBoiduProvider(info, duration, key, "kugou") },
      { key: "lrclib", run: () => fetchFromLrclib(info, duration, key) },
      { key: "unison", run: () => fetchFromUnison(info, duration, key) },
      { key: "binilyrics", run: () => fetchFromBiniLyrics(info, duration, key) },
      { key: "karalyr", run: () => fetchFromKaralyr(info, duration, key) },
    ].filter((provider) => STATE.providerEnabled[provider.key] !== false);

    // 全ソースを並列検索。1件返るたび、その場で表示/アップグレードする。
    const tasks = providerTasks.map(async (provider) => {
      let result = null;
      try {
        result = await provider.run();
      } catch (_) {
        result = null;
      }
      if (key !== STATE.lastTrackKey || myGeneration !== STATE.searchGeneration) return;
      if (result) result._providerKey = provider.key;
      acceptResult(result);
    });

    tasks.push((async () => {
      // YouTube Music標準歌詞は表示には使わず、原曲言語の判定にのみ使う。
      const nativeLines = await waitForNativeLyrics(key, myGeneration, oldNativeSignature);
      if (nativeLines && nativeLines.length) {
        const detected = detectLyricsLanguageFromText(nativeLines.join("\n"));
        if (detected !== "unknown") {
          nativeLanguageHint = detected;
          reevaluateCandidates(false);
        }
      }
    })());

    await Promise.allSettled(tasks);
    clearTimeout(ambiguousGateTimer);
    if (key !== STATE.lastTrackKey || myGeneration !== STATE.searchGeneration) return;
    reevaluateCandidates(true);

    STATE.isSearching = false;
    if (foundAny) {
      // 最終的に採用された歌詞を維持。検索完了時に消さない。
      applySettings();
      if (cacheKey) {
        const activeCandidate = STATE.lyricCandidates.find((candidate) => candidate.id === STATE.activeCandidateId);
        rememberLyricsInCache(cacheKey, activeCandidate ? activeCandidate.result : {
          lines: STATE.lines,
          syncLevel: STATE.syncLevel,
          _source: STATE.source,
        });
      }
      return;
    }

    STATE.hasLyricsResult = false;
    setStatus(resolvedTrackLanguage() === "ja" ? "日本語の同期歌詞が見つかりませんでした" : "同期歌詞が見つかりませんでした");
    ensureLyricsMount();
    renderLines();
    applySettings();
  }

  // ---------- 手動スクロール制御 ----------
  function pauseAutoScrollFromUser() {
    if (!STATE.trackingEnabled) return;
    manualScrollUntil = performance.now() + 3500;
    pendingReturnToCurrent = true;
  }

  function isManualScrollPaused() {
    return performance.now() < manualScrollUntil;
  }

  function trackingAllowsAutoScroll() {
    return Boolean(STATE.trackingEnabled);
  }

  function clearTrackingVisuals() {
    if (!listEl) return;
    listEl.querySelectorAll(".ytmls-active, .ytmls-near, .ytmls-far").forEach((el) => el.classList.remove("ytmls-active", "ytmls-near", "ytmls-far"));
    listEl.querySelectorAll(".ytmls-word").forEach((el) => {
      el.classList.remove("ytmls-word-sung", "ytmls-word-current");
      el.style.removeProperty("--ytmls-word-progress");
    });
    STATE.currentIndex = -1;
    STATE.currentWordIndex = -1;
  }

  function scrollCurrentLineIntoView(lineEl, behavior = "smooth") {
    if (!lineEl || !listEl || !trackingAllowsAutoScroll()) return;
    autoScrollUntil = performance.now() + (behavior === "smooth" ? 900 : 250);

    const listRect = listEl.getBoundingClientRect();
    const lineRect = lineEl.getBoundingClientRect();
    const currentTop = listEl.scrollTop;
    const lineTopInList = currentTop + (lineRect.top - listRect.top);
    const lineBottomInList = lineTopInList + lineRect.height;


    // scrollIntoViewはYouTube Music本体までスクロールする場合があるため、歌詞リストだけ動かす。
    const targetTop = Math.max(0, lineTopInList - (listEl.clientHeight - lineRect.height) / 2);
    listEl.scrollTo({ top: targetTop, behavior });
  }

  function bindScrollInteraction() {
    if (!listEl || scrollInteractionBound) return;
    scrollInteractionBound = true;

    // ホイール・タッチ・キー操作は確実にユーザー操作として扱う。
    listEl.addEventListener("wheel", pauseAutoScrollFromUser, { passive: true });
    listEl.addEventListener("touchstart", pauseAutoScrollFromUser, { passive: true });
    listEl.addEventListener("touchmove", pauseAutoScrollFromUser, { passive: true });
    listEl.addEventListener("keydown", (event) => {
      if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) {
        pauseAutoScrollFromUser();
      }
    });

    // スクロールバーをドラッグした場合も拾う。自動scrollIntoView中のscrollは除外。
    listEl.addEventListener("scroll", () => {
      if (performance.now() > autoScrollUntil) pauseAutoScrollFromUser();
    }, { passive: true });
  }

  // ---------- 同期ハイライト ----------
  function findCurrentLineIndex(currentTime) {
    if (!STATE.lines.length) return -1;
    let lo = 0;
    let hi = STATE.lines.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const t = STATE.lines[mid].time;
      if (t == null || t > currentTime) {
        hi = mid - 1;
      } else {
        ans = mid;
        lo = mid + 1;
      }
    }
    return ans;
  }

  function updateWordHighlight(lineIndex, currentTime) {
    if (!listEl || lineIndex < 0) return;
    const line = STATE.lines[lineIndex];
    if (!line || !Array.isArray(line.words) || !line.words.length) return;

    const lineEl = listEl.children[lineIndex];
    if (!lineEl) return;
    const wordEls = lineEl.querySelectorAll(".ytmls-word");
    const mode = STATE.wordTrackingStyle || "smooth";

    let currentWord = -1;
    for (let wi = 0; wi < line.words.length; wi++) {
      const start = Number(line.words[wi] && line.words[wi].time);
      if (Number.isFinite(start) && start <= currentTime) currentWord = wi;
      else if (Number.isFinite(start) && start > currentTime) break;
    }

    const wordChanged = STATE.currentWordIndex !== currentWord;

    // 単語が変わった瞬間だけ、前後の単語の確定状態を更新。
    // 毎フレーム全単語を書き換えないので、DOM負荷を大幅に下げて滑らかにする。
    if (wordChanged || mode === "step") {
      wordEls.forEach((el, wi) => {
        const sung = wi < currentWord || (mode === "step" && wi === currentWord);
        const current = wi === currentWord;
        el.classList.toggle("ytmls-word-sung", Boolean(sung));
        el.classList.toggle("ytmls-word-current", Boolean(current));
        if (wi < currentWord) el.style.setProperty("--ytmls-word-progress", "100%");
        else if (wi > currentWord) el.style.setProperty("--ytmls-word-progress", "0%");
      });
      STATE.currentWordIndex = currentWord;
    }

    if (currentWord < 0 || !wordEls[currentWord]) return;
    if (mode === "step") {
      wordEls[currentWord].style.setProperty("--ytmls-word-progress", "100%");
      return;
    }

    const word = line.words[currentWord] || {};
    const start = Number(word.time);
    const nextStart = currentWord + 1 < line.words.length ? Number(line.words[currentWord + 1].time) : NaN;
    let end = Number(word.end);
    if (!Number.isFinite(end) || !Number.isFinite(start) || end <= start) {
      if (Number.isFinite(nextStart) && nextStart > start) end = nextStart;
      else if (Number.isFinite(line.end) && line.end > start) end = Number(line.end);
      else end = start + 0.65;
    }

    // smooth: 時刻通りに直線で進む
    // silky: 少しだけ先読み + smoothstepで端を丸めて、よりぬるぬる見せる
    const lookAhead = mode === "silky" ? 0.065 : 0;
    const raw = Math.max(0, Math.min(1, (currentTime + lookAhead - start) / Math.max(0.08, end - start)));
    const progress = mode === "silky" ? raw * raw * (3 - 2 * raw) : raw;
    const currentEl = wordEls[currentWord];
    currentEl.style.setProperty("--ytmls-word-progress", `${(progress * 100).toFixed(3)}%`);
    currentEl.classList.toggle("ytmls-word-sung", progress >= 0.999);
    currentEl.classList.add("ytmls-word-current");
  }

  function updateHighlight(currentTime, force = false) {
    if (!STATE.hasSync || !STATE.lines.length || !listEl) return;

    // 曲切り替え直後のvideo要素は旧曲のcurrentTimeを一瞬保持する。
    // canTrackの解除直後にも古いtimeupdateが1回飛ぶことがあるため、
    // 呼び出し元から渡された時刻ではなく「今この瞬間のmedia.currentTime」を再読込し、
    // さらに次曲開始ガードで不自然な前方ジャンプを拒否する。
    const media = getVideoElement();
    if (!canTrackCurrentPlayback(media)) return;
    const safeCurrentTime = getGuardedPlaybackTime(media);
    if (safeCurrentTime == null) return;

    STATE.lastTrackingPulseAt = performance.now();

    if (!STATE.trackingEnabled) {
      clearTrackingVisuals();
      return;
    }

    const adjustedTime = Math.max(0, safeCurrentTime + timingOffsetSeconds(safeCurrentTime, getAuthoritativeDuration(media)));
    const idx = findCurrentLineIndex(adjustedTime);
    const changedLine = idx !== STATE.currentIndex;
    const children = listEl.children;

    if (changedLine || force) {
      STATE.currentIndex = idx;
      STATE.currentWordIndex = -1;

      for (let i = 0; i < children.length; i++) {
        const isActive = i === idx;
        const distance = idx >= 0 ? Math.abs(i - idx) : 999;
        children[i].classList.toggle("ytmls-active", isActive);
        children[i].classList.toggle("ytmls-near", !isActive && distance <= 1);
        children[i].classList.toggle("ytmls-far", !isActive && distance > 1);
      }

      if (idx >= 0 && children[idx] && trackingAllowsAutoScroll()) {
        if (isManualScrollPaused()) {
          // ハイライト追跡は続けるが、ユーザーが読んでいる位置は奪わない。
          pendingReturnToCurrent = true;
        } else {
          scrollCurrentLineIntoView(children[idx]);
          pendingReturnToCurrent = false;
        }
      }
    }

    // 手動スクロールが止まって設定時間が経ったら現在位置へ戻す。
    if (trackingAllowsAutoScroll() && pendingReturnToCurrent && !isManualScrollPaused() && idx >= 0 && children[idx]) {
      scrollCurrentLineIntoView(children[idx]);
      pendingReturnToCurrent = false;
    }

    if (idx >= 0 && (STATE.syncLevel === "word" || STATE.syncLevel === "syllable")) {
      updateWordHighlight(idx, adjustedTime);
    }
  }
  function startTrackingLoop() {
    if (trackingRaf) return;

    const frame = () => {
      trackingRaf = requestAnimationFrame(frame);
      if (!STATE.enabled || !STATE.hasSync) return;
      const video = videoEl && videoEl.isConnected ? videoEl : getVideoElement();
      if (!canTrackCurrentPlayback(video)) return;
      updateHighlight(getAuthoritativePlaybackTime(video) || 0);
    };

    trackingRaf = requestAnimationFrame(frame);
  }

  function restartLyricsSearch(message = "歌詞を再検索中…") {
    if (!STATE.enabled) return;
    STATE.searchGeneration += 1;
    STATE.lastTrackKey = null;
    STATE.trackCandidateKey = "";
    STATE.trackCandidateSince = 0;
    manualScrollUntil = 0;
    pendingReturnToCurrent = false;
    clearLyricsForNewTrack(message);
    setTimeout(tick, 20);
    setTimeout(tick, 180);
  }

  function resetTrackingForPlaybackChange(message = "歌詞を探し中…") {
    markPlaybackTransition(getVideoId());
    STATE.searchGeneration += 1;
    STATE.lastTrackKey = null;
    STATE.trackCandidateKey = "";
    STATE.trackCandidateSince = 0;
    manualScrollUntil = 0;
    pendingReturnToCurrent = false;
    clearLyricsForNewTrack(message);
    setTimeout(tick, 60);
    setTimeout(tick, 260);
  }

  function ensureVideoListener() {
    const video = getVideoElement();
    if (!video) {
      startTrackingLoop();
      return;
    }

    if (video !== videoEl) {
      if (videoEl && videoTimeUpdateHandler) {
        videoEl.removeEventListener("timeupdate", videoTimeUpdateHandler);
        if (videoForceUpdateHandler) {
          videoEl.removeEventListener("seeked", videoForceUpdateHandler);
          videoEl.removeEventListener("play", videoForceUpdateHandler);
        }
        videoEl.removeEventListener("ended", videoEndedHandler);
        videoEl.removeEventListener("loadedmetadata", videoMetadataHandler);
      }

      videoEl = video;
      videoTimeUpdateHandler = () => {
        if (!STATE.enabled || !videoEl || videoEl.ended || !canTrackCurrentPlayback(videoEl)) return;
        // timeupdate は再生中に何度も来るため force=true にしない。
        // 同じ行への smooth scroll を連続発行すると、曲切替後まで旧スクロールが残る原因になる。
        updateHighlight(getAuthoritativePlaybackTime(videoEl) || 0, false);
      };
      videoForceUpdateHandler = () => {
        if (!STATE.enabled || !videoEl || videoEl.ended || !canTrackCurrentPlayback(videoEl)) return;
        updateHighlight(getAuthoritativePlaybackTime(videoEl) || 0, true);
      };
      videoEndedHandler = () => {
        if (!STATE.enabled) return;
        beginEndedPlaybackTransition();
        STATE.searchGeneration += 1;
        STATE.lastTrackKey = null;
        STATE.trackCandidateKey = "";
        STATE.trackCandidateSince = 0;
        manualScrollUntil = 0;
        pendingReturnToCurrent = false;
        clearLyricsForNewTrack("次の曲の歌詞を待っています…");
        openLyricsTabForTrack();
        setTimeout(tick, 60);
        setTimeout(tick, 260);
      };
      videoMetadataHandler = () => {
        if (!STATE.enabled) return;
        const currentVideoId = getAuthoritativeVideoId();
        if (STATE.displayedVideoId && currentVideoId && STATE.displayedVideoId !== currentVideoId) {
          resetTrackingForPlaybackChange("歌詞を探し中…");
          return;
        }
        STATE.currentIndex = -1;
        STATE.currentWordIndex = -1;
        resetLyricsScrollPosition();
        canTrackCurrentPlayback(videoEl);
        setTimeout(tick, 80);
      };
      videoEl.addEventListener("timeupdate", videoTimeUpdateHandler);
      videoEl.addEventListener("seeked", videoForceUpdateHandler);
      videoEl.addEventListener("play", videoForceUpdateHandler);
      videoEl.addEventListener("ended", videoEndedHandler);
      videoEl.addEventListener("loadedmetadata", videoMetadataHandler);
    }

    // timeupdateだけでなくrequestAnimationFrameでも追跡し、単語/音節の細かいタイミングも追う。
    startTrackingLoop();
  }

  // ---------- メイン ----------
  function tick() {
    ensureLyricsMount();
    ensureVideoListener();
    ensurePlayerBarTimingControl();
    maintainLyricsAutoOpen();

    if (STATE.enabled) {
      detectImmediateTrackTransition();

      // 歌詞取得前(hasSync=false)でも遷移ガードを必ず進める。
      // v1.6.3はここがRAF側のhasSync判定に阻まれ、endedVideoIdを
      // 取り違えた1回をきっかけに永久停止するデッドロックがあった。
      if (STATE.playbackTransitionPending || STATE.endedTransitionPending) {
        canTrackCurrentPlayback(getVideoElement());
      }

      checkTrackChange();
      runAutoRecoveryWatchdog();
      updatePlayerBarHealth();
    } else {
      applySettings();
      updatePlayerBarHealth();
    }
  }

  function init() {
    bindAutoLyricsIdleInteractionWatch();
    loadSettings();
    loadTrackTimingOffsets();
    loadLyricsCacheFromStorage();
    loadManualSearchOverrides();
    setInterval(tick, 300);
    tick();
    // ページを開いた時点ですでに「次のコンテンツ」なら、無操作時だけ歌詞へ移動する。
    setTimeout(() => {
      if (STATE.enabled) openLyricsTabForTrack(getAuthoritativeVideoId());
    }, 900);
  }

  if (document.readyState === "complete" || document.readyState === "interactive") {
    setTimeout(init, 350);
  } else {
    window.addEventListener("DOMContentLoaded", () => setTimeout(init, 350));
  }
})();
