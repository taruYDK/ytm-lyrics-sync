import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('slider fill follows values set from code and by dragging', () => {
  class HTMLInputElement {
    constructor() { this._v = '50'; this.min = '25'; this.max = '65'; this.style = {props: {}, setProperty(k, v) { this.props[k] = v; }}; this.handlers = {}; }
    get value() { return this._v; }
    set value(v) { this._v = String(v); }
    addEventListener(type, fn) { this.handlers[type] = fn; }
  }
  const input = new HTMLInputElement();
  vm.runInNewContext(fs.readFileSync(new URL('../extension/popup-range.js', import.meta.url), 'utf8'),
    {HTMLInputElement, document: {querySelectorAll: () => [input]}});
  assert.equal(input.style.props['--fill'], '62.5%');
  input.value = 25; assert.equal(input.style.props['--fill'], '0%');
  input._v = '65'; input.handlers.input(); assert.equal(input.style.props['--fill'], '100%');
  assert.equal(input.value, '65');
});
