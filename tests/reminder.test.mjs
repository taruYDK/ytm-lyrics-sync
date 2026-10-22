import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
test('backup reminder counts distinct updated songs and respects export watermark', () => {
  const ctx = vm.createContext({document:{getElementById:()=>null},chrome:{runtime:{sendMessage(){}},storage:{onChanged:{addListener(){}}}}});
  vm.runInContext(fs.readFileSync(new URL('../extension/backup-reminder.js',import.meta.url),'utf8'),ctx);
  const data={ytmlsPinnedLyricsV200:{a:{updatedAt:10},b:{updatedAt:30}},ytmlsLyricsEditsV199:{a:{candidates:{x:{updatedAt:40}}}}};
  assert.equal(ctx.countUnbackedTracks(data,0),2);
  assert.equal(ctx.countUnbackedTracks(data,20),2);
  assert.equal(ctx.countUnbackedTracks(data,35),1);
  assert.equal(ctx.countUnbackedTracks(data,40),0);
  data.ytmlsManualReadingsV256={c:{updatedAt:50}};
  assert.equal(ctx.countUnbackedTracks(data,40),1);
});


test('backup threshold: saves custom values, updates reminder immediately and rejects invalid input',()=>{
 const handlers={},el={hidden:true,textContent:''},status={textContent:''};
 const input={value:'20',disabled:true,addEventListener:(name,fn)=>handlers[name]=fn};
 const store={backupReminderThreshold:20};let fail=false,writes=0;
 const chrome={runtime:{sendMessage(){}},storage:{onChanged:{addListener(){}},local:{get:(_,cb)=>cb({ytmlsPinnedLyricsV200:Object.fromEntries(Array.from({length:10},(_,i)=>['song'+i,{}]))})},sync:{get:(_,cb)=>cb(store),set:(data,cb)=>{writes++;if(fail){chrome.runtime.lastError={message:'quota'};cb();delete chrome.runtime.lastError;}else{Object.assign(store,data);cb();}}}}};
 const ctx=vm.createContext({document:{getElementById:id=>({backupReminder:el,backupReminderThreshold:input,backupReminderSettingsStatus:status})[id]},chrome});
 vm.runInContext(fs.readFileSync(new URL('../extension/backup-reminder.js',import.meta.url),'utf8'),ctx);
 assert.equal(input.disabled,false);assert.equal(el.hidden,true);
 input.value='5';handlers.change();assert.equal(store.backupReminderThreshold,5);assert.equal(el.hidden,false);
 input.value='50';handlers.change();assert.equal(el.hidden,true);
 for(const value of ['','0','1001','1.5']){input.value=value;handlers.change();assert.equal(input.value,'50');}assert.equal(writes,2);
 fail=true;input.value='10';handlers.change();assert.equal(input.value,'50');assert.equal(store.backupReminderThreshold,50);assert.equal(input.disabled,false);assert(status.textContent.includes('保存できません'));
});
