  // ---------- バックグラウンド経由HTTP ----------
  const CONTEXT_RELOAD_MESSAGE = "拡張機能が更新または再読み込みされました。YouTube Musicのページを再読み込みしてください。";
  function runtimeAvailable(error = null) {
    if (STATE.contextInvalidated) return false;
    let available = false;
    try { available = Boolean(chrome.runtime.id); } catch (_) {}
    if (available && !/extension context invalidated/i.test(String(error?.message || error || "")) && !STATE.contextInvalidated) return true;
    if (!STATE.contextInvalidated) {
      STATE.contextInvalidated = true;
      STATE.searchGeneration += 1;
      STATE.isSearching = false;
      const banner = document.createElement("div");
      banner.id = "ytmls-reload-notice";
      banner.setAttribute("role", "alert");
      const label = document.createElement("span");
      label.textContent = CONTEXT_RELOAD_MESSAGE;
      const button = document.createElement("button");
      button.textContent = "ページを再読み込み";
      button.addEventListener("click", () => location.reload());
      banner.append(label, button);
      document.body.appendChild(banner);
    }
    setStatus(CONTEXT_RELOAD_MESSAGE);
    return false;
  }

  async function sendUserDataMutation(payload) {
    if (!runtimeAvailable()) throw new Error(CONTEXT_RELOAD_MESSAGE);
    try {
      const response = await chrome.runtime.sendMessage({ type: "YTMLS_USER_DATA", captureUndo: true, ...payload });
      if (!response?.ok) throw new Error(response?.error || "保存できませんでした。");
      if (response.undoToken && typeof showUserUndo === "function") showUserUndo(response.undoToken, payload.videoId);
      return response.data;
    } catch (error) {
      runtimeAvailable(error);
      throw error;
    }
  }

  function reportSaveError(error) {
    setStatus(STATE.contextInvalidated ? CONTEXT_RELOAD_MESSAGE : `保存に失敗しました: ${error.message}`);
  }

  async function fetchRemote(url, responseType = "json", options = {}) {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (!runtimeAvailable()) return { ok: false, status: 0, data: null, contextInvalidated: true };
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
      } catch (error) {
        if (!runtimeAvailable(error)) return { ok: false, status: 0, data: null, contextInvalidated: true };
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
