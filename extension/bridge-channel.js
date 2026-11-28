// Private channel between the extension's content scripts and the player bridge (MAIN world).
// window.postMessage could be read and forged by any script on the page, so instead both sides
// trade a random key before the page's own scripts run (document_start) and talk through
// events whose names contain that key. The page never learns it.
//   ytmlsBridge.send(message)  → to the player bridge (also seen by onSend listeners here)
//   ytmlsBridge.listen(fn)     ← messages from the player bridge (snapshots)
(() => {
  'use strict';
  if (globalThis.ytmlsBridge) return;
  const ATTR = 'data-ytmls-bridge-key';
  const root = document.documentElement;
  // Whichever side runs second takes the key the first one left and removes it.
  let key = root.getAttribute(ATTR);
  if (key) root.removeAttribute(ATTR);
  else { key = crypto.randomUUID(); root.setAttribute(ATTR, key); }
  const incoming = new Set(), outgoing = new Set();
  document.addEventListener(`ytmls-bridge-out-${key}`, event => {
    let message;
    try { message = JSON.parse(event.detail); } catch (_) { return; }
    if (!message || typeof message !== 'object') return;
    for (const fn of incoming) { try { fn(message); } catch (_) {} }
  });
  globalThis.ytmlsBridge = Object.freeze({
    send(message) {
      document.dispatchEvent(new CustomEvent(`ytmls-bridge-in-${key}`, {detail: JSON.stringify(message)}));
      for (const fn of outgoing) { try { fn(message); } catch (_) {} }
    },
    listen(fn) { incoming.add(fn); return () => incoming.delete(fn); },
    onSend(fn) { outgoing.add(fn); return () => outgoing.delete(fn); },
  });
})();
