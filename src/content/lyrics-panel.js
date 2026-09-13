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
    if (exportLyricsButtonEl) exportLyricsButtonEl.disabled = !STATE.hasSync || !STATE.lines.length || STATE.contextInvalidated;
    if (candidateButtonEl) {
      const count = STATE.lyricCandidates.length;
      candidateButtonEl.textContent = `歌詞候補 ${count}`;
      candidateButtonEl.disabled = count === 0;
      candidateButtonEl.title = count ? "取得した同期歌詞から選択" : "候補を検索中です";
    }
    if (editLyricsButtonEl) {
      editLyricsButtonEl.disabled = !STATE.hasLyricsResult || !Array.isArray(STATE.lines) || !STATE.lines.length;
      editLyricsButtonEl.title = editLyricsButtonEl.disabled
        ? "同期歌詞を表示すると編集できます"
        : "歌詞の文章をタイミングを変えずに編集";
    }
    if (localLyricsButtonEl) {
      const info = STATE.activeBaseInfo || STATE.activeSearchInfo;
      const videoId = String((info && info.videoId) || getAuthoritativeVideoId() || "");
      const ready = Boolean(videoId && STATE.lastTrackKey);
      localLyricsButtonEl.disabled = !ready;
      localLyricsButtonEl.title = ready ? "LRCの追加・読み込み・同期歌詞作成" : "曲の読み込みが完了すると使用できます";
    }
    if (lyricsToolsEl) lyricsToolsEl.hidden = !STATE.enabled;
    updateDiagnosticsSummary();
  }

  function closeLyricsToolsPane() {
    if (!lyricsToolsPaneEl) return;
    lyricsToolsPaneEl.hidden = true;
    lyricsToolsPaneEl.replaceChildren();
    lyricsToolsPaneMode = "";
    if (candidateButtonEl) candidateButtonEl.setAttribute("aria-pressed", "false");
    if (manualSearchButtonEl) manualSearchButtonEl.setAttribute("aria-pressed", "false");
    if (editLyricsButtonEl) editLyricsButtonEl.setAttribute("aria-pressed", "false");
    if (localLyricsButtonEl) localLyricsButtonEl.setAttribute("aria-pressed", "false");
  }

  function selectLyricsCandidate(candidateId) {
    const candidate = STATE.lyricCandidates.find((item) => item.id === candidateId);
    const info = STATE.activeSearchInfo || STATE.activeBaseInfo;
    if (!candidate || !info || !STATE.lastTrackKey) return;
    STATE.manualSelectedCandidateId = candidateId;
    STATE.activeCandidateId = candidateId;
    if (applyLyricsResult(candidate.result, info, STATE.lastTrackKey, STATE.searchGeneration)) {
      // ローカル歌詞は専用ストレージが正本。通常キャッシュへ複製すると、
      // 削除後にキャッシュから復活するため保存しない。
      if (candidate.result._providerKey !== "local") {
        const baseCacheKey = lyricsCacheKey(STATE.activeBaseInfo || info);
        const searchCacheKey = lyricsCacheKey(info);
        if (baseCacheKey) rememberLyricsInCache(baseCacheKey, candidate.result);
        if (searchCacheKey && searchCacheKey !== baseCacheKey) rememberLyricsInCache(searchCacheKey, candidate.result);
      }
    }
    closeLyricsToolsPane();
  }

  function renderCandidatePane() {
    if (candidateSaveBusy) return;
    if (!lyricsToolsPaneEl) return;
    if (!lyricsToolsPaneEl.hidden && lyricsToolsPaneMode === "candidates") {
      closeLyricsToolsPane();
      return;
    }
    lyricsToolsPaneMode = "candidates";
    if (candidateButtonEl) candidateButtonEl.setAttribute("aria-pressed", "true");
    if (manualSearchButtonEl) manualSearchButtonEl.setAttribute("aria-pressed", "false");
    if (editLyricsButtonEl) editLyricsButtonEl.setAttribute("aria-pressed", "false");
    if (localLyricsButtonEl) localLyricsButtonEl.setAttribute("aria-pressed", "false");
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

    const pinMessage = document.createElement("div");
    pinMessage.className = "ytmls-local-message";
    pinMessage.setAttribute("role", "status");
    lyricsToolsPaneEl.appendChild(pinMessage);

    const info = STATE.activeSearchInfo || STATE.activeBaseInfo;
    const videoId = String((info && info.videoId) || getAuthoritativeVideoId() || "");
    const pinned = getPinnedLyricsEntry(videoId);

    for (const candidate of STATE.lyricCandidates) {
      const result = candidate.result;
      const row = document.createElement("div");
      row.className = "ytmls-candidate-row";
      row.dataset.candidateId = candidate.id;
      if (pinned && pinned.candidateId === candidate.id) row.dataset.pinned = "true";

      const button = document.createElement("button");
      button.type = "button";
      button.className = "ytmls-candidate-item ytmls-candidate-select";
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

      const pinButton = document.createElement("button");
      pinButton.type = "button";
      pinButton.className = "ytmls-candidate-pin";
      const isPinned = Boolean(pinned && pinned.candidateId === candidate.id);
      pinButton.textContent = isPinned ? "📌 固定済み（解除）" : "📌 この歌詞を固定";
      pinButton.setAttribute("aria-label", isPinned ? `${result._source || "この歌詞"}の固定を解除` : `${result._source || "この歌詞"}をこの曲で固定`);
      pinButton.addEventListener("click", async () => {
        if (!videoId || candidateSaveBusy) return;
        candidateSaveBusy = true;
        const controls = Array.from(lyricsToolsPaneEl.querySelectorAll("button"));
        const disabledStates = controls.map(control => control.disabled);
        controls.forEach(control => { control.disabled = true; });
        try {
        if (isPinned) {
          const removed = await deletePinnedLyricsEntry(videoId);
          if (!removed.ok) {
            pinMessage.textContent = removed.message;
            pinMessage.dataset.error = "true";
            pinButton.disabled = false;
            return;
          }
          deleteLyricsCacheForVideoId(videoId);
          if (String(getAuthoritativeVideoId() || "") !== videoId) return;
          closeLyricsToolsPane();
          restartLyricsSearch("固定を解除し、歌詞候補を検索中…");
          return;
        }
        const saved = await savePinnedLyricsCandidate(videoId, candidate, info);
        if (!saved.ok) {
          pinMessage.textContent = saved.message;
          pinMessage.dataset.error = "true";
          pinButton.disabled = false;
          return;
        }
        if (String(getAuthoritativeVideoId() || "") === videoId) selectLyricsCandidate(candidate.id);
        } finally {
          candidateSaveBusy = false;
          controls.forEach((control, index) => { control.disabled = disabledStates[index]; });
        }
      });

      row.append(button, pinButton);
      lyricsToolsPaneEl.appendChild(row);
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
    if (editLyricsButtonEl) editLyricsButtonEl.setAttribute("aria-pressed", "false");
    if (localLyricsButtonEl) localLyricsButtonEl.setAttribute("aria-pressed", "false");
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
      saveManualSearchOverrides(videoId);
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
      saveManualSearchOverrides(videoId);
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



  function activeOriginalLyricsCandidate() {
    return STATE.lyricCandidates.find((candidate) => candidate.id === STATE.activeCandidateId) || null;
  }

  function renderLyricsEditPane() {
    if (!lyricsToolsPaneEl || !STATE.hasLyricsResult || !STATE.lines.length) return;
    if (!lyricsToolsPaneEl.hidden && lyricsToolsPaneMode === "edit") {
      closeLyricsToolsPane();
      return;
    }

    const candidate = activeOriginalLyricsCandidate();
    const info = STATE.activeSearchInfo || STATE.activeBaseInfo;
    const videoId = String((info && info.videoId) || getAuthoritativeVideoId() || "");
    if (!candidate || !info || !videoId || !STATE.lastTrackKey) return;

    lyricsToolsPaneMode = "edit";
    if (candidateButtonEl) candidateButtonEl.setAttribute("aria-pressed", "false");
    if (manualSearchButtonEl) manualSearchButtonEl.setAttribute("aria-pressed", "false");
    if (editLyricsButtonEl) editLyricsButtonEl.setAttribute("aria-pressed", "true");
    if (localLyricsButtonEl) localLyricsButtonEl.setAttribute("aria-pressed", "false");
    lyricsToolsPaneEl.replaceChildren();
    lyricsToolsPaneEl.hidden = false;

    const originalLines = candidate.result.lines || [];
    if (!originalLines.length) {
      closeLyricsToolsPane();
      return;
    }
    const savedEdit = getLyricsEditEntry(videoId, candidate.id);

    const heading = document.createElement("div");
    heading.className = "ytmls-tools-heading";
    heading.textContent = "歌詞を書き換え・削除";

    const note = document.createElement("div");
    note.className = "ytmls-edit-note";
    note.textContent = "1行が1つのタイミングです。不要な行は空欄にして保存すると表示から削除されます。改行の数は変えないでください。";

    const form = document.createElement("form");
    form.className = "ytmls-edit-form";

    const textarea = document.createElement("textarea");
    textarea.className = "ytmls-edit-textarea";
    textarea.value = originalLines.map((line, index) => {
      if (savedEdit && Object.prototype.hasOwnProperty.call(savedEdit.replacements, index)) {
        return String(savedEdit.replacements[index] ?? "");
      }
      return editableLineText(line).trim();
    }).join("\n");
    textarea.setAttribute("aria-label", "歌詞の文章");
    textarea.spellcheck = false;

    const message = document.createElement("div");
    message.className = "ytmls-edit-message";
    message.setAttribute("role", "status");

    const actions = document.createElement("div");
    actions.className = "ytmls-edit-actions";

    const save = document.createElement("button");
    save.type = "submit";
    save.className = "ytmls-tools-primary";
    save.textContent = "変更を保存";

    const deleteSelectedLines = document.createElement("button");
    deleteSelectedLines.type = "button";
    deleteSelectedLines.className = "ytmls-tools-secondary";
    deleteSelectedLines.textContent = "選択行を削除";
    deleteSelectedLines.title = "カーソルがある行、または選択範囲の行を空欄にします";
    deleteSelectedLines.addEventListener("click", () => {
      const value = textarea.value.replace(/\r/g, "");
      const lines = value.split("\n");
      const selectionStart = Math.max(0, Number(textarea.selectionStart) || 0);
      const selectionEnd = Math.max(selectionStart, Number(textarea.selectionEnd) || selectionStart);
      const startLine = value.slice(0, selectionStart).split("\n").length - 1;
      const adjustedEnd = selectionEnd > selectionStart && value[selectionEnd - 1] === "\n"
        ? selectionEnd - 1
        : selectionEnd;
      const endLine = value.slice(0, adjustedEnd).split("\n").length - 1;
      for (let index = startLine; index <= endLine && index < lines.length; index++) lines[index] = "";
      textarea.value = lines.join("\n");
      const caret = lines.slice(0, startLine).reduce((length, line) => length + line.length + 1, 0);
      textarea.focus();
      textarea.setSelectionRange(caret, caret);
      message.textContent = startLine === endLine
        ? `${startLine + 1}行目を削除対象にしました。「変更を保存」で確定します。`
        : `${startLine + 1}〜${endLine + 1}行目を削除対象にしました。「変更を保存」で確定します。`;
      delete message.dataset.error;
    });

    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "ytmls-tools-secondary";
    reset.textContent = "元の歌詞に戻す";
    reset.disabled = !getLyricsEditEntry(videoId, candidate.id);
    reset.addEventListener("click", async () => {
      if (!window.confirm("この歌詞候補に保存した書き換えを削除し、元の歌詞に戻しますか？")) return;
      reset.disabled = save.disabled = true;
      try {
        await deleteLyricsEditEntry(videoId, candidate.id);
        if (videoId !== getAuthoritativeVideoId()) return;
        applyLyricsResult(candidate.result, info, STATE.lastTrackKey, STATE.searchGeneration);
        closeLyricsToolsPane();
      } catch (error) { message.textContent = `保存できませんでした: ${error.message}`; }
      finally { reset.disabled = save.disabled = false; }
    });

    const close = document.createElement("button");
    close.type = "button";
    close.className = "ytmls-tools-secondary";
    close.textContent = "キャンセル";
    close.addEventListener("click", closeLyricsToolsPane);

    actions.append(save, deleteSelectedLines, reset, close);
    form.append(textarea, message, actions);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const editedTexts = textarea.value.replace(/\r/g, "").split("\n").map((line) => line.trim());
      if (editedTexts.length !== originalLines.length) {
        message.textContent = `行数が変わっています（元 ${originalLines.length}行 / 編集後 ${editedTexts.length}行）。不要な行の文字だけを空にし、改行は残してください。`;
        message.dataset.error = "true";
        return;
      }
      if (!editedTexts.some(Boolean)) {
        message.textContent = "歌詞をすべて空にはできません。";
        message.dataset.error = "true";
        return;
      }

      const replacements = {};
      originalLines.forEach((line, index) => {
        if (editedTexts[index] !== editableLineText(line).trim()) replacements[index] = editedTexts[index];
      });
      if (save.disabled) return;
      reset.disabled = save.disabled = true;
      try {
        await saveLyricsEditEntry(videoId, candidate.id, replacements, info, candidate.result._source || "", originalLines.length);
        if (videoId !== getAuthoritativeVideoId()) return;
        applyLyricsResult(candidate.result, info, STATE.lastTrackKey, STATE.searchGeneration);
        closeLyricsToolsPane();
      } catch (error) { message.textContent = `保存できませんでした: ${error.message}`; message.dataset.error = "true"; }
      finally { reset.disabled = save.disabled = false; }
    });

    lyricsToolsPaneEl.append(heading, note, form);
    requestAnimationFrame(() => textarea.focus());
  }



  // Solve playback + correction(playback) = lyric time on each linear segment.
  // Unlike iterative subtraction this also handles very steep correction changes.




  function renderLrcExportPane() {
    if (!lyricsToolsPaneEl || !STATE.hasSync || !STATE.lines.length) return;
    if (!lyricsToolsPaneEl.hidden && lyricsToolsPaneMode === "export") { closeLyricsToolsPane(); return; }
    closeLyricsToolsPane();
    lyricsToolsPaneMode = "export";
    lyricsToolsPaneEl.hidden = false;
    const content = document.createElement("div");
    content.className = "ytmls-export-content";
    const heading = document.createElement("div");
    heading.className = "ytmls-tools-heading";
    heading.textContent = "現在の歌詞をLRCで保存";
    const note = document.createElement("p");
    note.textContent = "保存済みの編集・行削除を反映し、行同期LRCとして出力します。補正を反映したLRCを再登録する場合、曲の補正を0に戻してください。";
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    label.append(checkbox, " 曲ごとのタイミング補正を反映する");
    const download = document.createElement("button");
    download.className = "ytmls-tools-primary";
    download.textContent = "LRCをダウンロード";
    const message = document.createElement("div");
    message.setAttribute("role", "status");
    download.addEventListener("click", () => {
      try {
        const videoId = getAuthoritativeVideoId();
        if (!STATE.hasSync || !videoId || videoId !== STATE.displayedVideoId) throw new Error("曲の歌詞が読み込まれるまでお待ちください。");
        const info = STATE.activeSearchInfo || STATE.activeBaseInfo || {};
        const lrc = buildExportLrc(STATE.lines, info, getTrackTimingPoints(videoId), getAuthoritativeDuration(getVideoElement()), checkbox.checked);
        const blob = new Blob([lrc], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = (String(info.title || videoId).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/[. ]+$/g, "").slice(0, 100) || "lyrics") + ".lrc";
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        message.textContent = "LRCを書き出しました。公開・共有する場合は歌詞の権利にご注意ください。";
      } catch (error) { message.textContent = error.message; }
    });
    const close = document.createElement("button");
    close.textContent = "閉じる";
    close.className = "ytmls-tools-close";
    close.addEventListener("click", closeLyricsToolsPane);
    content.append(heading, note, label, download, message, close);
    lyricsToolsPaneEl.appendChild(content);
  }

  function roundLrcSeconds(seconds) {
    return Math.max(0, Math.round((Number(seconds) || 0) * 100)) / 100;
  }

  function plainLyricsRows(value) {
    return String(value || "")
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/)
      .map((line) => line
        .replace(/^\s*(?:\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]\s*)+/, "")
        .trim())
      .filter((line) => line && !/^\[(?:ar|al|ti|by|offset|re|ve):/i.test(line));
  }

  function applyLocalLyricsNow(info, result) {
    if (!info || !result || !STATE.lastTrackKey) return false;
    // 保存の完了待ち中に別曲へ移った場合、その曲の検索世代や候補を変更しない。
    if (!info.videoId || String(getAuthoritativeVideoId() || "") !== String(info.videoId)) return false;
    // 進行中の外部検索を無効化し、完了時にローカル歌詞を上書き・消去させない。
    const generation = ++STATE.searchGeneration;
    STATE.lyricCandidates = STATE.lyricCandidates.filter((candidate) => candidate.id !== result._candidateId);
    upsertLyricsCandidate(result);
    STATE.manualSelectedCandidateId = result._candidateId;
    const applied = applyLyricsResult(result, info, STATE.lastTrackKey, generation);
    if (applied) STATE.isSearching = false;
    return applied;
  }

  function renderSyncLyricsAuthoring(info, rows) {
    if (!lyricsToolsPaneEl || !info || !info.videoId || !rows.length) return;
    const videoId = String(info.videoId);
    lyricsToolsPaneMode = "sync-author";
    lyricsToolsPaneEl.replaceChildren();
    lyricsToolsPaneEl.hidden = false;

    const heading = document.createElement("div");
    heading.className = "ytmls-tools-heading";
    heading.textContent = "♪ 同期歌詞作成モード";

    const note = document.createElement("div");
    note.className = "ytmls-edit-note";
    note.textContent = "曲を再生し、表示中の行を歌い始めた瞬間に「この行を記録して次へ」を押してください。補正前の再生時刻を記録します。";

    const progress = document.createElement("div");
    progress.className = "ytmls-sync-progress";

    const currentLine = document.createElement("div");
    currentLine.className = "ytmls-sync-current-line";

    const timeline = document.createElement("div");
    timeline.className = "ytmls-sync-timeline";

    const message = document.createElement("div");
    message.className = "ytmls-local-message";
    message.setAttribute("role", "status");

    const actions = document.createElement("div");
    actions.className = "ytmls-edit-actions";

    const record = document.createElement("button");
    record.type = "button";
    record.className = "ytmls-tools-primary";
    record.textContent = "この行を記録して次へ";

    const undo = document.createElement("button");
    undo.type = "button";
    undo.className = "ytmls-tools-secondary";
    undo.textContent = "1行戻す";

    const seekStart = document.createElement("button");
    seekStart.type = "button";
    seekStart.className = "ytmls-tools-secondary";
    seekStart.textContent = "曲の先頭へ";

    const restart = document.createElement("button");
    restart.type = "button";
    restart.className = "ytmls-tools-secondary";
    restart.textContent = "記録をやり直す";

    const save = document.createElement("button");
    save.type = "button";
    save.className = "ytmls-tools-primary";
    save.textContent = "同期歌詞を保存";

    const times = new Array(rows.length).fill(null);
    let nextIndex = 0;

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "ytmls-tools-secondary";
    cancel.textContent = "入力画面に戻る";
    cancel.addEventListener("click", () => {
      const draftText = rows.map((text, index) =>
        Number.isFinite(times[index]) ? `${formatLrcTimestamp(times[index])}${text}` : text
      ).join("\n");
      STATE.localLyricsDrafts[videoId] = draftText;
      renderLocalLyricsPane({ draftText });
    });

    const renderAuthorState = () => {
      const completed = nextIndex >= rows.length;
      progress.textContent = `${Math.min(nextIndex, rows.length)} / ${rows.length} 行を記録済み`;
      currentLine.dataset.index = String(Math.min(nextIndex, rows.length - 1));
      currentLine.textContent = completed ? "すべての行を記録しました。内容を保存できます。" : rows[nextIndex];
      // 行DOMは初回だけ作成し、記録・取り消し時は表示値だけ更新する。
      if (!timeline.children.length) rows.forEach((text, index) => {
        const row = document.createElement("div");
        row.className = "ytmls-sync-timeline-row";
        if (index === nextIndex && !completed) row.dataset.current = "true";
        const time = document.createElement("span");
        time.className = "ytmls-sync-recorded-time";
        time.textContent = Number.isFinite(times[index]) ? formatLrcTimestamp(times[index]) : "[--:--.--]";
        const lyric = document.createElement("span");
        lyric.textContent = text;
        row.append(time, lyric);
        timeline.appendChild(row);
      });
      Array.from(timeline.children).forEach((row, index) => {
        const active = index === nextIndex && !completed;
        if (active) row.dataset.current = "true";
        else delete row.dataset.current;
        const label = Number.isFinite(times[index]) ? formatLrcTimestamp(times[index]) : "[--:--.--]";
        if (row.firstChild.textContent !== label) row.firstChild.textContent = label;
      });
      record.disabled = completed;
      undo.disabled = nextIndex === 0;
      save.disabled = !completed;
    };

    record.addEventListener("click", () => {
      const currentVideoId = String(getAuthoritativeVideoId() || "");
      if (!currentVideoId || currentVideoId !== videoId) {
        message.textContent = "曲が切り替わったため記録を停止しました。元の曲に戻ってやり直してください。";
        message.dataset.error = "true";
        record.disabled = true;
        return;
      }
      const currentTime = getAuthoritativePlaybackTime(getVideoElement());
      if (!Number.isFinite(currentTime)) {
        message.textContent = "現在の再生時刻を取得できませんでした。";
        message.dataset.error = "true";
        return;
      }
      const roundedTime = roundLrcSeconds(currentTime);
      if (nextIndex > 0 && roundedTime <= times[nextIndex - 1]) {
        message.textContent = "前の行より前、または同じ時刻です。再生位置を進めてから記録してください。";
        message.dataset.error = "true";
        return;
      }
      times[nextIndex] = roundedTime;
      nextIndex += 1;
      message.textContent = nextIndex >= rows.length ? "全行を記録しました。「同期歌詞を保存」で確定してください。" : "";
      delete message.dataset.error;
      renderAuthorState();
    });

    undo.addEventListener("click", () => {
      if (nextIndex <= 0) return;
      nextIndex -= 1;
      times[nextIndex] = null;
      message.textContent = `${nextIndex + 1}行目を記録し直せます。`;
      delete message.dataset.error;
      renderAuthorState();
    });

    seekStart.addEventListener("click", () => {
      requestPlayerSeek(videoId, 0);
      message.textContent = "曲の先頭へ移動しました。再生して記録を始めてください。";
      delete message.dataset.error;
    });

    restart.addEventListener("click", () => {
      times.fill(null);
      nextIndex = 0;
      message.textContent = "記録を最初からやり直します。";
      delete message.dataset.error;
      renderAuthorState();
    });

    save.addEventListener("click", async () => {
      if (times.some((time) => !Number.isFinite(time))) return;
      if (String(getAuthoritativeVideoId() || "") !== videoId) {
        message.textContent = "曲が切り替わっているため保存できません。";
        message.dataset.error = "true";
        return;
      }
      const lrc = rows.map((text, index) => `${formatLrcTimestamp(times[index])}${text}`).join("\n");
      save.disabled = true;
      const stored = await saveLocalLyricsEntry(videoId, lrc, info);
      if (!stored.ok) {
        message.textContent = stored.message;
        message.dataset.error = "true";
        save.disabled = false;
        return;
      }
      delete STATE.localLyricsDrafts[videoId];
      if (applyLocalLyricsNow(info, stored.result) && save.isConnected) closeLyricsToolsPane();
    });

    actions.append(record, undo, seekStart, restart, save, cancel);
    lyricsToolsPaneEl.append(heading, note, progress, currentLine, timeline, message, actions);
    renderAuthorState();
  }

  function renderLocalLyricsPane(options = {}) {
    if (!lyricsToolsPaneEl) return;
    if (!lyricsToolsPaneEl.hidden && lyricsToolsPaneMode === "local") {
      closeLyricsToolsPane();
      return;
    }

    const info = STATE.activeBaseInfo || STATE.activeSearchInfo || getTrackInfo();
    const videoId = String((info && info.videoId) || getAuthoritativeVideoId() || "");
    if (!info || !videoId || !STATE.lastTrackKey) return;

    lyricsToolsPaneMode = "local";
    if (candidateButtonEl) candidateButtonEl.setAttribute("aria-pressed", "false");
    if (manualSearchButtonEl) manualSearchButtonEl.setAttribute("aria-pressed", "false");
    if (editLyricsButtonEl) editLyricsButtonEl.setAttribute("aria-pressed", "false");
    if (localLyricsButtonEl) localLyricsButtonEl.setAttribute("aria-pressed", "true");
    lyricsToolsPaneEl.replaceChildren();
    lyricsToolsPaneEl.hidden = false;

    const heading = document.createElement("div");
    heading.className = "ytmls-tools-heading";
    heading.textContent = "ローカル歌詞を追加";

    const note = document.createElement("div");
    note.className = "ytmls-edit-note";
    note.textContent = "[00:14.32]歌詞 の形式で貼り付けるか、.lrcファイルを読み込んでください。この曲だけに保存され、常に最優先で表示されます。";

    const textarea = document.createElement("textarea");
    textarea.className = "ytmls-local-lrc-textarea";
    textarea.setAttribute("aria-label", "ローカルLRC歌詞");
    textarea.placeholder = "[00:14.32]最初の歌詞\n[00:18.75]次の歌詞";
    textarea.spellcheck = false;
    const suppliedDraft = options && typeof options.draftText === "string" ? options.draftText : null;
    const hasRememberedDraft = Object.prototype.hasOwnProperty.call(STATE.localLyricsDrafts, videoId);
    textarea.value = suppliedDraft != null
      ? suppliedDraft
      : hasRememberedDraft
        ? STATE.localLyricsDrafts[videoId]
        : (getLocalLyricsEntry(videoId) || {}).rawLrc || "";
    textarea.addEventListener("input", () => {
      STATE.localLyricsDrafts[videoId] = textarea.value;
    });

    const fileRow = document.createElement("label");
    fileRow.className = "ytmls-local-file-row";
    const fileLabel = document.createElement("span");
    fileLabel.textContent = ".lrcファイルを読み込む";
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = ".lrc,text/plain";
    fileInput.className = "ytmls-local-lrc-file";
    fileRow.append(fileLabel, fileInput);

    const message = document.createElement("div");
    message.className = "ytmls-local-message";
    message.setAttribute("role", "status");

    fileInput.addEventListener("change", async () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      if (file.size > LOCAL_LYRICS_MAX_CHARS * 4) {
        message.textContent = "LRCファイルが大きすぎます。";
        message.dataset.error = "true";
        return;
      }
      try {
        textarea.value = (await file.text()).replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
        STATE.localLyricsDrafts[videoId] = textarea.value;
        message.textContent = `${file.name} を読み込みました。`;
        delete message.dataset.error;
      } catch (_) {
        message.textContent = "LRCファイルを読み込めませんでした。";
        message.dataset.error = "true";
      }
    });

    const actions = document.createElement("div");
    actions.className = "ytmls-edit-actions";

    const save = document.createElement("button");
    save.type = "button";
    save.className = "ytmls-tools-primary";
    save.textContent = "ローカル歌詞を保存";
    save.addEventListener("click", async () => {
      save.disabled = true;
      const stored = await saveLocalLyricsEntry(videoId, textarea.value, info);
      if (!stored.ok) {
        message.textContent = stored.message;
        message.dataset.error = "true";
        save.disabled = false;
        return;
      }
      delete STATE.localLyricsDrafts[videoId];
      if (applyLocalLyricsNow(info, stored.result) && save.isConnected) closeLyricsToolsPane();
    });

    const createSync = document.createElement("button");
    createSync.type = "button";
    createSync.className = "ytmls-tools-secondary ytmls-sync-create-button";
    createSync.textContent = "♪ 同期歌詞作成モード";
    createSync.addEventListener("click", () => {
      const rows = plainLyricsRows(textarea.value);
      if (!rows.length) {
        message.textContent = "同期を付ける歌詞を1行ずつ入力してください。";
        message.dataset.error = "true";
        return;
      }
      STATE.localLyricsDrafts[videoId] = textarea.value;
      renderSyncLyricsAuthoring(info, rows);
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "ytmls-tools-secondary";
    remove.textContent = "ローカル歌詞を削除";
    remove.disabled = !getLocalLyricsEntry(videoId);
    remove.addEventListener("click", async () => {
      if (!window.confirm("この曲に保存したローカル歌詞を本当に削除しますか？")) return;
      remove.disabled = true;
      const removed = await deleteLocalLyricsEntry(videoId);
      if (!removed.ok) {
        message.textContent = removed.message;
        message.dataset.error = "true";
        remove.disabled = false;
        return;
      }
      delete STATE.localLyricsDrafts[videoId];
      if (String(getAuthoritativeVideoId() || "") !== videoId || !remove.isConnected) return;
      closeLyricsToolsPane();
      restartLyricsSearch("ローカル歌詞を削除し、通常の歌詞を検索中…");
    });

    const close = document.createElement("button");
    close.type = "button";
    close.className = "ytmls-tools-secondary";
    close.textContent = "閉じる";
    close.addEventListener("click", closeLyricsToolsPane);

    actions.append(save, createSync, remove, close);
    lyricsToolsPaneEl.append(heading, note, textarea, fileRow, message, actions);
    requestAnimationFrame(() => textarea.focus());
  }

  function diagnosticSnapshot() {
    let version = "unknown";
    try {
      version = chrome.runtime.getManifest().version || version;
    } catch (_) {}
    const videoId = String(getAuthoritativeVideoId() || STATE.displayedVideoId || "");
    const player = getFreshPlayerSnapshot();
    return {
      version,
      health: lyricsHealthState(),
      videoId: videoId || "none",
      provider: STATE.source || "none",
      sync: STATE.syncLevel || "none",
      candidates: STATE.lyricCandidates.length,
      offsetPoints: videoId ? getTrackTimingPoints(videoId).length : 0,
      playerSource: String((player && player.timeSource) || (getVideoElement() ? "media" : "none")),
      pinned: Boolean(getPinnedLyricsEntry(videoId)),
      local: Boolean(getLocalLyricsEntry(videoId)),
    };
  }

  function diagnosticText(snapshot = diagnosticSnapshot()) {
    return [
      `Extension: ${snapshot.version}`,
      `State: ${snapshot.health.label}`,
      `Video ID: ${snapshot.videoId}`,
      `Provider: ${snapshot.provider}`,
      `Sync: ${snapshot.sync}`,
      `Candidates: ${snapshot.candidates}`,
      `Offset points: ${snapshot.offsetPoints}`,
      `Player source: ${snapshot.playerSource}`,
      `Pinned lyrics: ${snapshot.pinned ? "yes" : "no"}`,
      `Local lyrics: ${snapshot.local ? "yes" : "no"}`,
    ].join("\n");
  }

  function updateDiagnosticsSummary() {
    if (!diagnosticsSummaryEl) return;
    const snapshot = diagnosticSnapshot();
    const sync = syncLevelShortLabel(snapshot.sync);
    const summary = `状態：${snapshot.health.label}  •  曲ID：${snapshot.videoId}  •  歌詞：${snapshot.provider}  •  同期：${sync}  •  候補：${snapshot.candidates}件`;
    if (diagnosticsSummaryEl.textContent !== summary) diagnosticsSummaryEl.textContent = summary;
    diagnosticsSummaryEl.title = diagnosticText(snapshot);
  }

  async function copyDiagnostics() {
    const text = diagnosticText();
    let copied = false;
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
    } catch (_) {}
    if (!copied) {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      try { copied = document.execCommand("copy"); } catch (_) {}
      textarea.remove();
    }
    if (!diagnosticsCopyButtonEl) return;
    const original = "診断情報をコピー";
    diagnosticsCopyButtonEl.textContent = copied ? "コピーしました" : "コピーできませんでした";
    window.setTimeout(() => {
      if (diagnosticsCopyButtonEl) diagnosticsCopyButtonEl.textContent = original;
    }, 1800);
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

    editLyricsButtonEl = document.createElement("button");
    editLyricsButtonEl.type = "button";
    editLyricsButtonEl.className = "ytmls-tool-button";
    editLyricsButtonEl.textContent = "歌詞編集";
    editLyricsButtonEl.setAttribute("aria-pressed", "false");
    editLyricsButtonEl.addEventListener("click", renderLyricsEditPane);

    localLyricsButtonEl = document.createElement("button");
    localLyricsButtonEl.type = "button";
    localLyricsButtonEl.className = "ytmls-tool-button ytmls-local-lyrics-button";
    localLyricsButtonEl.textContent = "歌詞を追加";
    localLyricsButtonEl.setAttribute("aria-pressed", "false");
    localLyricsButtonEl.addEventListener("click", renderLocalLyricsPane);

    exportLyricsButtonEl = document.createElement("button");
    exportLyricsButtonEl.type = "button";
    exportLyricsButtonEl.className = "ytmls-tool-button";
    exportLyricsButtonEl.textContent = "LRC保存";
    exportLyricsButtonEl.addEventListener("click", renderLrcExportPane);
    const more = document.createElement("details");
    more.id = "ytmls-more";
    const moreToggle = document.createElement("summary");
    moreToggle.className = "ytmls-tool-button";
    moreToggle.textContent = "その他";
    const menu = document.createElement("div");
    menu.className = "ytmls-more-menu";
    menu.append(manualSearchButtonEl, editLyricsButtonEl, localLyricsButtonEl, exportLyricsButtonEl);
    more.append(moreToggle, menu);
    lyricsToolsEl.append(candidateButtonEl, more);
    for (const button of [candidateButtonEl, manualSearchButtonEl, editLyricsButtonEl, localLyricsButtonEl, exportLyricsButtonEl]) {
      button.addEventListener("click", () => { more.open = false; });
    }
    document.addEventListener("click", event => {
      if (more.open && !more.contains(event.target)) more.open = false;
    });
    more.addEventListener("keydown", event => {
      if (event.key === "Escape") { more.open = false; moreToggle.focus(); event.stopPropagation(); }
    });
    panelEl.appendChild(lyricsToolsEl);

    diagnosticsEl = document.createElement("div");
    diagnosticsEl.id = "ytmls-diagnostics";
    diagnosticsSummaryEl = document.createElement("span");
    diagnosticsSummaryEl.className = "ytmls-diagnostics-summary";
    diagnosticsCopyButtonEl = document.createElement("button");
    diagnosticsCopyButtonEl.type = "button";
    diagnosticsCopyButtonEl.className = "ytmls-diagnostics-button";
    diagnosticsCopyButtonEl.textContent = "診断情報をコピー";
    diagnosticsCopyButtonEl.addEventListener("click", copyDiagnostics);
    diagnosticsEl.append(diagnosticsSummaryEl, diagnosticsCopyButtonEl);
    const diagnosticDetails = document.createElement("details");
    diagnosticDetails.className = "ytmls-diagnostic-details";
    const diagnosticToggle = document.createElement("summary");
    diagnosticToggle.textContent = "診断情報";
    diagnosticDetails.append(diagnosticToggle, diagnosticsEl);
    menu.appendChild(diagnosticDetails);
    more.addEventListener("toggle", () => {
      if (!more.open) diagnosticDetails.open = false;
    });

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
      if (panelEl) { panelEl.style.display = "none"; panelEl.remove(); }
      lyricsWasVisible = false;
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
    const isVisible = isLyricsPanelActive() && renderer.getClientRects().length > 0 && getComputedStyle(renderer).display !== "none";
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

  function isLyricsPanelActive() {
    if (!lyricsRendererEl || !lyricsRendererEl.isConnected ||
        lyricsRendererEl.getAttribute("page-type") !== "MUSIC_PAGE_TYPE_TRACK_LYRICS" ||
        panelEl?.parentElement !== lyricsRendererEl) return false;
    const selected = getSelectedPlayerTab();
    if (!selected) return true; // Older layouts expose only the renderer's page-type.
    return isLyricsLabelText(tabLabel(selected));
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
    const shouldReplaceNative = STATE.enabled && isLyricsPanelActive();

    if (panelEl) panelEl.style.display = shouldReplaceNative ? "flex" : "none";
    if (!shouldReplaceNative) {
      const more = panelEl?.querySelector("#ytmls-more");
      if (more) more.open = false;
    }
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
    if (STATE.contextInvalidated) text = CONTEXT_RELOAD_MESSAGE;
    // すでに歌詞を表示できている間は、裏検索の進捗表示で見出しを上書きしない。
    if (STATE.hasLyricsResult && STATE.isSearching &&
        /(探し中|検索中|確認中|準備中|探索中)/.test(String(text || ""))) {
      return;
    }
    STATE.statusText = text;
    if (statusEl) statusEl.textContent = text;
    updatePlayerBarHealth();
    updateDiagnosticsSummary();
  }

  function sourceLabel(source, syncLevel) {
    if (syncLevel === "syllable") return `${source} • 音節追跡中`;
    if (syncLevel === "word") return `${source} • 単語追跡中`;
    if (syncLevel === "line") return `${source} • 行追跡中`;
    return `${source} • 同期なし`;
  }
