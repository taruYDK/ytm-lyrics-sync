// Per-track display and fullscreen controls. Original timed rows remain authoritative.
const PRACTICE_KEY = 'ytmlsTrackDisplayV280';
let practiceData = {}, practiceGlobal = {fontSize:32,readingJapanese:true,readingEnglish:true};
let practiceLocalReady=false, practiceSyncReady=false;
const practiceLoadErrors={}, practiceSettingsLoads={};
let practiceTrack = '', practiceExtrasGeneration = 0;
let practiceFullscreen = null, practiceFullSignature = '', practiceFullIndex = -1;
const practiceRomajiCache = new Map();
function practiceVideoId() { return String(getAuthoritativeVideoId() || ''); }
function practiceEntry(id=practiceVideoId()) { return practiceData[id] || {}; }
function practicePrefs() { return {...practiceGlobal,...(practiceEntry().settings||{})}; }
function practiceCurrent(id,lines=STATE.lines) { return Boolean(id && id===practiceVideoId() && id===STATE.displayedVideoId && lines===STATE.lines && STATE.enabled); }
async function savePracticeEntry(id,entry) {
 if(!id)throw Error('曲を読み込んでください');
 const data=await sendUserDataMutation({action:'entry',key:PRACTICE_KEY,videoId:id,entry:{title:STATE.lastDisplayedTitle||'',artist:STATE.lastDisplayedArtist||'',...entry,updatedAt:Date.now()}});
 practiceData=data[PRACTICE_KEY]||practiceData;
 if(id===practiceVideoId()) { applyPracticePrefs();void refreshPracticeExtras(); }
}
function applyPracticePrefs() {
 if(!practiceLocalReady||!practiceSyncReady)return;
 const id=practiceVideoId();if(!id)return;
 if(id!==practiceTrack){practiceTrack=id;practiceFullSignature='';}
 const prefs=practicePrefs();let changed=false,readingsChanged=false;
 for(const k of ['fontSize','readingJapanese','readingEnglish'])if(STATE[k]!==prefs[k]){changed=true;if(k!=='fontSize')readingsChanged=true;STATE[k]=prefs[k];}
 if(changed){applySettings();if(readingsChanged)void refreshLyricsReadings();}
}
function reportPracticeLoadError() {
 if(typeof lyricsToolsEl==='undefined'||!lyricsToolsEl)return;
 const message=Object.values(practiceLoadErrors).join(' ');
 let notice=lyricsToolsEl.querySelector('#ytmls-practice-load-status');
 if(!notice&&!message)return;
 if(!notice){notice=document.createElement('span');notice.id='ytmls-practice-load-status';notice.setAttribute('role','status');lyricsToolsEl.append(notice);}
 if(notice.textContent!==message)notice.textContent=message;
 notice.hidden=!message;
}
function loadPracticeSettings(area) {
 if(practiceSettingsLoads[area])return practiceSettingsLoads[area];
 const operation=new Promise(resolve=>{
  const attempt=(number)=>{
   const complete=(data,failure)=>{
    if(failure){
     practiceLoadErrors[area]=number<3?'曲別設定を読み込めませんでした。自動で再試行しています。':'曲別設定を読み込めませんでした。「この曲の表示設定」から再試行できます。';
     reportPracticeLoadError();
     if(number<3)setTimeout(()=>attempt(number+1),[500,1500,3000][number]);else resolve(false);
     return;
    }
    delete practiceLoadErrors[area];
    if(area==='local'){practiceData=data[PRACTICE_KEY]||{};practiceLocalReady=true;}
    else {practiceGlobal={fontSize:Number(data.fontSize)||32,readingJapanese:data.readingJapanese!==false,readingEnglish:data.readingEnglish!==false};practiceSyncReady=true;}
    reportPracticeLoadError();applyPracticePrefs();void refreshPracticeExtras();resolve(true);
   };
   try {chrome.storage[area].get(area==='local'?{[PRACTICE_KEY]:{}}:practiceGlobal,data=>{
    const failure=chrome.runtime.lastError;complete(data||{},failure);
   });}catch(error){complete({},error);}
  };
  attempt(0);
 });
 practiceSettingsLoads[area]=operation;
 void operation.then(()=>{delete practiceSettingsLoads[area];});
 return operation;
}
function initPracticeStorage() {
 document.addEventListener('fullscreenchange',()=>{if(practiceFullscreen?.dataset.native==='true'&&document.fullscreenElement!==practiceFullscreen)closePracticeFullscreen();});
 void loadPracticeSettings('local');void loadPracticeSettings('sync');
 chrome.storage.onChanged.addListener((changes,area)=>{
  if(area==='local'&&changes[PRACTICE_KEY]){practiceData=changes[PRACTICE_KEY].newValue||{};applyPracticePrefs();void refreshPracticeExtras();}
  if(area==='sync'){for(const k of Object.keys(practiceGlobal))if(changes[k])practiceGlobal[k]=changes[k].newValue??(k==='fontSize'?32:true);applyPracticePrefs();}
 });
}
function practicePane(title) {
 closeLyricsToolsPane();lyricsToolsPaneMode='practice';lyricsToolsPaneEl.replaceChildren();lyricsToolsPaneEl.hidden=false;
 const h=document.createElement('div');h.className='ytmls-tools-heading';h.textContent=title;lyricsToolsPaneEl.append(h);
 const body=document.createElement('div');body.className='ytmls-practice-form';lyricsToolsPaneEl.append(body);
 const status=document.createElement('p');status.className='ytmls-practice-status';status.setAttribute('role','status');body.append(status);
 const close=document.createElement('button');close.textContent='閉じる';close.className='ytmls-tool-button';close.addEventListener('click',closeLyricsToolsPane);lyricsToolsPaneEl.append(close);
 lyricsToolsPaneEl.scrollTop=0;
 requestAnimationFrame(()=>{if(lyricsToolsPaneMode==='practice')lyricsToolsPaneEl.scrollTop=0;});
 return {body,status,id:practiceVideoId(),lines:STATE.lines};
}
function practiceButton(body,label,fn) {const b=document.createElement('button');b.type='button';b.className='ytmls-tool-button';b.textContent=label;body.append(b);b.addEventListener('click',fn);return b;}
function practiceField(body,label,type,value) {
 const l=document.createElement('label');l.className='ytmls-practice-field';const t=document.createElement('span');t.textContent=label;const input=document.createElement(type==='textarea'?'textarea':'input');if(type!=='textarea')input.type=type;
 l.append(t);
 if(type==='checkbox'){
  input.checked=Boolean(value);input.setAttribute('role','switch');
  const control=document.createElement('span');control.className='ytmls-practice-switch';
  const visual=document.createElement('span');visual.className='ytmls-practice-switch-track';visual.setAttribute('aria-hidden','true');
  control.append(input,visual);l.append(control);
 }else{input.value=String(value??'');l.append(input);}
 body.append(l);return input;
}
function practiceGuard(pane) {if(!practiceCurrent(pane.id,pane.lines)){pane.status.textContent='曲が変わりました。開き直してください。';return false;}return true;}
let practiceSettingsSaveQueue=Promise.resolve();
function queuePracticeSettingsSave(operation) {
 const result=practiceSettingsSaveQueue.then(operation);
 practiceSettingsSaveQueue=result.catch(()=>{});
 return result;
}
function showTrackDisplay() {
 const p=practicePane('この曲の表示設定');const prefs=practicePrefs();
 if(!practiceLocalReady||!practiceSyncReady){
  p.status.textContent=Object.values(practiceLoadErrors).join(' ')||'曲別設定を読み込んでいます。';
  const retry=practiceButton(p.body,'設定の読み込みを再試行',async()=>{
   retry.disabled=true;p.status.textContent='設定を読み込んでいます…';
   await Promise.all([practiceLocalReady?true:loadPracticeSettings('local'),practiceSyncReady?true:loadPracticeSettings('sync')]);
   if(!p.body.isConnected||!practiceCurrent(p.id,p.lines))return;
   if(practiceLocalReady&&practiceSyncReady)showTrackDisplay();
   else {retry.disabled=false;p.status.textContent=Object.values(practiceLoadErrors).join(' ');}
  });
  return;
 }

 p.status.textContent='変更すると、この曲だけに自動保存されます。';
 const size=practiceField(p.body,'文字サイズ（10〜100px）','number',prefs.fontSize);size.min='10';size.max='100';
 const ja=practiceField(p.body,'日本語ふりがな','checkbox',prefs.readingJapanese),en=practiceField(p.body,'英語カタカナ読み','checkbox',prefs.readingEnglish);
 const ro=practiceField(p.body,'ローマ字を表示','checkbox',prefs.showRomaji);
 const metadata={title:STATE.lastDisplayedTitle||'',artist:STATE.lastDisplayedArtist||''};let revision=0;
 const report=(version,text)=>{if(version===revision&&p.body.isConnected&&practiceCurrent(p.id,p.lines))p.status.textContent=text;};
 const save=()=>{
  if(!practiceGuard(p))return;
  const fontSize=Number(size.value);if(!size.value||!Number.isFinite(fontSize)||fontSize<10||fontSize>100){p.status.textContent='文字サイズは10〜100です';return;}
  const version=++revision,settings={fontSize,readingJapanese:ja.checked,readingEnglish:en.checked,showRomaji:ro.checked};
  p.status.textContent='保存中…';
  void queuePracticeSettingsSave(()=>savePracticeEntry(p.id,{...practiceEntry(p.id),...metadata,settings})).then(()=>report(version,'自動保存しました'),e=>report(version,'保存できませんでした：'+e.message));
 };
 for(const input of [size,ja,en,ro])input.addEventListener('change',save);
 practiceButton(p.body,'共通設定に戻す',()=>{
  if(!practiceGuard(p))return;
  const version=++revision;p.status.textContent='保存中…';
  void queuePracticeSettingsSave(()=>{const entry={...practiceEntry(p.id),...metadata};delete entry.settings;return savePracticeEntry(p.id,entry);}).then(()=>{
   if(version!==revision||!p.body.isConnected||!practiceCurrent(p.id,p.lines))return;
   const restored=practicePrefs();size.value=String(restored.fontSize);ja.checked=restored.readingJapanese;en.checked=restored.readingEnglish;ro.checked=Boolean(restored.showRomaji);report(version,'共通の表示設定に戻しました');
  },e=>report(version,'保存できませんでした：'+e.message));
 });
}
function handlePracticeLineKey(event,id,lines,row) {
 if(!['Enter',' '].includes(event.key)||event.ctrlKey||event.metaKey||event.altKey||event.shiftKey)return;
 event.preventDefault();event.stopPropagation();
 if(event.repeat||!practiceCurrent(id,lines))return;
 if(event.key==='Enter')row.click();else requestPlayerToggle(id);
}
function handlePracticeFullscreenSpace(event) {
 const box=practiceFullscreen;
 if(!box||event.key!==' ')return;
 if(event.type==='keyup'){
  if(!box.spaceHandled)return;
  box.spaceHandled=false;event.preventDefault();event.stopImmediatePropagation();return;
 }
 if(event.ctrlKey||event.metaKey||event.altKey||event.shiftKey||event.isComposing)return;
 const target=event.target;
 if(target?.isContentEditable||target?.closest?.('input,textarea,select,[role="textbox"],.ytmls-full-close'))return;
 box.spaceHandled=true;event.preventDefault();event.stopImmediatePropagation();
 if(event.repeat||!STATE.enabled)return;
 const id=practiceVideoId();if(id)requestPlayerToggle(id);
}
function practiceSeek(index) {
 if(!practiceCurrent(STATE.displayedVideoId)||!listEl?.children[index])return;
 listEl.children[index].click();
}
async function refreshPracticeExtras() {
 const token=++practiceExtrasGeneration;const id=practiceVideoId(),lines=STATE.lines,list=listEl;if(!list||!practiceCurrent(id,lines))return;
 if(!practiceLocalReady||!practiceSyncReady)return;
 const prefs=practicePrefs();
 for(const row of list.children)for(const old of row.querySelectorAll('.ytmls-extra'))old.remove();
 let tokenizer=null;if(prefs.showRomaji){try{tokenizer=await getJapaneseReadingTokenizer();}catch(_){if(token===practiceExtrasGeneration&&practiceCurrent(id,lines))showLyricsReadingStatus('ローマ字辞書を読み込めませんでした。ページを再読み込みしてください。');}}
 for(let i=0;i<lines.length;i++){
  if(token!==practiceExtrasGeneration||!practiceCurrent(id,lines)||list!==listEl)return;
  const row=list.children[i],line=lines[i];if(!row)continue;
  const add=(kind,text)=>{if(!text)return;const el=document.createElement('span');el.className=`ytmls-extra ytmls-${kind}`;el.textContent=text;row.append(el);};
  if(prefs.showRomaji&&tokenizer&&/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(line.text||'')){
   try{let romaji=practiceRomajiCache.get(line.text);if(romaji===undefined){const tokens=await tokenizer.tokenize(line.text);romaji=readingTokensToRomaji(tokens);practiceRomajiCache.set(line.text,romaji);if(practiceRomajiCache.size>300)practiceRomajiCache.delete(practiceRomajiCache.keys().next().value);}if(token!==practiceExtrasGeneration||!practiceCurrent(id,lines))return;add('romaji',romaji);}catch(_){showLyricsReadingStatus('一部のローマ字を生成できませんでした');}
  }
 }
 practiceFullSignature='';scheduleTrackingRealignment();
}
function closePracticeFullscreen() {const current=practiceFullscreen;practiceFullscreen=null;if(current){document.removeEventListener('keydown',handlePracticeFullscreenSpace,true);document.removeEventListener('keyup',handlePracticeFullscreenSpace,true);clearTimeout(current.closeTimer);current.resizeObserver?.disconnect();}current?.remove();if(current?.returnFocus?.isConnected)current.returnFocus.focus();if(current&&document.fullscreenElement===current)void document.exitFullscreen().catch(()=>{});}
function paintPracticeBackground(box) {
 const canvas=box.querySelector('canvas'),ctx=canvas.getContext('2d');
 const glass=document.getElementById('music-glass-backdrop');
 if(glass?.tagName==='CANVAS'){ctx.clearRect(0,0,96,96);ctx.drawImage(glass,0,0,96,96);canvas.dataset.art='';return;}
 const image=document.querySelector('ytmusic-player-bar .thumbnail-image-wrapper img,ytmusic-player-bar img.image,ytmusic-player #song-image img');
 const art=image?.currentSrc||image?.src||'';
 if(!image?.complete||!image.naturalWidth||canvas.dataset.art===art)return;
 canvas.dataset.art=art;const side=Math.min(image.naturalWidth,image.naturalHeight);
 ctx.clearRect(0,0,96,96);ctx.filter='blur(5px) saturate(1.2) brightness(.55)';
 ctx.drawImage(image,(image.naturalWidth-side)/2,(image.naturalHeight-side)/2,side,side,-12,-12,120,120);ctx.filter='none';
}
function openPracticeFullscreen() {
 if(!STATE.enabled||!STATE.lines.length)return;closePracticeFullscreen();
 const box=document.createElement('div');box.id='ytmls-fullscreen';box.setAttribute('role','dialog');box.setAttribute('aria-label','全画面歌詞');box.setAttribute('aria-modal','true');
 const canvas=document.createElement('canvas');canvas.width=96;canvas.height=96;canvas.className='ytmls-full-backdrop';box.append(canvas);
 const corner=document.createElement('div');corner.className='ytmls-full-corner';box.append(corner);const close=practiceButton(corner,'全画面を閉じる',closePracticeFullscreen);close.className='ytmls-full-close';box.classList.add('ytmls-full-intro');box.closeTimer=setTimeout(()=>{if(practiceFullscreen===box)box.classList.remove('ytmls-full-intro');},3000);
 const title=document.createElement('h1');title.textContent=STATE.lastDisplayedTitle||'歌詞';box.append(title);const list=document.createElement('div');list.className='ytmls-full-list';box.append(list);
 box.returnFocus=document.activeElement;document.body.append(box);practiceFullscreen=box;document.addEventListener('keydown',handlePracticeFullscreenSpace,true);document.addEventListener('keyup',handlePracticeFullscreenSpace,true);practiceFullSignature='';practiceFullIndex=-1;refreshPracticeFullscreen();box.tabIndex=-1;box.focus();
 box.resizeObserver=new ResizeObserver(()=>{if(practiceFullscreen===box){box.pendingFollow=true;syncPracticeFullscreenTracking();}});box.resizeObserver.observe(list);
 const pause=()=>{box.manualUntil=performance.now()+(STATE.manualScrollReturnMs||3500);box.pendingFollow=true;};list.addEventListener('wheel',pause,{passive:true});list.addEventListener('touchmove',pause,{passive:true});list.addEventListener('keydown',e=>{if(['ArrowUp','ArrowDown','PageUp','PageDown','Home','End'].includes(e.key))pause();});
 box.addEventListener('keydown',e=>{if(e.key==='Escape'){e.stopPropagation();closePracticeFullscreen();}else if(e.key==='Tab'){const buttons=[...box.querySelectorAll('button')];const first=buttons[0],last=buttons.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}});

 if(box.requestFullscreen)void box.requestFullscreen().then(()=>{box.dataset.native='true';}).catch(()=>{});
}
function refreshPracticeFullscreen() {
 const box=practiceFullscreen;if(!box)return;if(!STATE.enabled){closePracticeFullscreen();return;}
 paintPracticeBackground(box);
 const sig=[STATE.displayedVideoId,STATE.activeCandidateId,practiceExtrasGeneration,STATE.lines.length].join(':');const list=box.querySelector('.ytmls-full-list');
 if(sig!==practiceFullSignature){practiceFullSignature=sig;practiceFullIndex=-1;box.querySelector('h1').textContent=STATE.lastDisplayedTitle||'歌詞';const restoreFocus=list.contains(document.activeElement);list.replaceChildren();if(restoreFocus)box.focus({preventScroll:true});const renderedId=STATE.displayedVideoId,renderedLines=STATE.lines;for(let i=0;i<STATE.lines.length;i++){const b=document.createElement('button');b.className='ytmls-full-line ytmls-line';b.append(...[...(listEl?.children[i]?.childNodes||[])].map(x=>x.cloneNode(true)));if(!b.childNodes.length)b.textContent=STATE.lines[i].text;b.addEventListener('keydown',e=>handlePracticeLineKey(e,renderedId,renderedLines,b));b.addEventListener('click',()=>{if(practiceCurrent(renderedId,renderedLines)){box.manualUntil=0;box.pendingFollow=true;practiceSeek(i);}});list.append(b);}}
 syncPracticeFullscreenTracking();
}
function syncPracticeFullscreenTracking() {
 const box=practiceFullscreen;if(!box)return;
 const list=box.querySelector('.ytmls-full-list');
 const tracking=STATE.trackingEnabled!==false&&practiceCurrent(STATE.displayedVideoId);
 box.dataset.wordTracking=tracking?(STATE.wordTrackingStyle||'smooth'):'off';box.dataset.trackingMode=tracking?'auto':'off';
 const index=tracking?STATE.currentIndex:-1,changed=index!==practiceFullIndex;
 box.dataset.focusFade=tracking&&index>=0&&STATE.focusFade!==false?'on':'off';
 if(changed){practiceFullIndex=index;for(let i=0;i<list.children.length;i++){list.children[i].classList.toggle('active',i===index);list.children[i].classList.toggle('ytmls-active',i===index);const distance=index>=0?Math.abs(i-index):999;list.children[i].classList.toggle('ytmls-near',distance===1);list.children[i].classList.toggle('ytmls-middle',distance===2);list.children[i].classList.toggle('ytmls-upcoming',index>=0&&i>index);}box.pendingFollow=true;}
 const row=list.children[index],original=listEl?.children[index];
 if(row&&original){
  const source=original.querySelectorAll('.ytmls-word'),target=row.querySelectorAll('.ytmls-word');
  source.forEach((word,i)=>{if(!target[i])return;if(target[i].className!==word.className)target[i].className=word.className;if(target[i].style.cssText!==word.style.cssText)target[i].style.cssText=word.style.cssText;});
 }
 if(tracking&&row&&box.pendingFollow&&performance.now()>=(box.manualUntil||0)){
  const rect=list.getBoundingClientRect(),lineRect=row.getBoundingClientRect();
  const top=Math.max(0,list.scrollTop+lineRect.top-rect.top+lineRect.height/2-list.clientHeight*(STATE.trackingPosition||42)/100);
  const smooth=changed&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  list.scrollTo({top,behavior:smooth?'smooth':'instant'});box.pendingFollow=false;
 }
}
function ensurePracticeControls() {
 const menu=lyricsToolsEl?.querySelector('.ytmls-more-menu');if(!menu)return;
 let group=menu.querySelector('#ytmls-practice-controls');
 if(!group){
  group=document.createElement('div');group.id='ytmls-practice-controls';
  group.setAttribute('role','group');group.setAttribute('aria-label','表示・便利機能');
  const label=document.createElement('div');label.className='ytmls-menu-label';label.textContent='表示・便利機能';group.append(label);
  menu.prepend(group);
  for(const [title,fn] of [['この曲の表示設定',showTrackDisplay],['全画面歌詞ビュー',openPracticeFullscreen]])practiceButton(group,title,()=>{const details=menu.closest('details');if(details)details.open=false;fn();});
 }
 const available=practiceCurrent(STATE.displayedVideoId)&&STATE.lines.length>0;
 for(const button of group.querySelectorAll('button'))button.disabled=!available;
}
function practiceTick() {
 reportPracticeLoadError();applyPracticePrefs();ensurePracticeControls();refreshPracticeFullscreen();
}
