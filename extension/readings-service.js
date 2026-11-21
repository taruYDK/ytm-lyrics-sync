let englishDictionaryPromise;
let readingDocumentCreation;
async function ensureReadingDocument() {
  if (!readingDocumentCreation) readingDocumentCreation = (async()=>{
    const url=chrome.runtime.getURL('readings-offscreen.html');
    const existing=await clients.matchAll();
    if (!existing.some(client=>client.url===url)) await chrome.offscreen.createDocument({url:'readings-offscreen.html',reasons:['WORKERS'],justification:'Run the bundled Japanese dictionary in a shared worker without blocking music pages.'});
  })().finally(()=>{readingDocumentCreation=null;});
  return readingDocumentCreation;
}
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if (message?.type === 'YTMLS_ENGLISH_READINGS') {
    if (sender.id !== chrome.runtime.id || !Array.isArray(message.words) || message.words.length > 10000 || message.words.some(word => typeof word !== 'string' || word.length > 128 || !/^[a-z]+(?:'[a-z]+)*$/.test(word))) { reply({ok:false,error:'Invalid reading request'}); return; }
    if (!englishDictionaryPromise) englishDictionaryPromise = fetch(chrome.runtime.getURL('vendor/readings/english.json'))
      .then(response => { if (!response.ok) throw new Error('英語辞書を読み込めません'); return response.json(); })
      .catch(error => { englishDictionaryPromise = null; throw error; });
    englishDictionaryPromise.then(dictionary=>{ const readings = Object.create(null); for (const word of message.words) if (Object.prototype.hasOwnProperty.call(dictionary, word)) readings[word] = dictionary[word]; reply({ok:true,dictionary:readings}); },error=>reply({ok:false,error:error.message}));
    return true;
  }
  if (message?.type !== 'YTMLS_JAPANESE_TOKENS') return;
  if(sender.id !== chrome.runtime.id || typeof message.text !== 'string' || message.text.length>4000){reply({ok:false,error:'Invalid reading request'});return;}
  (async()=>{await ensureReadingDocument();return chrome.runtime.sendMessage({type:'YTMLS_READING_WORKER',text:message.text});})()
    .then(reply,error=>reply({ok:false,error:String(error.message || error)}));
  return true;
});
