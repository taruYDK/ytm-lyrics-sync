(() => {
  'use strict';
  const nav=document.querySelector('.settings-nav');
  const links=[...nav.querySelectorAll('a[href^="#settings-"]')];
  const panels=links.map(link=>document.getElementById(link.hash.slice(1)));
  if(!links.length||panels.some(panel=>!panel))return;
  nav.setAttribute('role','tablist');nav.setAttribute('aria-orientation','vertical');
  links.forEach((link,i)=>{
    link.id='nav-'+panels[i].id;link.setAttribute('role','tab');link.setAttribute('aria-controls',panels[i].id);
    panels[i].setAttribute('role','tabpanel');panels[i].setAttribute('aria-labelledby',link.id);panels[i].tabIndex=0;
  });
  function show(index,focus=false){
    links.forEach((link,i)=>{link.setAttribute('aria-selected',String(i===index));link.tabIndex=i===index?0:-1;panels[i].hidden=i!==index;});
    document.querySelector('.settings-content').scrollTop=0;
    if(focus)links[index].focus();
  }
  links.forEach((link,i)=>{
    link.addEventListener('click',event=>{if(event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;event.preventDefault();show(i);});
    link.addEventListener('keydown',event=>{
      let next;if(event.key==='ArrowDown')next=(i+1)%links.length;else if(event.key==='ArrowUp')next=(i+links.length-1)%links.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=links.length-1;
      if(next!==undefined){event.preventDefault();show(next,true);}
    });
  });
  function fromHash(){const index=links.findIndex(link=>link.hash===location.hash);show(index<0?0:index);}
  window.addEventListener('hashchange',fromHash);fromHash();
})();
