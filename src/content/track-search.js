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
    if (!STATE.manualSearchOverridesLoaded || !STATE.pinnedLyricsLoaded || !STATE.localLyricsLoaded) return;

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

    // ローカル歌詞と固定候補は、通常キャッシュやネット検索より常に優先する。
    // 歌詞データ一式を保存しているため、提供サイト側で後から取得できなくても再表示できる。
    const savedLocalResult = localLyricsResult(info.videoId);
    if (savedLocalResult) {
      upsertLyricsCandidate(savedLocalResult);
      if (applyLyricsResult(savedLocalResult, info, key, myGeneration)) {
        STATE.manualSelectedCandidateId = savedLocalResult._candidateId;
        STATE.isSearching = false;
        return;
      }
    }

    const pinnedEntry = getPinnedLyricsEntry(info.videoId);
    if (pinnedEntry) {
      const pinnedResult = pinnedEntry.result;
      pinnedResult._candidateId = pinnedEntry.candidateId || pinnedResult._candidateId || lyricCandidateIdentity(pinnedResult);
      upsertLyricsCandidate(pinnedResult);
      if (applyLyricsResult(pinnedResult, info, key, myGeneration)) {
        STATE.manualSelectedCandidateId = pinnedResult._candidateId;
        STATE.isSearching = false;
        return;
      }
    }

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
        // Preserve the usable result even if a slower provider is still searching.
        if (cacheKey) rememberLyricsInCache(cacheKey, best.result);
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
      { key: "youtubeMusic", run: () => fetchFromYouTubeMusic(info, duration, key) },
      { key: "betterLyrics", run: () => fetchFromBetterLyricsV2(info, duration, key) },
      { key: "betterLyrics", run: () => fetchFromBetterLyricsJson(info, duration, key) },
      { key: "betterLyrics", run: () => fetchFromBetterLyrics(info, duration, key) },
      { key: "betterLyrics", run: () => fetchFromBoiduProvider(info, duration, key, "qq") },
      { key: "betterLyrics", run: () => fetchFromBoiduProvider(info, duration, key, "kugou") },
      { key: "lrclib", run: () => fetchFromLrclib(info, duration, key) },
      { key: "lrclib", run: () => fetchFromLrclibQuick(info, duration, key) },
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
