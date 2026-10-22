const MAX_FETCH_RESPONSE_BYTES = 8 * 1024 * 1024;
async function readLimitedResponse(response, controller) {
  const tooLarge = async () => { controller.abort(); try { await response.body?.cancel(); } catch {} throw new Error('Response exceeds 8 MiB limit'); };
  const size = Number(response.headers.get('Content-Length'));
  if (Number.isFinite(size) && size > MAX_FETCH_RESPONSE_BYTES) return tooLarge();
  if (!response.body) return '';
  if (typeof response.body.getReader !== 'function') throw new Error('Streaming response unavailable');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let bytes = 0, text = '';
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_FETCH_RESPONSE_BYTES) { controller.abort(); await reader.cancel(); throw new Error('Response exceeds 8 MiB limit'); }
      text += decoder.decode(value, {stream:true});
    }
    return text + decoder.decode();
  } finally { reader.releaseLock(); }
}
importScripts('backup-validation.js', 'storage-broker.js', 'readings-service.js');
// Cross-origin fetch helper for Manifest V3.
// Provider-specific headers are isolated here to avoid CORS/preflight mistakes.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.url) return;
  if (message.type !== "YTMLS_FETCH" && message.type !== "YTMLS_FETCH_JSON") return;
  if (sender.id !== chrome.runtime.id) {
    sendResponse({ ok: false, status: 0, data: null, error: "blocked sender" });
    return;
  }

  const allowedHosts = new Set([
    "lrclib.net",
    "www.lrclib.net",
    "karalyr.com",
    "www.karalyr.com",
    "lyrics-api.boidu.dev",
    "lyrics.api.dacubeking.com",
    "unison.boidu.dev",
    "lrc.red",
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
      const requestedTimeout = Number(message.timeoutMs);
      const timeoutMs = Number.isFinite(requestedTimeout) && requestedTimeout > 0
        ? Math.max(1000, Math.min(60000, requestedTimeout)) : 25000;
      timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const method = String(message.method || "GET").toUpperCase();
      const headers = {
        "Accept": message.responseType === "text"
          ? "text/event-stream,text/plain,application/xml,text/xml,*/*"
          : "application/json,*/*"
      };

      // LRCLIB専用。別Providerには絶対に送らない。
      if (url.hostname === "lrclib.net" || url.hostname === "www.lrclib.net") {
        headers["Lrclib-Client"] = `YT-Music-Lyrics-Sync/${chrome.runtime.getManifest().version}`;
      }

      if (message.headers && typeof message.headers === "object") {
        for (const [key, value] of Object.entries(message.headers)) {
          // Only the two content types currently needed by our providers.
          // Never allow overrides of Accept, Lrclib-Client, Cookie or Authorization.
          if (key.toLowerCase() === "content-type" && typeof value === "string" &&
              !/[\r\n]/.test(value) &&
              /^(application\/json|application\/x-www-form-urlencoded)(;\s*charset=utf-8)?$/i.test(value)) {
            headers["Content-Type"] = value;
          }
        }
      }

      const init = {
        method,
        headers,
        cache: "no-store",
        signal: controller.signal,
        redirect: "error",
        credentials: url.hostname === "lyrics.api.dacubeking.com" && message.credentials === "include" ? "include" : "omit",
      };
      if (method !== "GET" && method !== "HEAD" && message.body != null) {
        init.body = String(message.body);
      }

      const response = await fetch(url.toString(), init);
      const text = await readLimitedResponse(response, controller);
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
