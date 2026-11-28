// Settings: switches saved in chrome.storage.local for the screen on YouTube Music
// (the Mac Music-style screen, and showing YouTube Music's comments).
(() => {
  const status = document.getElementById('musicGlassQuickStatus');
  const say = text => { if (status) status.textContent = text; };
  // invert: the switch shows the opposite of the saved value (コメント欄を表示 ⇔ hideYtmComments).
  function bind(id, key, invert = false) {
    const toggle = document.getElementById(id);
    if (!toggle) return;
    const shown = value => invert ? !value : value;
    let saved = true;
    toggle.disabled = true;
    chrome.storage.local.get({[key]: true}, data => {
      if (chrome.runtime.lastError) { say('設定を読み込めませんでした。開き直してください。'); return; }
      saved = data[key] !== false; toggle.checked = shown(saved); toggle.disabled = false;
    });
    toggle.addEventListener('change', () => {
      const value = shown(toggle.checked); toggle.disabled = true; say('');
      chrome.storage.local.set({[key]: value}, () => {
        toggle.disabled = false;
        if (chrome.runtime.lastError) { toggle.checked = shown(saved); say('保存できませんでした。もう一度お試しください。'); return; }
        saved = value;
      });
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes[key]) { saved = changes[key].newValue !== false; toggle.checked = shown(saved); }
    });
  }
  bind('appleShellToggle', 'appleShellEnabled');
  bind('appleAmbientToggle', 'appleAmbientEnabled');
  bind('appleSideAutohideToggle', 'appleSideAutohide');
  bind('appleAlbumButtonsToggle', 'appleAlbumButtons');
  bind('ytmCommentsToggle', 'hideYtmComments', true);
})();
