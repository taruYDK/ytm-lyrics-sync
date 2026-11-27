// Settings: switch the Mac Music-style screen on YouTube Music on or off.
(() => {
  const toggle = document.getElementById('appleShellToggle');
  const status = document.getElementById('musicGlassQuickStatus');
  if (!toggle) return;
  let saved = true;
  toggle.disabled = true;
  chrome.storage.local.get({appleShellEnabled: true}, data => {
    if (chrome.runtime.lastError) { if (status) status.textContent = '設定を読み込めませんでした。開き直してください。'; return; }
    saved = data.appleShellEnabled !== false; toggle.checked = saved; toggle.disabled = false;
  });
  toggle.addEventListener('change', () => {
    const value = toggle.checked; toggle.disabled = true; if (status) status.textContent = '';
    chrome.storage.local.set({appleShellEnabled: value}, () => {
      toggle.disabled = false;
      if (chrome.runtime.lastError) { toggle.checked = saved; if (status) status.textContent = '保存できませんでした。もう一度お試しください。'; return; }
      saved = value;
    });
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.appleShellEnabled) { saved = changes.appleShellEnabled.newValue !== false; toggle.checked = saved; }
  });
})();
