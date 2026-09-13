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

      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (!areaName || areaName === "local") {
          for (const [key, field] of [
            [TRACK_TIMING_OFFSETS_STORAGE_KEY, "trackTimingOffsets"],
            [LYRICS_EDITS_STORAGE_KEY, "lyricsEdits"],
            [MANUAL_SEARCH_STORAGE_KEY, "manualSearchOverrides"],
          ]) {
            if (changes[key]) STATE[field] = changes[key].newValue || {};
          }
          if (changes[PINNED_LYRICS_STORAGE_KEY]) {
            const value = changes[PINNED_LYRICS_STORAGE_KEY].newValue;
            STATE.pinnedLyrics = value && typeof value === "object" ? value : {};
            STATE.pinnedLyricsLoaded = true;
          }
          if (changes[LOCAL_LYRICS_STORAGE_KEY]) {
            const value = changes[LOCAL_LYRICS_STORAGE_KEY].newValue;
            STATE.localLyrics = value && typeof value === "object" ? value : {};
            STATE.localLyricsLoaded = true;
          }
          if (changes[PINNED_LYRICS_STORAGE_KEY] || changes[LOCAL_LYRICS_STORAGE_KEY]) {
            updateLyricsToolsUi();
          }
        }

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
