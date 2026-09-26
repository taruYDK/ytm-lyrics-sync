'use strict';
const defaults = { musicGlassEnabled: true, musicGlassArtwork: true, musicGlassIntensity: 65, musicGlassHideScrollbar: false, musicGlassLightweight: false };
function labels() {
  document.getElementById('musicGlassIntensity-value').textContent = `${document.getElementById('musicGlassIntensity').value}%`;
}
chrome.storage.local.get(defaults, settings => {
  if (settings.musicGlassLightweight) settings.musicGlassArtwork = false;
  for (const key of Object.keys(defaults).filter(key => key !== 'musicGlassLightweight')) {
    const input = document.getElementById(key);
    if (input.type === 'checkbox') input.checked = settings[key];
    else input.value = settings[key];
    input.addEventListener('input', labels);
    input.addEventListener('change', () => {
      const value = input.type === 'checkbox' ? input.checked : Number(input.value);
      chrome.storage.local.set(key === 'musicGlassArtwork' ? {musicGlassArtwork:value,musicGlassLightweight:false} : { [key]: value }, () => {
        document.getElementById('status').textContent = chrome.runtime.lastError ? '保存できませんでした。再度お試しください。' : '保存しました';
      });
      labels();
    });
  }
  labels();
  const reset = document.getElementById('reset');
  reset.addEventListener('click', () => {
    reset.disabled = true;
    chrome.storage.local.set({ ...defaults }, () => {
      reset.disabled = false;
      if (chrome.runtime.lastError) {
        document.getElementById('status').textContent = 'リセットできませんでした。再度お試しください。';
        return;
      }
      for (const key of Object.keys(defaults).filter(key => key !== 'musicGlassLightweight')) {
        const input = document.getElementById(key);
        if (input.type === 'checkbox') input.checked = defaults[key];
        else input.value = defaults[key];
      }
      labels();
      document.getElementById('status').textContent = '初期設定に戻しました';
    });
  });
});
