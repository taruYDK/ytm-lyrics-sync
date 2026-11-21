  function playerFeedbackEnabled() {
    const root = document.documentElement;
    return STATE.enabled && !root.classList.contains('ytmls-extra-motion-disabled') &&
      !root.classList.contains('ytmls-lyrics-motion-lightweight') &&
      !matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  let seekFlash = null;
  function flashSeekLine(row) {
    if (!row || !playerFeedbackEnabled()) return;
    if (seekFlash) {
      seekFlash.effect.target.classList.remove('ytmls-seek-flash');
      seekFlash.cancel();
    }
    row.classList.add('ytmls-seek-flash');
    const animation = row.animate([
      { transform: 'translateX(0)', opacity: 0 },
      { opacity: 1, offset: 0.18 },
      { transform: 'translateX(250%)', opacity: 0 }
    ], { pseudoElement: '::after', duration: 420, easing: 'ease-out' });
    seekFlash = animation;
    const release = () => {
      if (seekFlash !== animation) return;
      row.classList.remove('ytmls-seek-flash');
      seekFlash = null;
    };
    animation.finished.then(release, release);
  }
