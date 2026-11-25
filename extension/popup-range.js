// Fills the slider track up to the current value (--fill), whether the value
// changes by dragging or is set from code after the saved settings load.
(() => {
  'use strict';
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  function paint(input) {
    const min = Number(input.min || 0), max = Number(input.max || 100), value = Number(descriptor.get.call(input));
    const percent = max > min ? Math.max(0, Math.min(100, (value - min) / (max - min) * 100)) : 0;
    input.style.setProperty('--fill', `${percent}%`);
  }
  for (const input of document.querySelectorAll('input[type="range"]')) {
    Object.defineProperty(input, 'value', {
      configurable: true,
      get() { return descriptor.get.call(this); },
      set(next) { descriptor.set.call(this, next); paint(this); },
    });
    input.addEventListener('input', () => paint(input));
    paint(input);
  }
})();
