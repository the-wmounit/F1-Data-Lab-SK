import * as THREE from 'three';

// Display proportions, not surveyed dimensions. A lap-based scale keeps long,
// narrow circuits from getting a much wider road and larger cars than others.
export const REPLAY_DIMENSIONS = Object.freeze({
  lapLength: 600,
  roadWidth: 1.2,
  carScale: .1,
  cameraScale: .2,
});

/** Uniformly transform the source coordinates; never project cars onto the road. */
export function createReplayLayout(trace) {
  if (!Array.isArray(trace) || trace.length < 4 || trace.some(point =>
    !Array.isArray(point) || point.length !== 3 || !point.every(Number.isFinite))) {
    throw new TypeError('Replay track requires at least four finite xyz points.');
  }
  const bounds = new THREE.Box3().setFromPoints(trace.map(([x, y, z]) => new THREE.Vector3(x, z, -y)));
  const midpoint = bounds.getCenter(new THREE.Vector3());
  const center = new THREE.Vector3(midpoint.x, bounds.min.y, midpoint.z);
  const sourcePoints = trace.map(([x, y, z]) => new THREE.Vector3(x, z, -y).sub(center));
  const sourcePath = new THREE.CurvePath();
  sourcePoints.forEach((point, index) => sourcePath.add(new THREE.LineCurve3(point, sourcePoints[(index + 1) % sourcePoints.length])));
  const length = sourcePath.getLength();
  if (!Number.isFinite(length) || length <= 0) throw new RangeError('Replay track must have a nonzero length.');
  const scale = REPLAY_DIMENSIONS.lapLength / length;
  const map = ([x, y, z]) => new THREE.Vector3(x, z, -y).sub(center).multiplyScalar(scale).add(new THREE.Vector3(0, .15, 0));
  const vectors = trace.map(map);
  // Uneven GPS spacing and tiny backwards steps produce sharp Catmull tangents.
  // Draw the road from evenly spaced stations (about .5 display unit), then
  // smooth xy over +/-1 unit. Keep each station's interpolated source z.
  // This affects the illustrated road only, never telemetry or the map function.
  const stationCount = 1200;
  const stations = sourcePath.getSpacedPoints(stationCount).slice(0, -1)
    .map(point => point.multiplyScalar(scale).add(new THREE.Vector3(0, .15, 0)));
  const smoothed = stations.map((point, index) => {
    const result = new THREE.Vector3(0, point.y, 0);
    for (let offset = -2; offset <= 2; offset++) {
      const neighbour = stations[(index + offset + stationCount) % stationCount];
      const weight = (3 - Math.abs(offset)) / 9;
      result.x += neighbour.x * weight;
      result.z += neighbour.z * weight;
    }
    return result;
  });
  const curve = new THREE.CatmullRomCurve3(smoothed, true, 'centripetal');
  curve.arcLengthDivisions = 4800;
  const extent = new THREE.Box3().setFromPoints(vectors).getSize(new THREE.Vector3());
  return { map, curve, vectors, scale, extent };
}
