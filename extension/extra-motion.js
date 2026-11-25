(() => {
 'use strict';
 const root=document.documentElement;
 const allowed=()=>!root.classList.contains('ytmls-extra-motion-disabled')&&!root.classList.contains('ytmls-lyrics-motion-lightweight')&&!matchMedia('(prefers-reduced-motion: reduce)').matches;
 const initial=document.querySelector('ytmusic-player #song-image img');
 let lastCover=initial?.currentSrc||initial?.src||'';
 let coverOverlay = null;
 let coverTimer = 0;
 function finishCoverTransition() {
  clearTimeout(coverTimer);
  coverTimer = 0;
  const old = coverOverlay;
  if (!old) return;
  coverOverlay = null;
  if (!allowed()) { old.remove(); return; }
  old.animate([{opacity:1},{opacity:0}], {duration:260,easing:'ease-out'})
   .finished.then(() => old.remove(), () => old.remove());
 }
 document.addEventListener('ytmls-glass-artwork-painted', finishCoverTransition);
 // The player keeps its cover laid out while closed; only animate it when the player page is shown.
 function playerPageOpen() {
  const layout=document.querySelector('ytmusic-app-layout');
  return !layout || layout.hasAttribute('player-page-open') || layout.hasAttribute('player-fullscreened');
 }
 document.addEventListener('load',event=>{
  const img=event.target;if(!img?.matches?.('ytmusic-player #song-image img'))return;
  const next=img.currentSrc||img.src||'';if(!next||next===lastCover)return;
  const previous=lastCover;lastCover=next;
  if(!previous||!allowed()||!playerPageOpen())return;
  const r=img.getBoundingClientRect();if(!r.width||!r.height)return;
  const old=document.createElement('img');old.src=previous;old.className='ytmls-cover-old';old.setAttribute('aria-hidden','true');
  Object.assign(old.style,{position:'fixed',left:r.left+'px',top:r.top+'px',width:r.width+'px',height:r.height+'px',objectFit:'cover',borderRadius:getComputedStyle(img).borderRadius,pointerEvents:'none',zIndex:'98'});
  coverOverlay?.remove();
  clearTimeout(coverTimer);
  coverOverlay = old;
  document.body.append(old);
  if (document.getElementById('music-glass-backdrop')) {
   // Let the old cover stay visible until the matching glass frame is ready.
   coverTimer = setTimeout(finishCoverTransition, 450);
  } else finishCoverTransition();
 },true);
 let previousText='',watchedLabel=null, labelObserver;
 function watchLabel(){
  const label=document.querySelector('.ytmls-track-offset-label');if(!label||label===watchedLabel)return;
  labelObserver?.disconnect();watchedLabel=label;previousText=label.textContent;
  labelObserver=new MutationObserver(()=>{const text=label.textContent;if(text===previousText)return;previousText=text;if(allowed()&&label.animate)label.animate([{opacity:.6,transform:'translateY(3px)'},{opacity:1,transform:'none'}],{duration:180,easing:'ease-out'});});
  labelObserver.observe(label,{childList:true,subtree:true,characterData:true});
 }
 const hostObserver=new MutationObserver(watchLabel);
 function attachHost(){const bar=document.querySelector('ytmusic-player-bar');if(!bar)return;hostObserver.disconnect();hostObserver.observe(bar,{childList:true,subtree:true});watchLabel();}
 document.addEventListener('yt-navigate-finish',attachHost);attachHost();
 // In narrow windows the label moves into the lyrics menu, outside the observed player bar.
 setInterval(()=>{if(!document.hidden)watchLabel();},1000);
})();
