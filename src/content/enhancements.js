// Convenience controls reuse the existing playback and settings paths.
function ensureEnhancementControls(){
 const menu=lyricsToolsEl?.querySelector('.ytmls-more-menu');if(!menu||!panelEl)return;
 const display = menu.querySelector('#ytmls-practice-controls');
 const playback = menu.querySelector('#ytmls-playback-menu');
 if (!display || !playback) return;
 if (!display.querySelector('.ytmls-size-presets')) {
  const sizes=document.createElement('div');sizes.className='ytmls-size-presets';sizes.setAttribute('aria-label','歌詞の文字サイズ');
  for(const [name,size] of [['小',26],['中',32],['大',40]]){const button=practiceButton(sizes,name,()=>{
   const id=practiceVideoId();if(!practiceCurrent(id)||!practiceLocalReady||!practiceSyncReady)return;
   button.dataset.saving='true';button.disabled=true;void queuePracticeSettingsSave(()=>savePracticeEntry(id,{...practiceEntry(id),settings:{...(practiceEntry(id).settings||{}),fontSize:size}})).catch(e=>{button.title='保存できませんでした：'+e.message;}).finally(()=>{delete button.dataset.saving;button.disabled=false;});
  });button.setAttribute('aria-label','文字サイズ '+name);button.dataset.size=String(size);}
  display.querySelector('.ytmls-menu-label').after(sizes);
  if(typeof attachGlassSegment==='function')attachGlassSegment(sizes);
  const mode=practiceButton(playback,'読むモード',()=>{chrome.storage.sync.set({trackingEnabled:!STATE.trackingEnabled},()=>{if(chrome.runtime.lastError)mode.title='設定を保存できませんでした';});});mode.id='ytmls-reading-mode';
  const timing=practiceButton(playback,'同期タイミングを調整',event=>{
   event.stopPropagation();
   const details=menu.closest('details');
   if(details)closeMoreMenu(details);
   toggleTrackTimingPopover(details?.querySelector('summary') || trackTimingButtonEl);
  });timing.id='ytmls-timing-shortcut';
 }
 const mode=playback.querySelector('#ytmls-reading-mode'),modeLabel=STATE.trackingEnabled?'読むモードに切り替え':'追跡モードに切り替え';if(mode.textContent!==modeLabel)mode.textContent=modeLabel;mode.removeAttribute('aria-pressed');
 const available=practiceCurrent(STATE.displayedVideoId)&&STATE.lines.length>0;
 display.querySelectorAll('.ytmls-size-presets button').forEach(b=>{if(!b.dataset.saving)b.disabled=!available||!practiceLocalReady||!practiceSyncReady;const current=String(Number(b.dataset.size)===Number(STATE.fontSize));if(b.getAttribute('aria-pressed')!==current)b.setAttribute('aria-pressed',current);});
 playback.querySelector('#ytmls-timing-shortcut').disabled=!STATE.hasSync||!trackTimingButtonEl?.isConnected||trackTimingButtonEl.disabled;
 const empty = panelEl.querySelector('#ytmls-empty');
 if (!empty) return;
 let emptyActions=empty.querySelector('#ytmls-empty-actions');
 if(!emptyActions){emptyActions=document.createElement('div');emptyActions.id='ytmls-empty-actions';
  practiceButton(emptyActions,'歌詞を追加',()=>renderLocalLyricsPane());practiceButton(emptyActions,'別の条件で探す',()=>renderManualSearchPane());empty.append(emptyActions);}
 emptyActions.hidden=Boolean(STATE.lines.length||STATE.isSearching||!STATE.enabled||!STATE.lastTrackKey);
 emptyActions.children[0].disabled = Boolean(localLyricsButtonEl?.disabled);
 emptyActions.children[1].disabled = Boolean(manualSearchButtonEl?.disabled);
}
