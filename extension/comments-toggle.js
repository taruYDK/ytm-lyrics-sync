// Hide YouTube Music's comments on the Now Playing page (setting, on by default).
// Two shapes are handled without relying on one exact structure:
//  - a "コメント / Comments" tab beside the lyrics tab: the tab is hidden (and left if it was open);
//  - a comments panel: the outermost element in the Now Playing page whose tag or id says "comment".
(() => {
  'use strict';
  const TAB_HIDDEN = 'ytmls-tab-hidden';
  const PANEL_HIDDEN = 'ytmls-comments-hidden';
  let loaded = false;
  let hide = true;

  const isCommentsLabel = text => /^(?:コメント|comments?)(?:[\s\d.,万千kKmM件]*)$/i.test(String(text || '').replace(/\s+/g, ' ').trim());
  const looksLikeComments = el => /comment/i.test(el.localName) || /comment/i.test(el.id || '');

  function tabs() {
    return [...document.querySelectorAll('ytmusic-player-page tp-yt-paper-tab')];
  }

  function applyTabs() {
    const list = tabs();
    for (const tab of list) tab.classList.toggle(TAB_HIDDEN, hide && isCommentsLabel(tab.textContent));
    const open = list.find(tab => tab.classList.contains(TAB_HIDDEN) && tab.getAttribute('aria-selected') === 'true');
    if (open) {
      const next = list.find(tab => /歌詞|lyrics/i.test(tab.textContent) && !tab.hasAttribute('disabled')) ||
        list.find(tab => !tab.classList.contains(TAB_HIDDEN) && !tab.hasAttribute('disabled'));
      next?.click();
    }
  }

  function applyPanels() {
    const page = document.querySelector('ytmusic-player-page');
    document.querySelectorAll(`.${PANEL_HIDDEN}`).forEach(el => { if (!hide || !page?.contains(el)) el.classList.remove(PANEL_HIDDEN); });
    if (!hide || !page) return;
    const walker = document.createTreeWalker(page, NodeFilter.SHOW_ELEMENT, {
      acceptNode: el => {
        if (el.id === 'ytmls-panel' || el.localName === 'tp-yt-paper-tabs') return NodeFilter.FILTER_REJECT;
        return looksLikeComments(el) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      },
    });
    for (let el = walker.nextNode(); el; el = walker.nextNode()) {
      // Keep only the outermost match; its children go with it.
      if (!el.parentElement?.closest(`.${PANEL_HIDDEN}`)) el.classList.add(PANEL_HIDDEN);
    }
  }

  function apply() {
    if (!loaded || document.hidden) return;
    applyTabs();
    applyPanels();
  }

  chrome.storage.local.get({hideYtmComments: true}, data => { hide = data.hideYtmComments !== false; loaded = true; apply(); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.hideYtmComments) { hide = changes.hideYtmComments.newValue !== false; apply(); }
  });
  setInterval(apply, 800);
  document.addEventListener('visibilitychange', apply);
})();
