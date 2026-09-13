import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

function harness() {
  let handler;
  const requests=[];
  const chrome={runtime:{id:'self',getManifest:()=>({version:'2.2.0'}),onMessage:{addListener:fn=>{handler=fn;}}}};
  vm.runInNewContext(readFileSync(new URL('../background.js',import.meta.url),'utf8'),{
    chrome, importScripts(){}, URL, AbortController, setTimeout, clearTimeout,
    fetch:async(url,init)=>{requests.push({url,init});return {ok:true,status:200,text:async()=>'{}',headers:{get:()=>null}};},
  });
  return {requests,send:(message,sender={id:'self'})=>new Promise(resolve=>handler({type:'YTMLS_FETCH',...message},sender,resolve))};
}
test('only approved Content-Type passes; security and internal headers cannot be overridden',async()=>{
  const h=harness();
  const result=await h.send({url:'https://lrclib.net/api/search',headers:{
    'content-type':'application/json',Authorization:'secret',Cookie:'secret',Host:'other',Origin:'other',
    Accept:'bad','Lrclib-Client':'bad','X-Arbitrary':'bad',
  }});
  assert.equal(result.ok,true);
  assert.deepEqual(Object.keys(h.requests[0].init.headers).sort(),['Accept','Content-Type','Lrclib-Client']);
  assert.equal(h.requests[0].init.headers['Content-Type'],'application/json');
  assert.equal(h.requests[0].init.headers['Lrclib-Client'],'YT-Music-Lyrics-Sync/2.2.0');
});
test('form provider requests retain content type and body but not LRCLIB identifier',async()=>{
  const h=harness();
  await h.send({url:'https://lyrics.api.dacubeking.com/test',method:'POST',body:'a=b',headers:{'CONTENT-TYPE':'application/x-www-form-urlencoded;charset=UTF-8'}});
  const {init}=h.requests[0];
  assert.equal(init.headers['Content-Type'],'application/x-www-form-urlencoded;charset=UTF-8');
  assert.equal(init.body,'a=b');
  assert.equal(init.headers['Lrclib-Client'],undefined);
});
test('unknown content types and CRLF cannot inject headers',async()=>{
  for(const value of ['text/html','application/json\r\nAuthorization: evil','application/json\n',42]){
    const h=harness();await h.send({url:'https://lrclib.net/api/search',headers:{'Content-Type':value}});
    assert.equal(h.requests[0].init.headers['Content-Type'],undefined);
  }
});
test('untrusted sender, HTTP and unapproved hostname never reach fetch',async()=>{
  const h=harness();
  assert.equal((await h.send({url:'https://lrclib.net/api/search'},{id:'other'})).ok,false);
  for(const url of ['http://lrclib.net/api/search','https://lrclib.net.evil.example/','https://example.com/']){
    assert.equal((await h.send({url})).ok,false);
  }
  assert.equal(h.requests.length,0);
});
