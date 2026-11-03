(() => {
  'use strict';
  const root=document.documentElement;
  let layout,active=false,discovery,lastTouch;
  const state=new MutationObserver(sync);
  function sync() {
    active=Boolean(layout?.isConnected&&root.classList.contains('music-glass')&&root.classList.contains('ytmls-custom-playerbar')&&layout.hasAttribute('player-page-open')&&!layout.hasAttribute('player-fullscreened')&&!layout.hasAttribute('is-mweb-modernization-enabled'));
    if(root.classList.contains('ytmls-depth-open')!==active)root.classList.toggle('ytmls-depth-open',active);
  }
  function connect() {
    const next=document.querySelector('ytmusic-app-layout');
    if(next!==layout){state.disconnect();layout=next;if(layout)state.observe(layout,{attributes:true,attributeFilter:['player-page-open','player-fullscreened','is-mweb-modernization-enabled']});}
    sync();if(layout)discovery?.disconnect();
  }
  function canScroll(event) {
    const path=event.composedPath();
    const page=layout?.querySelector('ytmusic-player-page[slot="player-page"]');
    return Boolean(page&&path.includes(page))||path.some(n=>n instanceof Element&&n.matches('ytmusic-popup-container,tp-yt-paper-dialog,[role="dialog"],[role="listbox"],#ytmls-external-view #ytmls-list,#ytmls-external-view #ytmls-tools-pane'));
  }
  // Preserve browser zoom and native nested lyrics/queue scrolling. At an edge,
  // cancel only the default scroll; native controls still receive their events.
  window.addEventListener('wheel',event=>{
    if(!active||event.ctrlKey||event.metaKey||!event.cancelable)return;
    if(!canScroll(event,event.deltaX,event.deltaY))event.preventDefault();
  },{capture:true,passive:false});
  window.addEventListener('touchstart',event=>{lastTouch=event.touches.length===1?{x:event.touches[0].clientX,y:event.touches[0].clientY}:null;},{passive:true});
  window.addEventListener('touchmove',event=>{
    if(!active||!lastTouch||event.touches.length!==1)return;
    const touch=event.touches[0],dx=lastTouch.x-touch.clientX,dy=lastTouch.y-touch.clientY;
    lastTouch={x:touch.clientX,y:touch.clientY};
    if(event.cancelable&&!canScroll(event,dx,dy))event.preventDefault();
  },{capture:true,passive:false});
  new MutationObserver(sync).observe(root,{attributes:true,attributeFilter:['class']});
  document.addEventListener('yt-navigate-finish',connect);
  connect();
  if(!layout){discovery=new MutationObserver(connect);discovery.observe(document,{childList:true,subtree:true});}
})();
