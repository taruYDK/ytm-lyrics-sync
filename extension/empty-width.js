(() => {
  'use strict';
  let scheduled = false, source = null, tabs = null, overlay = null, statusSource = null, statusOverlay = null;
  const resize = new ResizeObserver(schedule);
  function schedule() {
    if (!scheduled) { scheduled = true; requestAnimationFrame(update); }
  }
  function clear() {
    if (source) source.style.removeProperty('opacity');
    if (statusSource) statusSource.style.removeProperty('opacity');
    if (statusOverlay) statusOverlay.remove();
    statusSource = null; statusOverlay = null;
    if (overlay) overlay.remove();
    source = null; tabs = null; overlay = null; resize.disconnect();
  }
  function update() {
    scheduled = false;
    const next = document.querySelector('#ytmls-panel #ytmls-empty, #ytmls-panel #ytmls-searching');
    const nextTabs = document.querySelector('ytmusic-player-page tp-yt-paper-tabs') || document.querySelector('ytmusic-player-page [role=tablist]') || document.querySelector('ytmusic-player-page #tabs') || document.querySelector('ytmusic-player-page paper-tabs');
    if (!next || !nextTabs || !next.isConnected) { clear(); return; }
    if (source !== next || tabs !== nextTabs) {
      clear(); source = next; tabs = nextTabs;
      overlay = document.createElement('div');
      overlay.id = 'ytmls-empty-width-overlay';
      overlay.setAttribute('aria-hidden', 'true');
      document.body.appendChild(overlay);
      resize.observe(source); resize.observe(tabs);
    }
    const box = source.getBoundingClientRect(), tabBox = tabs.getBoundingClientRect();
    const layout = document.querySelector('ytmusic-app-layout');
    const pageOpen = !layout || layout.hasAttribute('player-page-open') || layout.hasAttribute('player-fullscreened');
    const visible = pageOpen && box.width > 0 && box.height > 0 && tabBox.width > 0 && getComputedStyle(source).visibility !== 'hidden' && getComputedStyle(tabs).visibility !== 'hidden';
    if (!visible) { overlay.style.display = 'none'; source.style.removeProperty('opacity'); if(statusOverlay) statusOverlay.style.display='none'; if(statusSource) statusSource.style.removeProperty('opacity'); return; }
    const sourceStyle = getComputedStyle(source);
    const searching = source.id === 'ytmls-searching';
    const main = source.querySelector(searching ? '.ytmls-searching-main' : '.ytmls-empty-main');
    const sub = source.querySelector(searching ? '.ytmls-searching-sub' : '.ytmls-empty-sub');
    if (!main || !sub) { overlay.style.display = 'none'; source.style.removeProperty('opacity'); return; }
    const key = main.textContent + '\n' + sub.textContent;
    if (overlay.dataset.text !== key) {
      overlay.replaceChildren(...Array.from(source.children, child => child.cloneNode(true)));
      overlay.dataset.text = key;
    }
    const mainStyle = getComputedStyle(main), subStyle = getComputedStyle(sub);
    Object.assign(overlay.style, {position:'fixed', boxSizing:'border-box', left:tabBox.left+'px', top:box.top+'px', width:tabBox.width+'px', height:box.height+'px', display:'flex', flexDirection:searching ? 'row' : 'column', alignItems:'center', justifyContent:'center', gap:sourceStyle.gap, padding:'32px', textAlign:searching ? 'left' : 'center', color:sourceStyle.color, pointerEvents:'none', zIndex:'99', fontFamily:sourceStyle.fontFamily, letterSpacing:sourceStyle.letterSpacing});
    Object.assign(overlay.querySelector(searching ? '.ytmls-searching-main' : '.ytmls-empty-main').style, {fontSize:mainStyle.fontSize,fontWeight:mainStyle.fontWeight,lineHeight:mainStyle.lineHeight,color:mainStyle.color,maxWidth:'100%',overflowWrap:'anywhere'});
    Object.assign(overlay.querySelector(searching ? '.ytmls-searching-sub' : '.ytmls-empty-sub').style, {fontSize:subStyle.fontSize,fontWeight:subStyle.fontWeight,lineHeight:subStyle.lineHeight,color:subStyle.color,maxWidth:'100%',overflowWrap:'anywhere'});
    source.style.opacity = '0';
    const status = document.querySelector('#ytmls-panel #ytmls-helpful .ytmls-fetch-status');
    if (status !== statusSource) {
      if (statusSource) statusSource.style.removeProperty('opacity');
      if (statusOverlay) statusOverlay.remove();
      statusSource = status; statusOverlay = null;
      if (status) {
        statusOverlay = document.createElement('div');
        statusOverlay.id = 'ytmls-empty-status-overlay';
        statusOverlay.setAttribute('aria-hidden', 'true');
        document.body.appendChild(statusOverlay);
      }
    }
    if (statusSource && statusOverlay) {
      const rect = statusSource.getBoundingClientRect();
      const style = getComputedStyle(statusSource);
      const text = statusSource.textContent;
      if (statusOverlay.textContent !== text) statusOverlay.textContent = text;
      const originalOpacity = style.opacity === '0' ? 0.8 : style.opacity;
      Object.assign(statusOverlay.style, {display:'block',position:'fixed',left:(tabBox.left+(innerWidth >= 1101 ? 0 : 24))+'px',top:rect.top+'px',maxWidth:Math.max(0, rect.right - tabBox.left - (innerWidth >= 1101 ? 0 : 24))+'px',fontFamily:style.fontFamily,fontSize:style.fontSize,fontWeight:style.fontWeight,lineHeight:style.lineHeight,letterSpacing:style.letterSpacing,color:style.color,opacity:originalOpacity,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',pointerEvents:'none',zIndex:'99'});
      statusSource.style.opacity = '0';
    }
  }
  // Page-wide playback and card changes must not trigger layout measurements.
  let watchedPanel = null;
  const panelObserver = new MutationObserver(records => {
    const interesting = node => node?.nodeType === 1 &&
      (node.matches?.('#ytmls-empty, #ytmls-searching, #ytmls-helpful') ||
       node.querySelector?.('#ytmls-empty, #ytmls-searching, #ytmls-helpful'));
    if (records.some(record => {
      const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
      return target?.closest?.('#ytmls-empty, #ytmls-searching, #ytmls-helpful') ||
        [...record.addedNodes, ...record.removedNodes].some(interesting);
    })) schedule();
  });
  function attachPanel() {
    const panel = document.querySelector('#ytmls-panel');
    if (panel === watchedPanel) return;
    panelObserver.disconnect();
    watchedPanel = panel;
    if (panel) panelObserver.observe(panel, {childList:true, subtree:true, characterData:true, attributes:true, attributeFilter:['hidden']});
    schedule();
  }
  const relevant = node => node.nodeType === 1 &&
    (node.matches?.('#ytmls-panel, ytmusic-player-page, tp-yt-paper-tabs, [role=tablist]') ||
     node.querySelector?.('#ytmls-panel, ytmusic-player-page, tp-yt-paper-tabs, [role=tablist]'));
  new MutationObserver(records => {
    if (records.some(record => record.type === 'attributes'
      ? record.attributeName !== 'hidden' || record.target.closest?.('ytmusic-player-page')
      : [...record.addedNodes, ...record.removedNodes].some(relevant))) {
      attachPanel();
      schedule();
    }
  }).observe(document.documentElement, {childList:true, subtree:true, attributes:true, attributeFilter:['player-page-open','player-fullscreened','hidden']});
  attachPanel();
  window.addEventListener('resize',schedule,{passive:true});
  window.addEventListener('scroll',schedule,{passive:true,capture:true});
  schedule();
})();






