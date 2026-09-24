let readingWorker = null, readingSerial = 0, readingIdleTimer;
const readingRequests = new Map();
function stopReadingWorker() {
  readingWorker?.terminate(); readingWorker = null;
  for (const request of readingRequests.values()) { clearTimeout(request.timer); request.reply({ok:false,error:'読み仮名処理が中断されました'}); }
  readingRequests.clear();
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.type !== 'YTMLS_READING_WORKER' || sender.id !== chrome.runtime.id || sender.tab) return;
  clearTimeout(readingIdleTimer);
  if (!readingWorker) {
    readingWorker = new Worker('readings-worker.js');
    readingWorker.onmessage = event => {
      const request = readingRequests.get(event.data.id);
      if (!request) return;
      clearTimeout(request.timer); readingRequests.delete(event.data.id); request.reply(event.data);
      if (!readingRequests.size) readingIdleTimer = setTimeout(stopReadingWorker, 300000);
    };
    readingWorker.onerror = stopReadingWorker;
  }
  const id = ++readingSerial;
  readingRequests.set(id, {reply, timer:setTimeout(stopReadingWorker,30000)});
  readingWorker.postMessage({id,text:message.text});
  return true;
});
