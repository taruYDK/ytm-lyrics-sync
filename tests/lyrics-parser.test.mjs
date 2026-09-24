import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(new URL('../src/content/lyrics-parser.js', import.meta.url), 'utf8'), context);
const parse = text => JSON.parse(JSON.stringify(context.parseRichLrcWithWordRows(text)));
test('rich LRC: repeated tags retain words after chronological sorting', () => {
  const {lines} = parse('[00:10][00:30]A\n<A:10:11>\n[00:20]B\n<B:20:21>');
  assert.deepEqual(lines.map(l => [l.time, l.text, l.words[0]?.text, l.words[0]?.time, l.end]),
    [[10,'A','A',10,20],[20,'B','B',20,30],[30,'A','A',30,null]]);
});
test('rich LRC: three-digit minutes and offsets also apply to words', () => {
  const {lines} = parse('[offset:1000]\n[100:00]long\n<long:6000:6001>');
  assert.equal(lines[0].words[0]?.time, 6001);
  assert.equal(lines[0].words[0]?.end, 6002);
});
test('rich LRC: malformed word times cannot produce NaN', () => {
  const result = parse('[00:10]A\n<A:1.2.3:11>');
  assert.equal(result.syncLevel, 'line');
  assert.deepEqual(result.lines[0].words, []);
});
