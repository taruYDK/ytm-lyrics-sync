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
