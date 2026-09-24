import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
test('backup reminder counts distinct updated songs and respects export watermark', () => {
  const ctx = vm.createContext({document:{getElementById:()=>null},chrome:{runtime:{sendMessage(){}},storage:{onChanged:{addListener(){}}}}});
  vm.runInContext(fs.readFileSync(new URL('../backup-reminder.js',import.meta.url),'utf8'),ctx);
  const data={ytmlsPinnedLyricsV200:{a:{updatedAt:10},b:{updatedAt:30}},ytmlsLyricsEditsV199:{a:{candidates:{x:{updatedAt:40}}}}};
  assert.equal(ctx.countUnbackedTracks(data,0),2);
  assert.equal(ctx.countUnbackedTracks(data,20),2);
  assert.equal(ctx.countUnbackedTracks(data,35),1);
  assert.equal(ctx.countUnbackedTracks(data,40),0);
  data.ytmlsManualReadingsV256={c:{updatedAt:50}};
  assert.equal(ctx.countUnbackedTracks(data,40),1);
});
