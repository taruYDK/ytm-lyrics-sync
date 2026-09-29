(() => {
  const toggle = document.getElementById('musicGlassQuickToggle');
  const status = document.getElementById('musicGlassQuickStatus');
  const state = document.getElementById('musicGlassQuickState');
  const renderState = () => {
    state.textContent = toggle.checked ? 'ON' : 'OFF';
    state.dataset.enabled = String(toggle.checked);
  };
  let saved = true;
  toggle.disabled = true;
  chrome.storage.local.get({musicGlassEnabled:true}, data => {
    if (chrome.runtime.lastError) { status.textContent = '設定を読み込めませんでした。開き直してください。'; return; }
    saved = data.musicGlassEnabled !== false; toggle.checked = saved; renderState(); toggle.disabled = false;
  });
  toggle.addEventListener('change', () => {
    const value = toggle.checked; renderState(); toggle.disabled = true; status.textContent = '';
    chrome.storage.local.set({musicGlassEnabled:value}, () => {
      toggle.disabled = false;
      if (chrome.runtime.lastError) { toggle.checked = saved; renderState(); status.textContent = '保存できませんでした。もう一度お試しください。'; return; }
      saved = value; renderState();
    });
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.musicGlassEnabled) {
      saved = changes.musicGlassEnabled.newValue !== false; toggle.checked = saved; renderState();
    }
  });
})();

(() => {
  const input = document.getElementById('musicGlassScrollbarToggle');
  const status = document.getElementById('musicGlassQuickStatus');
  let saved = false;
  input.disabled = true;
  chrome.storage.local.get({musicGlassHideScrollbar:false}, data => {
    if (chrome.runtime.lastError) { status.textContent = '設定を読み込めませんでした。開き直してください。'; return; }
    saved = data.musicGlassHideScrollbar === true; input.checked = saved; input.disabled = false;
  });
  input.addEventListener('change', () => {
    const value = input.checked; input.disabled = true; status.textContent = '';
    chrome.storage.local.set({musicGlassHideScrollbar:value}, () => {
      input.disabled = false;
      if (chrome.runtime.lastError) { input.checked = saved; status.textContent = '保存できませんでした。もう一度お試しください。'; return; }
      saved = value;
    });
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.musicGlassHideScrollbar) {
      saved = changes.musicGlassHideScrollbar.newValue === true; input.checked = saved;
    }
  });
})();

(() => {
  const input = document.getElementById('musicGlassArtworkToggle');
  const status = document.getElementById('musicGlassQuickStatus');
  let saved = false;
  input.disabled = true;
  chrome.storage.local.get({musicGlassArtwork:true,musicGlassLightweight:false}, data => {
    if (chrome.runtime.lastError) { status.textContent = '設定を読み込めませんでした。開き直してください。'; return; }
    saved = data.musicGlassArtwork !== false && data.musicGlassLightweight !== true; input.checked = saved; input.disabled = false;
  });
  input.addEventListener('change', () => {
    const value = input.checked; input.disabled = true; status.textContent = '';
    chrome.storage.local.set({musicGlassArtwork:value,musicGlassLightweight:false}, () => {
      input.disabled = false;
      if (chrome.runtime.lastError) { input.checked = saved; status.textContent = '保存できませんでした。もう一度お試しください。'; return; }
      saved = value;
    });
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.musicGlassArtwork) {
      saved = changes.musicGlassArtwork.newValue !== false; input.checked = saved;
    }
  });
})();

(() => {
  const input = document.getElementById('musicGlassDislikeToggle');
  const status = document.getElementById('musicGlassQuickStatus');
  let saved = false;
  input.disabled = true;
  chrome.storage.local.get({musicGlassHideDislike:false}, data => {
    if (chrome.runtime.lastError) { status.textContent = '設定を読み込めませんでした。開き直してください。'; return; }
    saved = data.musicGlassHideDislike === true; input.checked = saved; input.disabled = false;
  });
  input.addEventListener('change', () => {
    const value = input.checked; input.disabled = true; status.textContent = '';
    chrome.storage.local.set({musicGlassHideDislike:value}, () => {
      input.disabled = false;
      if (chrome.runtime.lastError) { input.checked = saved; status.textContent = '保存できませんでした。もう一度お試しください。'; return; }
      saved = value;
    });
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.musicGlassHideDislike) {
      saved = changes.musicGlassHideDislike.newValue === true; input.checked = saved;
    }
  });
})();

