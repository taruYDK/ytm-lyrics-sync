(() => {
  const range = document.getElementById('musicGlassIntensity');
  const label = document.getElementById('musicGlassIntensityValue');
  const reset = document.getElementById('musicGlassReset');
  const status = document.getElementById('musicGlassQuickStatus');
  const defaults = {musicGlassEnabled:true,musicGlassArtwork:true,musicGlassIntensity:65,musicGlassHideScrollbar:false,musicGlassLightweight:false};
  let saved = 65;
  function render(value) {
    const number = Number(value);
    saved = Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : 65;
    range.value = saved; label.textContent = `${saved}%`;
  }
  chrome.storage.local.get({musicGlassIntensity:65}, data => {
    if (chrome.runtime.lastError) {status.textContent = '設定を読み込めませんでした。開き直してください。';return;}
    render(data.musicGlassIntensity);range.disabled = false;reset.disabled = false;
  });
  range.addEventListener('input', () => {label.textContent = `${range.value}%`;});
  range.addEventListener('change', () => {
    const value = Number(range.value);range.disabled = true;reset.disabled = true;
    chrome.storage.local.set({musicGlassIntensity:value}, () => {
      range.disabled = false;reset.disabled = false;
      if (chrome.runtime.lastError) {render(saved);status.textContent = '保存できませんでした。再度お試しください。';return;}
      render(value);status.textContent = '';
    });
  });
  reset.addEventListener('click', () => {
    reset.disabled = true;range.disabled = true;
    chrome.storage.local.set(defaults, () => {
      reset.disabled = false;range.disabled = false;
      if (chrome.runtime.lastError) {status.textContent = 'リセットできませんでした。再度お試しください。';return;}
      render(65);
      document.getElementById('musicGlassQuickToggle').checked = true;
      const state = document.getElementById('musicGlassQuickState');state.textContent = 'ON';state.dataset.enabled = 'true';
      document.getElementById('musicGlassArtworkToggle').checked = true;
      document.getElementById('musicGlassScrollbarToggle').checked = false;
      status.textContent = '';
    });
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.musicGlassIntensity) render(changes.musicGlassIntensity.newValue ?? 65);
  });
})();
