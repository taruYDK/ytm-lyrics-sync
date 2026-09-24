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
  if (message?.type !== 'YTMLS_JAPANESE_TOKENS') return;
  if(sender.id !== chrome.runtime.id || typeof message.text !== 'string' || message.text.length>4000){reply({ok:false,error:'Invalid reading request'});return;}
  (async()=>{await ensureReadingDocument();return chrome.runtime.sendMessage({type:'YTMLS_READING_WORKER',text:message.text});})()
    .then(reply,error=>reply({ok:false,error:String(error.message || error)}));
  return true;
});
