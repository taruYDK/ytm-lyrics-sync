(() => {
  'use strict';
  const key = 'ytmlsPlayerBarCustomEnabled';
  const toggle = document.getElementById('playerBarCustomToggle');
  const state = document.getElementById('playerBarCustomState');
  const status = document.getElementById('playerBarCustomStatus');
  let saved = true;
  function render(enabled) {
    saved = enabled !== false;
    toggle.checked = saved;
    state.textContent = saved ? 'ON' : 'OFF';
  }
  chrome.storage.local.get({[key]:true}, data => {
    if (chrome.runtime.lastError) {
      state.textContent = '未読込';
      status.textContent = '設定を読み込めませんでした。設定画面を開き直してください。';
      return;
    }
    render(data[key]); toggle.disabled = false;
  });
  toggle.addEventListener('change', () => {
    const enabled = toggle.checked;
    toggle.disabled = true;
    chrome.storage.local.set({[key]:enabled}, () => {
      toggle.disabled = false;
      if (chrome.runtime.lastError) {
        render(saved);
        status.textContent = '保存できませんでした。もう一度お試しください。';
        return;
      }
      render(enabled);
      status.textContent = enabled ? '角丸と開閉位置の調整を有効にしました。' : '元の再生バーに戻しました。';
    });
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[key]) render(changes[key].newValue);
  });
})();
