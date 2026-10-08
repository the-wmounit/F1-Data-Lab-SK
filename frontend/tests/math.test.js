import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleAt, completedLap } from '../src/math.js';
test('long telemetry gaps and missing endpoints hide cars', () => {
  const p = [[0,0,0,0],[1,10,10,10],[12,30,30,30]];
  assert.deepEqual(sampleAt(p,.5),[5,5,5]); assert.equal(sampleAt(p,5),null);
  assert.equal(sampleAt(p,-1),null); assert.equal(sampleAt(p,13.01),null); assert.deepEqual(sampleAt(p,12),[30,30,30]);
  assert.deepEqual(sampleAt(p,12.8),[30,30,30]);
});
test('lap does not advance until its timing has completed', () => {
  const laps=[{lap:1,timings:[{driverId:'a',timeSeconds:90}]},{lap:2,timings:[{driverId:'a',timeSeconds:89}]}];
  assert.equal(completedLap(laps,'a',89),0); assert.equal(completedLap(laps,'a',90),1); assert.equal(completedLap(laps,'a',180),2);
});
