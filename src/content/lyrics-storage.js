  // ---------- 歌詞キャッシュ（同じ曲は保存済みを使い回す） ----------
  // v1.8.0: 言語処理と標準歌詞フォールバックを作り直したため旧キャッシュを引き継がない。
  // 壊れた永続キャッシュを新コードへ持ち込まないため、保存キーを更新して完全に分離する。
  // v1.9.8: 同名別アーティストを採用していた旧キャッシュを引き継がない。
  const LYRICS_CACHE_STORAGE_KEY = "ytmlsLyricsCacheV198";
  const LYRICS_CACHE_MAX_ENTRIES = 150;
  const MANUAL_SEARCH_STORAGE_KEY = "ytmlsManualSearchOverridesV190";
  const MANUAL_SEARCH_MAX_ENTRIES = 200;
  const LYRICS_EDITS_STORAGE_KEY = "ytmlsLyricsEditsV199";
  const PINNED_LYRICS_STORAGE_KEY = "ytmlsPinnedLyricsV200";
  // 固定・ローカル歌詞はユーザーデータなので、キャッシュのように件数で自動削除しない。
  const PINNED_LYRICS_MAX_TRACKS = null;
  const LOCAL_LYRICS_STORAGE_KEY = "ytmlsLocalLyricsV200";
  const LOCAL_LYRICS_MAX_TRACKS = null;
  const LOCAL_LYRICS_MAX_CHARS = 500000;

  function checkedLocalStorageGet(defaults) {
    return new Promise((resolve, reject) => {
      try {
        chrome.storage.local.get(defaults, (data) => {
          const error = chrome.runtime && chrome.runtime.lastError;
          if (error) {
            reject(new Error(error.message || "保存データを読み込めませんでした。"));
            return;
          }
          resolve(data || {});
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function checkedLocalStorageSet(value) {
    return new Promise((resolve, reject) => {
      try {
        chrome.storage.local.set(value, () => {
          const error = chrome.runtime && chrome.runtime.lastError;
          if (error) {
            reject(new Error(error.message || "保存できませんでした。"));
            return;
          }
          resolve();
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  async function mutateStoredTrackMap(storageKey, fallbackMap, videoId, entry, maxEntries, isValid) {
    const data = await sendUserDataMutation({ action: "entry", key: storageKey, videoId, entry });
    return data[storageKey];
  }

  function limitedTrackMap(value, maxEntries, isValid) {
    let entries = Object.entries(value || {})
      .filter(([videoId, entry]) => videoId && entry && (!isValid || isValid(entry)))
      .sort((a, b) => Number(b[1].updatedAt || 0) - Number(a[1].updatedAt || 0));
    if (Number.isFinite(maxEntries) && maxEntries > 0) entries = entries.slice(0, maxEntries);
    return Object.fromEntries(entries);
  }

  function getPinnedLyricsEntry(videoId) {
    const entry = STATE.pinnedLyrics && STATE.pinnedLyrics[String(videoId || "")];
    return entry && entry.result && Array.isArray(entry.result.lines) && entry.result.lines.length ? entry : null;
  }

  async function savePinnedLyricsCandidate(videoId, candidate, info) {
    const id = String(videoId || "");
    if (!id || !candidate || !candidate.result || !Array.isArray(candidate.result.lines)) {
      return { ok: false, message: "この歌詞候補を固定できませんでした。" };
    }
    const candidateId = String(candidate.id || lyricCandidateIdentity(candidate.result));
    let result;
    try {
      result = JSON.parse(JSON.stringify({
        lines: candidate.result.lines,
        syncLevel: candidate.result.syncLevel || "line",
        _source: candidate.result._source || "歌詞",
        _providerKey: candidate.result._providerKey || "",
        _candidateId: candidateId,
        _recommendationScore: Number(candidate.result._recommendationScore || 0),
      }));
    } catch (_) {
      return { ok: false, message: "この歌詞候補を固定できませんでした。" };
    }
    const entry = {
      candidateId,
      result,
      title: String((info && info.title) || ""),
      artist: String((info && info.artist) || ""),
      updatedAt: Date.now(),
    };
    try {
      STATE.pinnedLyrics = await mutateStoredTrackMap(
        PINNED_LYRICS_STORAGE_KEY,
        STATE.pinnedLyrics,
        id,
        entry,
        PINNED_LYRICS_MAX_TRACKS,
        (value) => value.result && Array.isArray(value.result.lines) && value.result.lines.length
      );
      updateDiagnosticsSummary();
      return { ok: true };
    } catch (_) {
      return { ok: false, message: "固定を保存できませんでした。拡張機能を再読み込みして、もう一度お試しください。" };
    }
  }

  async function deletePinnedLyricsEntry(videoId) {
    const id = String(videoId || "");
    if (!id) return { ok: false, message: "曲IDを取得できませんでした。" };
    try {
      STATE.pinnedLyrics = await mutateStoredTrackMap(
        PINNED_LYRICS_STORAGE_KEY,
        STATE.pinnedLyrics,
        id,
        null,
        PINNED_LYRICS_MAX_TRACKS,
        (value) => value.result && Array.isArray(value.result.lines) && value.result.lines.length
      );
      updateDiagnosticsSummary();
      return { ok: true };
    } catch (_) {
      return { ok: false, message: "固定の解除を保存できませんでした。" };
    }
  }

  function loadPinnedLyrics() {
    try {
      chrome.storage.local.get({ [PINNED_LYRICS_STORAGE_KEY]: {} }, (data) => {
        const stored = data && data[PINNED_LYRICS_STORAGE_KEY];
        STATE.pinnedLyrics = stored && typeof stored === "object" ? stored : {};
        STATE.pinnedLyricsLoaded = true;
        tick();
      });
    } catch (_) {
      STATE.pinnedLyricsLoaded = true;
    }
  }

  function localLyricsCandidateId(videoId) {
    return `local::${String(videoId || "")}`;
  }

  function getLocalLyricsEntry(videoId) {
    const entry = STATE.localLyrics && STATE.localLyrics[String(videoId || "")];
    return entry && typeof entry.rawLrc === "string" && entry.rawLrc.trim() ? entry : null;
  }

  function localLyricsResult(videoId, entry = getLocalLyricsEntry(videoId)) {
    const id = String(videoId || "");
    if (!id || !entry) return null;
    const parsed = parseLRC(entry.rawLrc)
      .filter((line) => line && Number.isFinite(Number(line.time)) && editableLineText(line).trim());
    if (!parsed.length) return null;
    return {
      lines: rebuildFilteredLineEnds(parsed, "line"),
      syncLevel: "line",
      _source: "ローカル歌詞",
      _providerKey: "local",
      _candidateId: localLyricsCandidateId(id),
      _recommendationScore: 100,
    };
  }

  async function saveLocalLyricsEntry(videoId, rawLrc, info) {
    const id = String(videoId || "");
    const text = String(rawLrc || "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
    if (!id) return { ok: false, message: "再生中の曲IDを取得できませんでした。" };
    if (!text) return { ok: false, message: "LRC歌詞を入力してください。" };
    if (text.length > LOCAL_LYRICS_MAX_CHARS) return { ok: false, message: "LRCファイルが大きすぎます。" };
    const entry = {
      rawLrc: text,
      title: String((info && info.title) || ""),
      artist: String((info && info.artist) || ""),
      updatedAt: Date.now(),
    };
    const result = localLyricsResult(id, entry);
    if (!result) return { ok: false, message: "[00:14.32] のような時刻付き歌詞が見つかりません。" };

    try {
      STATE.localLyrics = await mutateStoredTrackMap(
        LOCAL_LYRICS_STORAGE_KEY,
        STATE.localLyrics,
        id,
        entry,
        LOCAL_LYRICS_MAX_TRACKS,
        (value) => typeof value.rawLrc === "string" && value.rawLrc.trim()
      );
      // Local candidate edits are cleared atomically by the storage worker.
      updateDiagnosticsSummary();
      return { ok: true, entry, result };
    } catch (_) {
      return { ok: false, message: "ローカル歌詞を保存できませんでした。空き容量を確認して、もう一度お試しください。" };
    }
  }

  async function deleteLocalLyricsEntry(videoId) {
    const id = String(videoId || "");
    if (!id) return { ok: false, message: "曲IDを取得できませんでした。" };
    try {
      const data = await sendUserDataMutation({ action: "deleteLocal", videoId: id });
      STATE.localLyrics = data[LOCAL_LYRICS_STORAGE_KEY];
      STATE.pinnedLyrics = data[PINNED_LYRICS_STORAGE_KEY];
      STATE.lyricsEdits = data[LYRICS_EDITS_STORAGE_KEY];
      deleteLyricsCacheForVideoId(id);
      updateDiagnosticsSummary();
      return { ok: true };
    } catch (error) {
      return { ok: false, message: "ローカル歌詞を削除できませんでした。" };
    }
  }

  function loadLocalLyrics() {
    try {
      chrome.storage.local.get({ [LOCAL_LYRICS_STORAGE_KEY]: {} }, (data) => {
        const stored = data && data[LOCAL_LYRICS_STORAGE_KEY];
        STATE.localLyrics = stored && typeof stored === "object" ? stored : {};
        STATE.localLyricsLoaded = true;
        tick();
      });
    } catch (_) {
      STATE.localLyricsLoaded = true;
    }
  }

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

  function saveManualSearchOverrides(videoId) {
    if (!videoId) return;
    return sendUserDataMutation({ action: "entry", key: MANUAL_SEARCH_STORAGE_KEY,
      videoId, entry: STATE.manualSearchOverrides[videoId] || null }).catch(reportSaveError);
  }

  function getLyricsEditEntry(videoId, candidateId) {
    const track = STATE.lyricsEdits && STATE.lyricsEdits[String(videoId || "")];
    const candidates = track && track.candidates;
    const entry = candidates && candidates[String(candidateId || "")];
    return entry && entry.replacements && typeof entry.replacements === "object" ? entry : null;
  }

  async function saveLyricsEditEntry(videoId, candidateId, replacements, info, source, originalLineCount) {
    const entry = replacements && Object.keys(replacements).length ? {
      replacements, originalLineCount,
      title: String(info?.title || ""), artist: String(info?.artist || ""),
      source: String(source || ""), updatedAt: Date.now(),
    } : null;
    const data = await sendUserDataMutation({ action: "edit", videoId, candidateId, entry });
    STATE.lyricsEdits = data[LYRICS_EDITS_STORAGE_KEY];
  }

  async function deleteLyricsEditEntry(videoId, candidateId) {
    const data = await sendUserDataMutation({ action: "edit", videoId, candidateId, entry: null });
    STATE.lyricsEdits = data[LYRICS_EDITS_STORAGE_KEY];
  }

  function applySavedLyricsEdits(result, info) {
    const candidateId = lyricCandidateIdentity(result);
    const videoId = String((info && info.videoId) || "");
    const entry = getLyricsEditEntry(videoId, candidateId);
    if (!entry || Number(entry.originalLineCount) !== result.lines.length) {
      return { result, candidateId, edited: false };
    }

    let changed = false;
    const lines = [];
    result.lines.forEach((line, index) => {
      if (!Object.prototype.hasOwnProperty.call(entry.replacements, index)) {
        lines.push(line);
        return;
      }
      const text = String(entry.replacements[index] ?? "");
      if (text === editableLineText(line).trim()) {
        lines.push(line);
        return;
      }
      changed = true;
      if (!text) return;
      lines.push({ ...line, text, words: [] });
    });
    if (!changed) return { result, candidateId, edited: false };
    return {
      result: { ...result, lines, _candidateId: candidateId, _lyricsEdited: true },
      candidateId,
      edited: true,
    };
  }

  function loadLyricsEdits() {
    try {
      chrome.storage.local.get({ [LYRICS_EDITS_STORAGE_KEY]: {} }, (data) => {
        const stored = data && data[LYRICS_EDITS_STORAGE_KEY];
        STATE.lyricsEdits = stored && typeof stored === "object" ? stored : {};
        STATE.lyricsEditsLoaded = true;
        const candidate = activeOriginalLyricsCandidate();
        const info = STATE.activeSearchInfo || STATE.activeBaseInfo;
        if (candidate && info && STATE.lastTrackKey) {
          applyLyricsResult(candidate.result, info, STATE.lastTrackKey, STATE.searchGeneration);
        }
        updateLyricsToolsUi();
      });
    } catch (_) {
      STATE.lyricsEditsLoaded = true;
    }
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
    const edited = applySavedLyricsEdits(result, info);
    const displayResult = edited.result;
    STATE.lines = displayResult.lines;
    STATE.syncLevel = displayResult.syncLevel || "none";
    STATE.hasSync = STATE.syncLevel !== "none" && STATE.lines.some((line) => line.time != null);
    STATE.hasLyricsResult = true;
    STATE.source = displayResult._source || "歌詞";
    STATE.activeProviderKey = displayResult._providerKey || "";
    STATE.activeCandidateId = edited.candidateId;
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
    const editSuffix = edited.edited ? "  •  歌詞編集済み" : "";
    setStatus(`${info.title} - ${info.artist}  •  ${sourceLabel(STATE.source, STATE.syncLevel)}${langSuffix}${manualSuffix}${editSuffix}`);
    ensureLyricsMount();
    // 新曲の最初の歌詞では必ず先頭から開始。旧曲のscrollTopを持ち越さない。
    renderLines({ resetScroll: firstResultForTrack });
    applySettings();
    updateLyricsToolsUi();
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
    STATE.activeProviderKey = "";
    STATE.lyricCandidates = [];
    STATE.activeCandidateId = "";
    STATE.manualSelectedCandidateId = "";
    STATE.lyricsAppliedAt = 0;
    STATE.displayedVideoId = "";
    STATE.currentIndex = -1;
    STATE.currentWordIndex = -1;
    STATE.isSearching = true;
    closeLyricsToolsPane();
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
