self.window = self;
importScripts('vendor/kuromoji/kuromoji.js');
let tokenizerPromise;
const cache = new Map();
self.onmessage = async event => {
  const {id,text} = event.data;
  try {
    if (!tokenizerPromise) tokenizerPromise = new Promise((resolve,reject) => {
      self.kuromoji.builder({dicPath:new URL('vendor/kuromoji/dict/',self.location.href).href}).build((error,value) => error ? reject(error) : resolve(value));
    }).catch(error => {tokenizerPromise=null;throw error;});
    const tokenizer = await tokenizerPromise;
    let tokens = cache.get(text);
    if (!tokens) {
      tokens = tokenizer.tokenize(text).map(token=>({surface_form:token.surface_form,reading:token.reading}));
      cache.set(text,tokens);
      if (cache.size>250) cache.delete(cache.keys().next().value);
    }
    self.postMessage({id,ok:true,tokens});
  } catch(error) {self.postMessage({id,ok:false,error:String(error.message || error)});}
};
