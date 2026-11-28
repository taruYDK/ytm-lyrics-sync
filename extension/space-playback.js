(() => {
  'use strict';
  let enabled = true, bridgeEnabled = true, currentId = '', snapshotAt = 0, held = false;
  let keyboardFocus = true;
  window.addEventListener('pointerdown', () => { keyboardFocus = false; document.documentElement.classList.add('ytmls-pointer-focus'); }, true);
  window.addEventListener('keydown', e => { if (e.key === 'Tab') { keyboardFocus = true; document.documentElement.classList.remove('ytmls-pointer-focus'); } }, true);
  chrome.storage.sync.get({enabled:true}, v => { enabled = v.enabled !== false; });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.enabled) enabled = changes.enabled.newValue !== false;
  });
  // Player snapshots and settings arrive over the private channel (bridge-channel.js).
  const bridge = globalThis.ytmlsBridge;
  if (!bridge) return;
  bridge.onSend(message => {
    if (message?.type === 'tracking-config') { bridgeEnabled = message.enabled === true; if (!bridgeEnabled) { currentId = ''; snapshotAt = 0; } }
  });
  bridge.listen(message => {
    if (message?.type !== 'snapshot') return;
    currentId = String(message.payload?.videoId || '');
    snapshotAt = performance.now();
  });
  function editable(event) {
    return event.composedPath().some(el => el instanceof Element && (el.isContentEditable || el.matches('input, textarea, select, [role="textbox"], [contenteditable]:not([contenteditable="false"])')));
  }
  window.addEventListener('keydown', e => {
    if (e.code !== 'Space' || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.isComposing || editable(e)) return;
    if (!enabled || !bridgeEnabled || !currentId || performance.now() - snapshotAt > 1500) return;
    const author = document.querySelector('#ytmls-tools-pane:not([hidden]) .ytmls-sync-current-line');
    if (author && author.getClientRects().length && getComputedStyle(author).visibility === 'visible') return;
    const path = e.composedPath();
    const lyricRow = path.some(el => el instanceof Element && el.matches('#ytmls-list .ytmls-line, #ytmls-fullscreen .ytmls-full-line'));
    if (!lyricRow && keyboardFocus && path.some(el => el instanceof Element && el.matches(':focus-visible') && el.matches('button, a[href], summary, [role="button"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="slider"], [role="switch"], [role="checkbox"], [role="tab"]'))) return;
    e.preventDefault(); e.stopImmediatePropagation(); held = true;
    if (!e.repeat) bridge.send({type:'toggle-playback', payload:{videoId:currentId}});
  }, true);
  window.addEventListener('keyup', e => {
    if (e.code !== 'Space' || !held) return;
    held = false; e.preventDefault(); e.stopImmediatePropagation();
  }, true);
  window.addEventListener('blur', () => { held = false; });
})();





