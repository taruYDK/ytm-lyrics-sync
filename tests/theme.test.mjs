import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
test('theme attribute and OS events bypass throttle and coalesce per frame',()=>{
 let callback,mediaCallback,reads=0;const frames=[],observed=[];
 const root={dataset:{},hasAttribute:()=>false,getAttribute:()=>null};let bg='rgb(0,0,0)';
 const context=vm.createContext({document:{documentElement:root,body:root,querySelector:()=>null},performance:{now:()=>100},
 getComputedStyle:()=>{reads++;return {backgroundColor:bg}},
 MutationObserver:class{constructor(cb){callback=cb}observe(el,options){observed.push(options)}},
 matchMedia:()=>({matches:false,addEventListener:(_,cb)=>mediaCallback=cb}),requestAnimationFrame:cb=>frames.push(cb)});
 vm.runInContext(fs.readFileSync(new URL('../src/content/theme.js',import.meta.url),'utf8'),context);
 context.updateLyricsTheme();assert.equal(root.dataset.ytmlsTheme,'dark');
 const before=reads;context.updateLyricsTheme();assert.equal(reads,before);
 bg='rgb(255,255,255)';callback();callback();assert.equal(frames.length,1);frames.shift()();assert.equal(root.dataset.ytmlsTheme,'light');
 bg='rgb(0,0,0)';mediaCallback();frames.shift()();assert.equal(root.dataset.ytmlsTheme,'dark');
 assert(!observed[0].attributeFilter.includes('data-ytmls-theme'));
});
