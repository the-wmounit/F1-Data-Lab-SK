import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { createReplayLayout, REPLAY_DIMENSIONS } from '../src/track-layout.js';
import { createTrackGeometry } from '../src/road.js';

const SEGMENTS = 1200;
const EPSILON = 1e-9;
const LOCAL_ARC_DISTANCE = 10;
const BRANCH_MARGIN = .25;
const fixtures = [1, 2].map(round => {
  const replay = JSON.parse(readFileSync(new URL(`../../data/2024/${round}/replay.json`, import.meta.url), 'utf8'));
  return { round, replay, originalHash: hash(replay) };
});

function hash(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function close(actual, expected, tolerance = 1e-8) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);
}
function vertex(positions, index) {
  return { x: positions.getX(index), y: positions.getY(index), z: positions.getZ(index) };
}
function signedCrossY(a, b, c) {
  return (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
}
function cyclicDistance(a, b, count) {
  const distance = Math.abs(a - b);
  return Math.min(distance, count - distance);
}

// Read the original strip ordering, rather than the geometry's index. Swapping
// indices or replacing a normal with UP cannot conceal an offset edge folding.
function foldedTriangles(geometry, bands, individualQuads = false) {
  const positions = geometry.getAttribute('position');
  let folded = 0;
  const check = (a, b, c, d) => {
    if (signedCrossY(a, b, c) <= EPSILON) folded++;
    if (signedCrossY(b, d, c) <= EPSILON) folded++;
  };
  if (individualQuads) {
    for (let start = 0; start < positions.count; start += 4) {
      check(...[0, 1, 2, 3].map(offset => vertex(positions, start + offset)));
    }
  } else {
    for (let band = 0; band < bands; band++) {
      const start = band * (SEGMENTS + 1) * 2;
      for (let index = 0; index < SEGMENTS; index++) {
        check(...[0, 1, 2, 3].map(offset => vertex(positions, start + index * 2 + offset)));
      }
    }
  }
  return folded;
}

function intersect(a, b, c, d) {
  if (Math.max(a.x, b.x) < Math.min(c.x, d.x) - EPSILON
    || Math.max(c.x, d.x) < Math.min(a.x, b.x) - EPSILON
    || Math.max(a.z, b.z) < Math.min(c.z, d.z) - EPSILON
    || Math.max(c.z, d.z) < Math.min(a.z, b.z) - EPSILON) return false;
  const abC = signedCrossY(a, b, c), abD = signedCrossY(a, b, d);
  const cdA = signedCrossY(c, d, a), cdB = signedCrossY(c, d, b);
  const on = (p, q, r) => r.x >= Math.min(p.x, q.x) - EPSILON && r.x <= Math.max(p.x, q.x) + EPSILON
    && r.z >= Math.min(p.z, q.z) - EPSILON && r.z <= Math.max(p.z, q.z) + EPSILON;
  return (abC * abD < 0 && cdA * cdB < 0)
    || (Math.abs(abC) <= EPSILON && on(a, b, c))
    || (Math.abs(abD) <= EPSILON && on(a, b, d))
    || (Math.abs(cdA) <= EPSILON && on(c, d, a))
    || (Math.abs(cdB) <= EPSILON && on(c, d, b));
}

function borderIntersections(left, right) {
  let intersections = 0;
  for (const [first, second] of [[left, left], [right, right], [left, right]]) {
    const sameSide = first === second;
    for (let i = 0; i < SEGMENTS; i++) {
      for (let j = sameSide ? i + 1 : 0; j < SEGMENTS; j++) {
        // Adjacent sections share endpoints, including at the closing seam.
        if (cyclicDistance(i, j, SEGMENTS) <= 1) continue;
        if (intersect(first[i], first[(i + 1) % SEGMENTS], second[j], second[(j + 1) % SEGMENTS])) intersections++;
      }
    }
  }
  return intersections;
}

function trackMetrics(geometries) {
  const folded = {
    road: foldedTriangles(geometries.road, 1),
    shoulders: foldedTriangles(geometries.shoulders, 2),
    edgeLines: foldedTriangles(geometries.edgeLines, 2),
    curbs: foldedTriangles(geometries.curbs, 0, true),
  };
  const road = geometries.road.getAttribute('position');
  const shoulders = geometries.shoulders.getAttribute('position');
  const roadLeft = [], roadRight = [], outerLeft = [], outerRight = [], centerline = [];
  let outerDiameter = 0;
  for (let i = 0; i < SEGMENTS; i++) {
    roadLeft.push(vertex(road, i * 2)); roadRight.push(vertex(road, i * 2 + 1));
    outerLeft.push(vertex(shoulders, i * 2));
    outerRight.push(vertex(shoulders, (SEGMENTS + 1) * 2 + i * 2 + 1));
    centerline.push({ x: (roadLeft[i].x + roadRight[i].x) / 2, z: (roadLeft[i].z + roadRight[i].z) / 2 });
    outerDiameter = Math.max(outerDiameter, Math.hypot(outerLeft[i].x - outerRight[i].x, outerLeft[i].z - outerRight[i].z));
  }
  const localStations = Math.ceil(LOCAL_ARC_DISTANCE / (geometries.road.userData.length / SEGMENTS));
  let branchDistance = Infinity;
  for (let i = 0; i < SEGMENTS; i++) {
    for (let j = i + localStations; j < SEGMENTS; j++) {
      if (cyclicDistance(i, j, SEGMENTS) < localStations) continue;
      branchDistance = Math.min(branchDistance, Math.hypot(centerline[i].x - centerline[j].x, centerline[i].z - centerline[j].z));
    }
  }
  return { folded, roadIntersections: borderIntersections(roadLeft, roadRight),
    outerIntersections: borderIntersections(outerLeft, outerRight), branchDistance, outerDiameter };
}

function assertSeparated(metrics) {
  for (const [name, count] of Object.entries(metrics.folded)) assert.equal(count, 0, `${name}: folded triangles`);
  assert.equal(metrics.roadIntersections, 0, 'Road borders intersect away from adjacent sections');
  assert.equal(metrics.outerIntersections, 0, 'Outer shoulders intersect away from adjacent sections');
  assert.ok(metrics.branchDistance > metrics.outerDiameter + BRANCH_MARGIN,
    `Nonlocal branch gap ${metrics.branchDistance} must exceed ${metrics.outerDiameter} plus ${BRANCH_MARGIN}`);
}

function distanceToSegment(point, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const denominator = dx * dx + dy * dy + dz * dz;
  const t = denominator === 0 ? 0 : Math.max(0, Math.min(1,
    ((point.x - a.x) * dx + (point.y - a.y) * dy + (point.z - a.z) * dz) / denominator));
  return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy, point.z - a.z - t * dz);
}

