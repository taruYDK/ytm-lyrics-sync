import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
test('Music Glass settings are isolated; disabling restores root and intensity is bounded',()=>{
 let listener,defaults;const toggles=[],opacity=[];
 const root={classList:{toggle:(name,on)=>{if(name === "music-glass") toggles.push(on);}},style:{setProperty:(key,value)=>opacity.push(value)}};
 const c=vm.createContext({document:{documentElement:root,body:null,addEventListener(){}},chrome:{storage:{local:{get:(d,cb)=>{defaults=d;cb(d);}},onChanged:{addListener:f=>listener=f}}},MutationObserver:class{observe(){}},setTimeout,URL});
 vm.runInContext(fs.readFileSync(new URL('../extension/music-glass.js',import.meta.url),'utf8'),c);
 assert.deepEqual(Object.keys(defaults),['musicGlassEnabled','musicGlassArtwork','musicGlassIntensity','musicGlassHideScrollbar','musicGlassLightweight']);
 const count=toggles.length;listener({enabled:{newValue:false}},'local');assert.equal(toggles.length,count);
 listener({musicGlassEnabled:{newValue:false},musicGlassIntensity:{newValue:999}},'local');assert.equal(toggles.at(-1),false);assert.equal(opacity.at(-1),'1');
 listener({musicGlassEnabled:{newValue:true}},'local');assert.equal(toggles.at(-1),true);
});
test('Quick toggle state follows saved settings, rollback, and external changes',()=>{
 const toggle={checked:false,addEventListener:(name,f)=>toggle.change=f};
 const state={textContent:'読込中',dataset:{}};const status={textContent:''};
 let changed;const runtime={};let fail=false;const scrollbar={addEventListener(){}};
 const chrome={runtime,storage:{local:{get:(d,cb)=>cb({...d,musicGlassEnabled:false}),set:(data,cb)=>{assert.deepEqual(Object.keys(data),['musicGlassEnabled']);runtime.lastError=fail?{message:'failed'}:undefined;cb();runtime.lastError=undefined;}},onChanged:{addListener:f=>{if(!changed) changed=f;}}}};
 vm.runInNewContext(fs.readFileSync(new URL('../extension/music-glass-quick.js',import.meta.url),'utf8'),{chrome,document:{getElementById:id=>({musicGlassLightweightToggle:{addEventListener(){}},musicGlassScrollbarToggle:scrollbar,musicGlassQuickToggle:toggle,musicGlassQuickState:state,musicGlassQuickStatus:status})[id]}});
 assert.equal(state.textContent,'OFF');assert.equal(toggle.disabled,false);
 toggle.checked=true;toggle.change();assert.equal(state.textContent,'ON');assert.equal(state.dataset.enabled,'true');
 fail=true;toggle.checked=false;toggle.change();assert.equal(toggle.checked,true);assert.equal(state.textContent,'ON');assert.ok(status.textContent);
 changed({musicGlassEnabled:{newValue:false}},'local');assert.equal(state.textContent,'OFF');assert.equal(toggle.checked,false);
});
test('Lightweight mode removes artwork and restores it when disabled',()=>{
 let listener,created=0,removed=0;
 const body={prepend(el){el.parentNode=body;}};
 const document={body,documentElement:{classList:{toggle(){}},style:{setProperty(){}}},addEventListener(){},querySelector(){return null;},createElement(){created++;return {style:{},setAttribute(){},remove(){removed++;this.parentNode=null;}};}};
 vm.runInNewContext(fs.readFileSync(new URL('../extension/music-glass.js',import.meta.url),'utf8'),{document,chrome:{storage:{local:{get:(d,cb)=>cb({...d,musicGlassLightweight:true})},onChanged:{addListener:f=>listener=f}}},MutationObserver:class{observe(){}},setTimeout,URL});
 assert.equal(created,0);
 listener({musicGlassLightweight:{newValue:false}},'local');assert.equal(created,1);
 listener({musicGlassLightweight:{newValue:true}},'local');assert.equal(removed,1);
 listener({musicGlassIntensity:{newValue:20}},'local');assert.equal(created,1);
 listener({musicGlassLightweight:{newValue:false}},'local');assert.equal(created,2);
});
