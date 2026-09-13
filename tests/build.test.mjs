import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
test('checked-in content bundle matches sources',()=>{
 const result=spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/build.cjs',import.meta.url)),'--check'],{encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
});
