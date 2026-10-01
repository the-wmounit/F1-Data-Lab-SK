// Sampling is conservative: never draw an invented path through a >5 s gap.
export function sampleAt(points, time, maxGap = 5) {
  if (!points.length || time < points[0][0]) return null;
  // A 1 Hz stream can end within the final sampling interval. Hold only that
  // last measured position for <=1 s, never an unobserved trajectory.
  if (time > points.at(-1)[0]) return time - points.at(-1)[0] <= 1 ? points.at(-1).slice(1) : null;
  let lo = 0, hi = points.length - 1;
  while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (points[mid][0] <= time) lo = mid; else hi = mid - 1; }
  const a = points[lo], b = points[Math.min(lo + 1, points.length - 1)];
  if (time === a[0] || b === a) return a.slice(1);
  if (b[0] - a[0] > maxGap) return null;
  const f = (time - a[0]) / (b[0] - a[0]);
  return a.slice(1).map((v, i) => v + (b[i + 1] - v) * f);
}
export function formatTime(seconds) { const n = Math.max(0, Math.floor(seconds)); return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`; }
export function completedLap(laps, driverId, seconds) {
  let end = 0, lap = 0;
  for (const row of laps) { const timing = row.timings.find(t => t.driverId === driverId); if (!timing) continue; end += timing.timeSeconds; if (seconds < end) break; lap = row.lap; }
  return lap;
}
