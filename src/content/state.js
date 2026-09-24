  const STATE = {
    enabled: true,
    fontSize: 32,
    readingJapanese: true,
    readingEnglish: true,
    trackingPosition: 42,
    manualScrollReturnMs: 3500,
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
    providerOrder: ["youtubeMusic", "betterLyrics", "lrclib", "unison", "binilyrics", "karalyr"],
    providerEnabled: {
      youtubeMusic: true,
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
    lyricsEdits: {},
    lyricsEditsLoaded: false,
    pinnedLyrics: {},
    pinnedLyricsLoaded: false,
    localLyrics: {},
    localLyricsLoaded: false,
    localLyricsDrafts: {},
    activeProviderKey: "",
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
  let editLyricsButtonEl = null;
  let localLyricsButtonEl = null;
  let exportLyricsButtonEl = null;
  let candidateSaveBusy = false;
  let lyricsToolsPaneEl = null;
  let lyricsToolsPaneMode = "";
  let diagnosticsEl = null;
  let diagnosticsSummaryEl = null;
  let diagnosticsCopyButtonEl = null;

  // 手動スクロール後は追跡スクロールを一時停止。
  // 操作が止まってから少し待って現在行へ戻す。
  let manualScrollUntil = 0;
  let pendingReturnToCurrent = false;
  let autoScrollUntil = 0;
  let scrollInteractionBound = false;
  let lyricsWasVisible = false;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const PROVIDERS = [
    { key: "youtubeMusic", label: "YouTube Music（行同期）" },
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
    if (String(providerKey || "") === "local") return -1;
    const index = STATE.providerOrder.indexOf(String(providerKey || ""));
    return index >= 0 ? index : STATE.providerOrder.length + 1;
  }

  function providerConfigSignature() {
    return STATE.providerOrder
      .filter((key) => STATE.providerEnabled[key] !== false)
      .join(">");
  }
  let authorShortcutController = null;