function sourceStation(vectors, distance, lengths) {
  let edge = 0;
  while (edge < vectors.length - 1 && lengths[edge + 1] < distance) edge++;
  const segmentLength = lengths[edge + 1] - lengths[edge];
  return vectors[edge].clone().lerp(vectors[(edge + 1) % vectors.length],
    segmentLength === 0 ? 0 : (distance - lengths[edge]) / segmentLength);
}

for (const fixture of fixtures) {
  test(`Real 2024 round ${fixture.round}: road, shoulders, lines and curbs have no folded or crossing edges`, t => {
    const layout = createReplayLayout(fixture.replay.circuit.points);
    const geometries = createTrackGeometry(layout.curve, SEGMENTS, { width: REPLAY_DIMENSIONS.roadWidth });
    try {
      const metrics = trackMetrics(geometries);
      assertSeparated(metrics);
      for (const geometry of Object.values(geometries)) {
        for (const attribute of ['position', 'normal', 'uv']) {
          assert.ok([...geometry.getAttribute(attribute).array].every(Number.isFinite));
        }
      }
      t.diagnostic(`branch gap=${metrics.branchDistance.toFixed(4)}, outer width=${metrics.outerDiameter.toFixed(4)}, folds=0, intersections=0`);
    } finally { Object.values(geometries).forEach(geometry => geometry.dispose()); }
  });

  test(`Real 2024 round ${fixture.round}: mapping preserves source xyz and elevation; display smoothing stays below .2 unit`, t => {
    const trace = fixture.replay.circuit.points;
    const layout = createReplayLayout(trace);
    const a = layout.map([10, 20, 30]);
    for (const [input, expected] of [
      [[11, 20, 30], [layout.scale, 0, 0]],
      [[10, 21, 30], [0, 0, -layout.scale]],
      [[10, 20, 31], [0, layout.scale, 0]],
    ]) {
      layout.map(input).sub(a).toArray().forEach((value, index) => close(value, expected[index]));
    }
    assert.deepEqual(layout.vectors.map(vector => vector.toArray()), trace.map(point => layout.map(point).toArray()));
    // The closed source polyline has exactly the common display length; the
    // filtered curve itself is slightly shorter as it removes micro-jitter.
    const lengths = [0];
    layout.vectors.forEach((point, index) => lengths.push(lengths.at(-1) + point.distanceTo(layout.vectors[(index + 1) % trace.length])));
    close(lengths.at(-1), REPLAY_DIMENSIONS.lapLength);
    let stationDeviation = 0;
    layout.curve.points.forEach((point, index) => {
      const source = sourceStation(layout.vectors, lengths.at(-1) * index / layout.curve.points.length, lengths);
      close(point.y, source.y); // No averaging or replacement of the source z.
      stationDeviation = Math.max(stationDeviation, point.distanceTo(source));
    });
    assert.ok(stationDeviation < .2, `Station displacement ${stationDeviation} exceeds .2`);
    let curveDeviation = 0;
    for (const point of layout.curve.getSpacedPoints(4800)) {
      let nearest = Infinity;
      for (let index = 0; index < layout.vectors.length; index++) {
        nearest = Math.min(nearest, distanceToSegment(point, layout.vectors[index], layout.vectors[(index + 1) % trace.length]));
      }
      curveDeviation = Math.max(curveDeviation, nearest);
    }
    assert.ok(curveDeviation < .2, `Display curve deviation ${curveDeviation} exceeds .2`);
    assert.equal(hash(fixture.replay), fixture.originalHash, 'Fixtures, telemetry and source metadata remain unchanged');
    t.diagnostic(`station smoothing=${stationDeviation.toFixed(5)}, curve-to-source deviation=${curveDeviation.toFixed(5)}`);
  });
}

