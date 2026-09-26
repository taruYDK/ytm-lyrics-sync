import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
test('Music Glass settings are isolated; disabling restores root and intensity is bounded',()=>{
 let listener,defaults;const toggles=[],opacity=[];
 const root={classList:{toggle:(name,on)=>toggles.push(on)},style:{setProperty:(key,value)=>opacity.push(value)}};
 const c=vm.createContext({document:{documentElement:root,body:null,addEventListener(){}},chrome:{storage:{local:{get:(d,cb)=>{defaults=d;cb(d);}},onChanged:{addListener:f=>listener=f}}},MutationObserver:class{observe(){}},setTimeout,URL});
 vm.runInContext(fs.readFileSync(new URL('../extension/music-glass.js',import.meta.url),'utf8'),c);
 assert.deepEqual(Object.keys(defaults),['musicGlassEnabled','musicGlassArtwork','musicGlassIntensity']);
 const count=toggles.length;listener({enabled:{newValue:false}},'local');assert.equal(toggles.length,count);
 listener({musicGlassEnabled:{newValue:false},musicGlassIntensity:{newValue:999}},'local');assert.equal(toggles.at(-1),false);assert.equal(opacity.at(-1),'1');
 listener({musicGlassEnabled:{newValue:true}},'local');assert.equal(toggles.at(-1),true);
});
