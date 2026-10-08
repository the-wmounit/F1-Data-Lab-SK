import * as THREE from 'three';

const EPSILON = 1e-9;
const UP = new THREE.Vector3(0, 1, 0);
const ROAD_HALF_WIDTH = 2.1;
const CURB_LOOK_DISTANCE = 3;
const CURB_ANGLE = .12;
const RED = new THREE.Color('#d83d35');
const WHITE = new THREE.Color('#f5f3e8');

/**
 * A road ribbon follows the measured centerline elevation, with a horizontal
 * cross section at each station (no banking, tube, or invented elevation).
 * Default scene-unit widths: road 4.2; shoulders 2.1..2.55; white lines 2..2.045.
 * The width option scales all bands together to the replay's lap-based scale.
 * UV u crosses each band; v is longitudinal arc distance / 4 scene units.
 * Returned BufferGeometry objects own their attributes, but no materials.
 * Open curves also work for testing; a closed curve gets an exact seam.
 */
export function createTrackGeometry(curve, segments = 1200, { width = ROAD_HALF_WIDTH * 2 } = {}) {
  if (!Number.isFinite(width) || width <= 0) throw new RangeError('Track width must be finite and positive.');
  const widthScale = width / (ROAD_HALF_WIDTH * 2);
  if (!Number.isInteger(segments) || segments < 4 || segments > 100_000) {
    throw new RangeError('Track segments must be an integer between 4 and 100000.');
  }
  if (!curve?.clone || !curve.getSpacedPoints || !curve.getTangentAt) {
    throw new TypeError('Track requires a Three.js curve.');
  }
  // More arc-length divisions keep dense measured traces evenly sampled.
  // Work on a clone so the caller's curve and source points remain unchanged.
  const path = curve.clone();
  path.arcLengthDivisions = Math.max(path.arcLengthDivisions, segments * 2);
  path.updateArcLengths();
  const length = path.getLength();
  if (!Number.isFinite(length) || length <= EPSILON) {
    throw new RangeError('Track centerline must have a finite, nonzero length.');
  }
  const closed = Boolean(curve.closed);
  const points = path.getSpacedPoints(segments);
  if (points.some((point) => ![point.x, point.y, point.z].every(Number.isFinite))) {
    throw new RangeError('Track centerline contains nonfinite coordinates.');
  }
  if (closed) points[segments].copy(points[0]);
  const tangents = points.map((point, index) => {
    const tangent = path.getTangentAt(index / segments);
    tangent.y = 0;
    if (![tangent.x, tangent.z].every(Number.isFinite) || tangent.lengthSq() <= EPSILON) {
      const before = points[closed ? (index - 1 + segments) % segments : Math.max(0, index - 1)];
      const after = points[closed ? (index + 1) % segments : Math.min(segments, index + 1)];
      tangent.subVectors(after, before); tangent.y = 0;
    }
    return tangent.lengthSq() > EPSILON ? tangent.normalize() : null;
  });
  // A vertical tangent has no unique horizontal lateral. Reuse the closest
  // defined heading; a wholly vertical test curve gets a stable +z fallback.
  const firstDefined = tangents.find((tangent) => tangent !== null) ?? new THREE.Vector3(0, 0, 1);
  let previous = firstDefined;
  for (let index = 0; index <= segments; index++) {
    tangents[index] ??= previous.clone();
    previous = tangents[index];
  }
  if (closed) tangents[segments] = tangents[0].clone();
  const stations = points.map((point, index) => ({ point, tangent: tangents[index],
    lateral: new THREE.Vector3(-tangents[index].z, 0, tangents[index].x), distance: length * index / segments }));

  const scaledBands = bands => bands.map(band => band.map(offset => offset * widthScale));
  const road = stripGeometry(stations, [[-width / 2, width / 2]], 0, closed);
  const shoulders = stripGeometry(stations, scaledBands([[-2.55, -ROAD_HALF_WIDTH], [ROAD_HALF_WIDTH, 2.55]]), -.03 * widthScale, closed);
  const edgeLines = stripGeometry(stations, scaledBands([[-2.045, -2], [2, 2.045]]), .015 * widthScale, closed);
  const curbs = curbGeometry(stations, closed, widthScale);
  for (const geometry of [road, shoulders, edgeLines, curbs]) {
    geometry.userData = { closed, segments, length, uvDistancePerRepeat: 4 };
  }
  road.userData.width = width;
  curbs.userData.turnAngleThreshold = CURB_ANGLE;
  curbs.userData.lookDistance = CURB_LOOK_DISTANCE;
  return { road, shoulders, edgeLines, curbs };
}

