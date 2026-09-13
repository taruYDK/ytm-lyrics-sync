import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
test('popup version follows manifest rather than a fixed release string',()=>{
  const html=readFileSync(new URL('../popup.html',import.meta.url),'utf8');
  assert.match(html,/id="extensionVersion"><\/div>/);
  const source=readFileSync(new URL('../popup.js',import.meta.url),'utf8');
  for(const version of ['2.2.0','9.8.7']){
    const elements=new Map();
    const document={getElementById(id){if(!elements.has(id))elements.set(id,{textContent:'',addEventListener(){}});return elements.get(id);}};
    const chrome={runtime:{getManifest:()=>({version})},storage:{local:{get(){}},sync:{get(){}}}};
    vm.runInNewContext(source,{document,chrome});
    assert.equal(elements.get('extensionVersion').textContent,`v${version}`);
  }
});