test('Regression detector rejects the previous Jeddah max-span 115 / road width 4.2 layout', t => {
  const trace = fixtures.find(fixture => fixture.round === 2).replay.circuit.points;
  const xs = trace.map(point => point[0]), ys = trace.map(point => point[1]), zs = trace.map(point => point[2]);
  const scale = 115 / Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const center = [(Math.max(...xs) + Math.min(...xs)) / 2, (Math.max(...ys) + Math.min(...ys)) / 2, Math.min(...zs)];
  const vectors = trace.map(point => new THREE.Vector3((point[0] - center[0]) * scale,
    (point[2] - center[2]) * scale + .15, -(point[1] - center[1]) * scale));
  const geometries = createTrackGeometry(new THREE.CatmullRomCurve3(vectors, true, 'centripetal'), SEGMENTS, { width: 4.2 });
  try {
    const metrics = trackMetrics(geometries);
    assert.ok(metrics.folded.road > 0, 'Old layout must reproduce folded road triangles');
    assert.ok(metrics.roadIntersections > 0, 'Old layout must reproduce nonadjacent left/right border crossings');
    assert.ok(metrics.branchDistance < metrics.outerDiameter, 'Old layout must reproduce overlapping branches');
    assert.throws(() => assertSeparated(metrics), /folded triangles/);
    t.diagnostic(`old road folds=${metrics.folded.road}, border crossings=${metrics.roadIntersections}, branch gap=${metrics.branchDistance.toFixed(4)}, outer width=${metrics.outerDiameter.toFixed(4)}`);
  } finally { Object.values(geometries).forEach(geometry => geometry.dispose()); }
});