function stationPoint(station, offset, elevation) {
  return station.point.clone().addScaledVector(station.lateral, offset).addScaledVector(UP, elevation);
}

function appendTriangle(indices, positions, a, b, c) {
  // Keep the ribbon's natural winding. Flipping a folded face would conceal an
  // invalid offset instead of repairing the road; fixture tests detect folds.
  indices.push(a, b, c);
}

function finishGeometry(positions, uvs, indices, colors = null, seams = []) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  if (colors) geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const normals = geometry.getAttribute('normal');
  const vector = new THREE.Vector3();
  for (let index = 0; index < normals.count; index++) {
    vector.fromBufferAttribute(normals, index);
    if (![vector.x, vector.y, vector.z].every(Number.isFinite) || vector.lengthSq() <= EPSILON || vector.y < EPSILON) vector.copy(UP);
    else vector.normalize();
    normals.setXYZ(index, vector.x, vector.y, vector.z);
  }
  for (const [first, last] of seams) {
    vector.fromBufferAttribute(normals, first).add(new THREE.Vector3().fromBufferAttribute(normals, last)).normalize();
    normals.setXYZ(first, vector.x, vector.y, vector.z);
    normals.setXYZ(last, vector.x, vector.y, vector.z);
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function stripGeometry(stations, bands, elevation, closed) {
  const positions = [], uvs = [], indices = [], seams = [];
  for (const [inner, outer] of bands) {
    const startVertex = positions.length / 3;
    for (const station of stations) {
      for (const [u, offset] of [[0, inner], [1, outer]]) {
        const point = stationPoint(station, offset, elevation);
        positions.push(point.x, point.y, point.z);
        uvs.push(u, station.distance / 4);
      }
    }
    for (let index = 0; index < stations.length - 1; index++) {
      const a = startVertex + index * 2, b = a + 2;
      appendTriangle(indices, positions, a, a + 1, b);
      appendTriangle(indices, positions, a + 1, b + 1, b);
    }
    if (closed) {
      seams.push([startVertex, startVertex + (stations.length - 1) * 2],
        [startVertex + 1, startVertex + (stations.length - 1) * 2 + 1]);
    }
  }
  return finishGeometry(positions, uvs, indices, null, seams);
}

function curbGeometry(stations, closed, widthScale) {
  const positions = [], uvs = [], indices = [], colors = [];
  const segments = stations.length - 1;
  const step = stations[segments].distance / segments;
  // Evaluate a fixed distance of centerline rather than a single tiny segment,
  // so the turn threshold remains useful with either 600 or 1200 stations.
  const window = Math.max(1, Math.min(Math.floor(segments / 4), Math.round(CURB_LOOK_DISTANCE / step)));
  const stationAt = (index) => stations[closed ? (index + segments) % segments : Math.max(0, Math.min(segments, index))];
  for (let index = 0; index < segments; index++) {
    const before = stationAt(index - window).tangent;
    const after = stationAt(index + window).tangent;
    const angle = Math.acos(THREE.MathUtils.clamp(before.dot(after), -1, 1));
    if (angle < CURB_ANGLE) continue;
    const color = Math.floor((stations[index].distance + stations[index + 1].distance) / 2 / (1.5 * widthScale)) % 2 ? WHITE : RED;
    for (const [inner, outer] of [[-2.3, -2.1], [2.1, 2.3]]) {
      const first = positions.length / 3;
      for (const station of [stations[index], stations[index + 1]]) {
        for (const [u, offset] of [[0, inner], [1, outer]]) {
          const point = stationPoint(station, offset * widthScale, .025 * widthScale);
          positions.push(point.x, point.y, point.z);
          uvs.push(u, station.distance / 4);
          colors.push(color.r, color.g, color.b);
        }
      }
      appendTriangle(indices, positions, first, first + 1, first + 2);
      appendTriangle(indices, positions, first + 1, first + 3, first + 2);
    }
  }
  return finishGeometry(positions, uvs, indices, colors);
}
