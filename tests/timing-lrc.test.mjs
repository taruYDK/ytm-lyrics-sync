import test from 'node:test';
import assert from 'node:assert/strict';
import { interpolateTimingOffsetMs as offset } from '../src/core/timing.mjs';
import { exportedPlaybackTime, buildExportLrc, formatLrcTimestamp, editableLineText } from '../src/core/lrc.mjs';

test('offset: interpolation, exact boundaries and last point hold', () => {
  const points = [{position:0,offsetMs:-10000},{position:0.5,offsetMs:10000},{position:0.75,offsetMs:20000}];
  for (const [time, expected] of [[-1,-10000],[0,-10000],[25,0],[50,10000],[62.5,15000],[75,20000],[100,20000],[300,20000]]) {
    assert.equal(offset(points,time,100),expected);
  }
});
test('offset: empty, single point, unknown duration and no mutation', () => {
  assert.equal(offset([],0,0),0);
  const points = Object.freeze([Object.freeze({position:0,offsetMs:20000})]);
  for(const [time,total] of [[10,0],[10,NaN],[NaN,100],[10,100]]) assert.equal(offset(points,time,total),20000);
});
test('LRC timestamps: centisecond carry, negative clamp, long songs', () => {
  assert.equal(formatLrcTimestamp(59.999),'[01:00.00]');
  assert.equal(formatLrcTimestamp(14.32),'[00:14.32]');
  assert.equal(formatLrcTimestamp(-1),'[00:00.00]');
  assert.equal(formatLrcTimestamp(6000),'[100:00.00]');
});
test('export offset: positive, negative, piecewise and early clipping', () => {
  const points=[{position:0,offsetMs:5000},{position:1,offsetMs:15000}];
  assert.equal(exportedPlaybackTime(60,points,100),50);
  assert.equal(exportedPlaybackTime(3,points,100),0);
  assert.equal(exportedPlaybackTime(60,[{position:0,offsetMs:-20000}],100),80);
  assert.equal(exportedPlaybackTime(60,points,0),55);
  assert.equal(exportedPlaybackTime(60,[],100),60);
  assert.equal(exportedPlaybackTime(10,[{position:0,offsetMs:-20000},{position:0.1,offsetMs:20000}],100),6);
});
test('export inversion agrees with forward interpolation for 200 samples', () => {
  const points=[{position:0,offsetMs:-12000},{position:0.3,offsetMs:18000},{position:0.8,offsetMs:-5000}];
  const snapshot=JSON.stringify(points);
  for(let i=1;i<=200;i++){
    const lyricTime=i*1.3;
    const playback=exportedPlaybackTime(lyricTime,points,240);
    assert(Math.abs(playback+offset(points,playback,240)/1000-lyricTime)<1e-8);
  }
  assert.equal(JSON.stringify(points),snapshot);
});
test('LRC: edited text, deleted rows, word text, sorted rows and clean metadata', () => {
  const lines=[{time:90,words:[{text:'hello '},{text:'world'}]},{time:60,text:'edited'},{time:70,text:''},{time:NaN,text:'invalid'}];
  const original=structuredClone(lines);
  const lrc=buildExportLrc(lines,{title:'Title\n[injected]',artist:'Artist'},[{position:0,offsetMs:10000}],100,true);
  assert(lrc.includes('[00:50.00]edited\r\n[01:20.00]hello world\r\n'));
  assert(!lrc.includes('invalid')&&!lrc.includes('[injected]')&&!lrc.includes('[01:00.00]'));
  assert(lrc.includes('[offset:0]'));
  assert.deepEqual(lines,original);
  assert.equal(editableLineText({words:[{text:'a'},{text:'b'}]}),'ab');
});
test('LRC: unadjusted export and empty lyrics error', () => {
  assert(buildExportLrc([{time:60,text:'line'}],{},[{position:0,offsetMs:20000}],100,false).includes('[01:00.00]line'));
  assert.throws(()=>buildExportLrc([{time:1,text:''}],{},[],100,false),/書き出せる/);
});
