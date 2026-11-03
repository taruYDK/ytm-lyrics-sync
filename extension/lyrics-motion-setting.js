(() => {
  const key='musicGlassLightweight'; let rev=0;
  const apply=value=>document.documentElement.classList.toggle('ytmls-lyrics-motion-lightweight',value === true);
  chrome.storage.onChanged.addListener((c,a)=>{if(a==='local'&&c[key]){rev++;apply(c[key].newValue)}});
  const start=rev;chrome.storage.local.get({[key]:false},data=>{if(!chrome.runtime.lastError&&rev===start)apply(data[key])});
})();
