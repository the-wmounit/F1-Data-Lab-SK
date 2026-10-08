import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createTrackGeometry } from '../src/road.js';

const circle = () => new THREE.CatmullRomCurve3(Array.from({ length: 32 }, (_, index) => {
  const angle = index / 32 * Math.PI * 2;
  return new THREE.Vector3(Math.cos(angle) * 20, Math.sin(angle) * 1.4, Math.sin(angle) * 20);
}), true, 'centripetal');
const close = (a, b, tolerance = 1e-5) => assert.ok(Math.abs(a - b) < tolerance, `${a} differs from ${b}`);
const vertex = (attribute, index) => new THREE.Vector3().fromBufferAttribute(attribute, index);
const dispose = (geometry) => Object.values(geometry).forEach((item) => item.dispose());

test('Closed road has an exact position and normal seam while its UV distance continues', () => {
  const geometries = createTrackGeometry(circle(), 240);
  try {
    for (const name of ['road', 'shoulders', 'edgeLines']) {
      const geometry = geometries[name];
      const position = geometry.getAttribute('position'), normal = geometry.getAttribute('normal'), uv = geometry.getAttribute('uv');
      for (let band = 0; band < (name === 'road' ? 1 : 2); band++) {
        const start = band * 482, end = start + 480;
        for (let side = 0; side < 2; side++) {
          assert.deepEqual(vertex(position, start + side), vertex(position, end + side));
          assert.deepEqual(vertex(normal, start + side), vertex(normal, end + side));
          close(uv.getY(start + side), 0);
          close(uv.getY(end + side), geometry.userData.length / 4);
        }
      }
    }
  } finally { dispose(geometries); }
});

test('Road cross-sections stay horizontal and physically 4.2 units wide on an elevated track', () => {
  const geometries = createTrackGeometry(circle(), 240);
  try {
    const positions = geometries.road.getAttribute('position');
    for (let index = 0; index < positions.count; index += 2) {
      const a = vertex(positions, index), b = vertex(positions, index + 1);
      close(a.y, b.y);
      close(a.distanceTo(b), 4.2);
    }
  } finally { dispose(geometries); }
});

test('Every triangle faces upward, and normals and UVs are finite on the elevated ribbon', () => {
  const geometries = createTrackGeometry(circle(), 240);
  try {
    for (const geometry of Object.values(geometries)) {
      const positions = geometry.getAttribute('position'), normals = geometry.getAttribute('normal');
      for (let index = 0; index < geometry.index.count; index += 3) {
        const a = vertex(positions, geometry.index.getX(index));
        const b = vertex(positions, geometry.index.getX(index + 1));
        const c = vertex(positions, geometry.index.getX(index + 2));
        assert.ok(b.sub(a).cross(c.sub(a)).y > 0, 'Top triangle points up');
      }
      for (let index = 0; index < normals.count; index++) {
        const normal = vertex(normals, index);
        close(normal.length(), 1);
        assert.ok(normal.y > 0);
      }
      for (const name of ['position', 'normal', 'uv']) assert.ok([...geometry.getAttribute(name).array].every(Number.isFinite));
    }
  } finally { dispose(geometries); }
});

test('Straight road has no curbs, shoulders and lines have their exact heights and widths', () => {
  const geometries = createTrackGeometry(new THREE.LineCurve3(new THREE.Vector3(0, 2, 0), new THREE.Vector3(0, 2, 100)), 40);
  try {
    assert.equal(geometries.curbs.index.count, 0);
    const road = geometries.road.getAttribute('position');
    close(road.getX(0), 2.1); close(road.getX(1), -2.1);
    const shoulders = geometries.shoulders.getAttribute('position');
    close(shoulders.getY(0), 1.97); close(Math.abs(shoulders.getX(0) - shoulders.getX(1)), .45);
    const lines = geometries.edgeLines.getAttribute('position');
    close(lines.getY(0), 2.015); close(Math.abs(lines.getX(0) - lines.getX(1)), .045);
  } finally { dispose(geometries); }
});

test('Turn curbs use both colors without changing their physical width', () => {
  const geometries = createTrackGeometry(circle(), 240);
  try {
    const positions = geometries.curbs.getAttribute('position'), colors = geometries.curbs.getAttribute('color');
    assert.ok(positions.count > 0);
    const palette = new Set();
    for (let index = 0; index < positions.count; index += 4) {
      close(vertex(positions, index).distanceTo(vertex(positions, index + 1)), .2);
      palette.add([colors.getX(index), colors.getY(index), colors.getZ(index)].join(','));
      for (let offset = 1; offset < 4; offset++) assert.deepEqual(vertex(colors, index), vertex(colors, index + offset));
    }
    assert.equal(palette.size, 2);
  } finally { dispose(geometries); }
});

test('Vertical tangents stay finite; a zero-length or invalid centerline fails explicitly', () => {
  const geometries = createTrackGeometry(new THREE.LineCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 10, 0)), 20);
  try {
    for (const geometry of Object.values(geometries)) {
      for (const name of ['position', 'normal', 'uv']) assert.ok([...geometry.getAttribute(name).array].every(Number.isFinite));
    }
  } finally { dispose(geometries); }
  assert.throws(() => createTrackGeometry(new THREE.LineCurve3(new THREE.Vector3(), new THREE.Vector3())), /nonzero length/);
  assert.throws(() => createTrackGeometry(circle(), 3), /segments/);
  assert.throws(() => createTrackGeometry(null), /Three.js curve/);
});

test('Arc-length preparation preserves the original measured control points and curve settings', () => {
  const curve = circle(), points = curve.points.map((point) => point.toArray()), divisions = curve.arcLengthDivisions;
  const geometries = createTrackGeometry(curve);
  try {
    assert.deepEqual(curve.points.map((point) => point.toArray()), points);
    assert.equal(curve.arcLengthDivisions, divisions);
  } finally { dispose(geometries); }
});
