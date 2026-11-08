(() => {
  'use strict';
  const settings = {
    musicGlassLightweight: { defaultValue: false, className: 'ytmls-lyrics-motion-lightweight', enabled: value => value === true },
    ytmlsDepthAnimationEnabled: { defaultValue: true, className: 'ytmls-depth-animation-disabled', enabled: value => value === false },
    ytmlsPlayerBarCustomEnabled: { defaultValue: true, className: 'ytmls-custom-playerbar', enabled: value => value !== false },
  };
  const revisions = Object.fromEntries(Object.keys(settings).map(key => [key, 0]));
  const apply = (key, value) => document.documentElement.classList.toggle(settings[key].className, settings[key].enabled(value));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    for (const key of Object.keys(settings)) if (changes[key]) {
      revisions[key]++;
      apply(key, changes[key].newValue);
    }
  });
  const initialRevisions = { ...revisions };
  const defaults = Object.fromEntries(Object.entries(settings).map(([key, value]) => [key, value.defaultValue]));
  chrome.storage.local.get(defaults, data => {
    if (chrome.runtime.lastError) return;
    for (const key of Object.keys(settings)) if (revisions[key] === initialRevisions[key]) apply(key, data[key]);
  });
})();
