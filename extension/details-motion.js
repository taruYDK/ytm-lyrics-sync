// Smooth disclosure: <details> sections grow open and fold shut instead of snapping.
// Used on the settings and backup pages (every <details>) and on YouTube Music (the
// extension's own sections, such as 診断情報; the その他 menu has its own motion).
// Without motion (reduced motion, lightweight mode) they open and close as before.
(() => {
  'use strict';
  if (globalThis.__ytmlsDetailsMotion) return;
  globalThis.__ytmlsDetailsMotion = true;

  const onExtensionPage = location.protocol === 'chrome-extension:';
  const SCOPE = onExtensionPage ? 'details' : '#ytmls-panel details, #ytmls-fullscreen details, #ytmls-track-offset-popover details';
  const EXCLUDE = '#ytmls-more';

  function motionAllowed() {
    const root = document.documentElement;
    if (root.classList.contains('ytmls-lyrics-motion-lightweight') || root.classList.contains('ytmls-extra-motion-disabled')) return false;
    try { return !matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { return true; }
  }

  // Height of the section with only its summary showing.
  function closedHeight(details, summary) {
    const style = getComputedStyle(details);
    const edges = ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth'].reduce((sum, key) => sum + (parseFloat(style[key]) || 0), 0);
    return summary.getBoundingClientRect().height + edges;
  }

  function toggle(details, summary) {
    const from = details.getBoundingClientRect().height;
    const running = details.ytmlsFold;
    // A click during the motion reverses it from where it is.
    const opening = running ? !details.ytmlsOpening : !details.open;
    running?.cancel();
    // Drop the contents' previous fade (a close that is reversed must not leave them hidden).
    for (const child of details.children) child.getAnimations?.().forEach(animation => animation.cancel());
    details.ytmlsOpening = opening;
    if (opening) { details.open = true; delete details.dataset.closing; } else details.dataset.closing = 'true';
    details.style.height = '';
    const to = opening ? details.getBoundingClientRect().height : closedHeight(details, summary);
    const distance = Math.abs(to - from);
    const duration = Math.round(Math.min(420, 220 + distance * .5));
    details.style.overflow = 'hidden';
    const fold = details.animate({height: [`${from}px`, `${to}px`]}, {
      duration,
      // Opening settles with a hint of give; closing folds in and stops softly.
      easing: opening ? 'cubic-bezier(.25, 1.12, .4, 1)' : 'cubic-bezier(.3, .7, .25, 1)',
    });
    for (const child of details.children) {
      if (child === summary) continue;
      child.animate(opening ? [{opacity: 0, transform: 'translateY(-4px)'}, {opacity: 1, transform: 'none'}] : [{opacity: 1}, {opacity: 0}], {
        duration: opening ? duration : duration * .6, easing: 'ease-out', fill: opening ? 'none' : 'forwards',
      });
    }
    details.ytmlsFold = fold;
    const finish = () => {
      if (details.ytmlsFold !== fold) return;
      details.ytmlsFold = null;
      if (!opening) details.open = false;
      delete details.dataset.closing;
      details.style.removeProperty('overflow');
      for (const child of details.children) child.getAnimations?.().forEach(animation => { if (animation !== fold) animation.cancel(); });
    };
    fold.finished.then(finish, () => {});
  }

  document.addEventListener('click', event => {
    const summary = event.target.closest?.('summary');
    const details = summary?.parentElement;
    if (!details || details.tagName !== 'DETAILS' || details.querySelector(':scope > summary') !== summary) return;
    if (!details.matches(SCOPE) || details.matches(EXCLUDE) || !details.animate || !motionAllowed()) return;
    event.preventDefault();
    toggle(details, summary);
  }, true);
})();
