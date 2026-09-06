// Cross-origin fetch helper for Manifest V3.
// Provider-specific headers are isolated here to avoid CORS/preflight mistakes.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.url) return;
  if (message.type !== "YTMLS_FETCH" && message.type !== "YTMLS_FETCH_JSON") return;

  const allowedHosts = new Set([
    "lrclib.net",
    "www.lrclib.net",
    "karalyr.com",
    "www.karalyr.com",
    "lyrics-api.boidu.dev",
    "lyrics.api.dacubeking.com",
    "unison.boidu.dev",
    "lyrics-api.binimum.org",
    "lyrics-storage.binimum.org",
  ]);

  (async () => {
    let timeoutId = null;
    try {
      const url = new URL(message.url);
      if (url.protocol !== "https:" || !allowedHosts.has(url.hostname)) {
        sendResponse({ ok: false, status: 0, data: null, error: "blocked host" });
        return;
      }

      const controller = new AbortController();
      timeoutId = setTimeout(() => controller.abort(), Number(message.timeoutMs) || 25000);

      const method = String(message.method || "GET").toUpperCase();
      const headers = {
        "Accept": message.responseType === "text"
          ? "text/event-stream,text/plain,application/xml,text/xml,*/*"
          : "application/json,*/*"
      };

      // LRCLIB専用。別Providerには絶対に送らない。
      if (url.hostname === "lrclib.net" || url.hostname === "www.lrclib.net") {
        headers["Lrclib-Client"] = "YT-Music-Lyrics-Sync/2.0.0";
      }

      if (message.headers && typeof message.headers === "object") {
        for (const [key, value] of Object.entries(message.headers)) {
          if (typeof value === "string") headers[key] = value;
        }
      }

      const init = {
        method,
        headers,
        cache: "no-store",
        signal: controller.signal,
        credentials: message.credentials === "include" ? "include" : "omit",
      };
      if (method !== "GET" && method !== "HEAD" && message.body != null) {
        init.body = String(message.body);
      }

      const response = await fetch(url.toString(), init);
      const text = await response.text();
      let data = text;
      if (message.responseType !== "text") {
        try { data = text ? JSON.parse(text) : null; }
        catch (_) { data = null; }
      }

      sendResponse({
        ok: response.ok,
        status: response.status,
        data,
        retryAfter: response.headers.get("Retry-After"),
        contentType: response.headers.get("Content-Type") || "",
      });
    } catch (e) {
      sendResponse({ ok: false, status: 0, data: null, error: String(e) });
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  })();

  return true;
});
