(() => {
  'use strict';
  const key = 'ytmlsPlayerBarCustomEnabled';
  const render = enabled => document.documentElement.classList.toggle('ytmls-custom-playerbar', enabled !== false);
  chrome.storage.local.get({[key]:true}, data => {
    if (!chrome.runtime.lastError) render(data[key]);
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[key]) render(changes[key].newValue);
  });
})();
