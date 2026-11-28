  // ---------- メイン ----------
  function tick(...args) {
   const started = typeof performance === 'object' ? performance.now() : 0;
   try { return tickMeasured(...args); } finally { if (started) globalThis.ytmlsPerfAdd?.('content tick (300ms)', performance.now() - started); }
  }
  // Each step of the regular tick is timed for the diagnostics (Perf: own=[tick:…]).
  function tickPart(name, fn) {
    const started = typeof performance === 'object' ? performance.now() : 0;
    try { return fn(); } finally { if (started) globalThis.ytmlsPerfAdd?.(`tick:${name}`, performance.now() - started); }
  }
  function tickMeasured() {
    if (document.hidden || !runtimeAvailable()) return;
    if (typeof practiceTick === "function") tickPart("practiceTick", practiceTick);
    tickPart("updateLyricsTheme", updateLyricsTheme);
    tickPart("ensureLyricsMount", ensureLyricsMount);
    tickPart("ensureVideoListener", ensureVideoListener);
    tickPart("ensurePlayerBarTimingControl", ensurePlayerBarTimingControl);
    if (typeof ensureYtmTabGlassSegment === "function") tickPart("ensureYtmTabGlassSegment", ensureYtmTabGlassSegment);
    if (typeof ensureYtmAvToggleGlass === "function") tickPart("ensureYtmAvToggleGlass", ensureYtmAvToggleGlass);
    tickPart("maintainLyricsAutoOpen", maintainLyricsAutoOpen);

    if (STATE.enabled) {
      tickPart("detectImmediateTrackTransition", detectImmediateTrackTransition);

      // 歌詞取得前(hasSync=false)でも遷移ガードを必ず進める。
      // v1.6.3はここがRAF側のhasSync判定に阻まれ、endedVideoIdを
      // 取り違えた1回をきっかけに永久停止するデッドロックがあった。
      if (STATE.playbackTransitionPending || STATE.endedTransitionPending) {
        canTrackCurrentPlayback(getVideoElement());
      }

      tickPart("checkTrackChange", checkTrackChange);
      if (STATE.pendingInitialHighlight && STATE.hasSync && trackingDisplayVisible()) {
        updateHighlight(getAuthoritativePlaybackTime(getVideoElement()), true);
      }
      tickPart("runAutoRecoveryWatchdog", runAutoRecoveryWatchdog);
      tickPart("updatePlayerBarHealth", updatePlayerBarHealth);
      tickPart("updateDiagnosticsSummary", updateDiagnosticsSummary);
    } else {
      tickPart("applySettings", applySettings);
      tickPart("updatePlayerBarHealth", updatePlayerBarHealth);
      tickPart("updateDiagnosticsSummary", updateDiagnosticsSummary);
    }
  }

  function init() {
    // YouTube Music reuses the same renderer for related/queue tabs.
    // Observe only tab-routing attributes, not animated lyric classes.
    let tabRefreshPending = false;
    const refreshTabVisibility = () => {
      if (tabRefreshPending) return;
      tabRefreshPending = true;
      queueMicrotask(() => {
        tabRefreshPending = false;
        if (!STATE.contextInvalidated) { ensureLyricsMount(); applySettings(); }
      });
    };
    new MutationObserver(refreshTabVisibility).observe(document.body, {
      subtree: true, attributes: true,
      attributeFilter: ["page-type", "aria-selected", "selected", "aria-hidden"],
    });
    bindAutoLyricsIdleInteractionWatch();
    bindProviderTestListener();
    loadSettings();
    initPracticeStorage();
    loadTrackTimingOffsets();
    loadLyricsCacheFromStorage();
    loadManualSearchOverrides();
    loadLyricsEdits();
    loadPinnedLyrics();
    loadLocalLyrics();
    document.addEventListener("visibilitychange", () => { if (!document.hidden) tick(); });
    // Run at the start of a frame: the page's styles and layout from the last frame are usually still
    // valid then, so the tick's reads do not make the browser work them out again in the middle of
    // other work (on a big YouTube Music page that was a pause of tens of milliseconds every 300ms).
    let tickQueued = false;
    setInterval(() => {
      if (tickQueued || typeof requestAnimationFrame !== "function") { if (!tickQueued) tick(); return; }
      tickQueued = true;
      requestAnimationFrame(() => { tickQueued = false; tick(); });
    }, 300);
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
