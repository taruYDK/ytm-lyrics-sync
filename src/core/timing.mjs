export function interpolateTimingOffsetMs(points, time, total) {
  // Caller supplies normalized points sorted by position (0..1), in milliseconds.
  if (!points.length) return 0;
  if (!Number.isFinite(time) || !Number.isFinite(total) || total <= 0) return points[0].offsetMs;
  const progress = Math.max(0, Math.min(1, time / total));
  if (progress <= points[0].position) return points[0].offsetMs;
  for (let index = 1; index < points.length; index++) {
    const next = points[index];
    if (progress > next.position) continue;
    const previous = points[index - 1];
    const span = next.position - previous.position;
    if (span <= 0) return next.offsetMs;
    const localProgress = (progress - previous.position) / span;
    return previous.offsetMs + (next.offsetMs - previous.offsetMs) * localProgress;
  }
  return points[points.length - 1].offsetMs;
}
