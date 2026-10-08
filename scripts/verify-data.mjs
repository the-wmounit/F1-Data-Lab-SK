import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from './ingest.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, 'data');
const read = async (file) => JSON.parse(await readFile(path.join(dataDir, file), 'utf8'));
const finite = (value) => assert.ok(Number.isFinite(value), `Expected finite number: ${value}`);
const manifest = await read('source-manifest.json');
const sourceMap = new Map(manifest.sources.map((source) => [source.url, source]));
const sampleProvenance = await read('samples/location-bahrain-source.json');
const sampleBytes = await readFile(path.join(dataDir, 'samples/location-bahrain.json'));
assert.equal(sha256(sampleBytes), sampleProvenance.subsetSha256);
assert.equal(JSON.parse(sampleBytes.toString('utf8')).length, sampleProvenance.subsetRecords);
assert.equal(sampleProvenance.source.sha256, sourceMap.get(sampleProvenance.source.url)?.sha256);
assert.equal(sourceMap.size, manifest.sources.length, 'Unique source URLs');
for (const source of manifest.sources) {
  assert.match(source.sha256, /^[a-f0-9]{64}$/);
  assert.ok(Number.isFinite(Date.parse(source.fetchedAt)), 'Fetch time present');
  assert.ok(source.url.startsWith('https://api.openf1.org/') || source.url.startsWith('https://api.jolpi.ca/'));
  if (process.argv.includes('--raw')) {
    const bytes = await readFile(path.join(dataDir, 'raw', `${sha256(source.url)}.json`));
    assert.equal(sha256(bytes), source.sha256, `Raw response integrity: ${source.url}`);
  }
}

const catalog = await read('catalog.json');
assert.equal(catalog.races.length, 2);
for (const race of catalog.races) {
  const prefix = `${race.year}/${race.round}`;
  const [results, laps, pits, replay, quality] = await Promise.all([
    read(`${prefix}/results.json`), read(`${prefix}/laps.json`), read(`${prefix}/pits.json`), read(`${prefix}/replay.json`), read(`${prefix}/quality.json`),
  ]);
  assert.equal(results.drivers.length, 20);
  const ids = new Set(results.drivers.map((driver) => driver.driverId));
  assert.equal(ids.size, results.drivers.length);
  assert.equal(replay.drivers.length, results.drivers.length);
  assert.equal(replay.sessionKey, race.sessionKey);
  assert.equal(replay.sampleHz, 1);
  assert.equal(laps.laps.length, race.laps);
  for (const driver of results.drivers) {
    for (const field of ['number', 'position', 'grid', 'laps', 'points']) finite(driver[field]);
    assert.match(driver.color, /^#[a-fA-F0-9]{6}$/);
    if (driver.fastestLapRank !== null) finite(driver.fastestLapRank);
  }
  for (const lap of laps.laps) {
    assert.equal(new Set(lap.timings.map((timing) => timing.driverId)).size, lap.timings.length);
    for (const timing of lap.timings) {
      assert.ok(ids.has(timing.driverId));
      finite(timing.timeSeconds);
      finite(timing.position);
    }
  }
  for (const pit of pits.stops) {
    assert.ok(ids.has(pit.driverId));
    finite(pit.durationSeconds);
    assert.ok(pit.durationSeconds > 0);
  }
  let sampledPoints = 0, gapCount = 0;
  for (const driver of replay.drivers) {
    assert.ok(ids.has(driver.driverId));
    assert.ok(driver.points.length > 0);
    sampledPoints += driver.points.length;
    gapCount += driver.gaps.length;
    let previousTime = -1, previousBucket = -1;
    for (const point of driver.points) {
      assert.equal(point.length, 4);
      point.forEach(finite);
      assert.ok(point[0] >= 0 && point[0] <= replay.durationSeconds);
      assert.ok(point[0] > previousTime, 'Strict sample order');
      const bucket = Math.floor(point[0]);
      assert.ok(bucket > previousBucket, 'Maximum one observed sample per second bucket');
      previousBucket = bucket;
      previousTime = point[0];
    }
    for (const gap of driver.gaps) {
      finite(gap.from);
      finite(gap.to);
      assert.ok(gap.to - gap.from > 5);
      assert.ok(gap.from >= 0 && gap.to <= replay.durationSeconds);
    }
  }
  assert.equal(sampledPoints, replay.quality.sampledPoints);
  assert.equal(sampledPoints, quality.sampledPoints);
  assert.equal(gapCount, quality.gapCount);
  assert.ok(quality.rawPoints >= quality.racePoints && quality.racePoints >= sampledPoints);
  assert.ok(ids.has(replay.circuit.driverId));
  assert.ok(replay.circuit.points.length > 100);
  for (const point of replay.circuit.points) { assert.equal(point.length, 3); point.forEach(finite); }
  for (const source of replay.sources) assert.equal(source.sha256, sourceMap.get(source.url)?.sha256);
  console.log(`Verified ${prefix}: ${quality.rawPoints.toLocaleString('en-US')} raw; ${sampledPoints.toLocaleString('en-US')} samples; ${quality.lapTimingCount} timings; ${pits.stops.length} stops`);
}

const championship = await read('championship-2024.json');
assert.equal(championship.races.length, 24);
assert.equal(championship.races.filter((race) => race.sprintResults.length).length, 6);
const totals = new Map();
for (const [index, race] of championship.races.entries()) {
  assert.equal(race.round, index + 1);
  assert.ok(race.results.length >= 18 && race.results.length <= 20);
  assert.equal(new Set(race.results.map((driver) => driver.driverId)).size, race.results.length);
  for (const driver of [...race.results, ...race.sprintResults]) {
    finite(driver.points);
    totals.set(driver.driverId, (totals.get(driver.driverId) ?? 0) + driver.points);
  }
}
assert.equal(totals.get('max_verstappen'), 437);
assert.equal(totals.get('norris'), 374);
assert.equal(totals.get('leclerc'), 356);
console.log(`Verified all 24 rounds / 6 sprints; championship leaders 437 / 374 / 356 points; ${sourceMap.size} source hashes`);

if (process.argv.includes('--idempotence')) {
  const files = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === 'raw') continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name.endsWith('.json')) files.push(full);
    }
  }
  await walk(dataDir);
  const before = new Map(await Promise.all(files.map(async (file) => [file, sha256(await readFile(file))])));
  const { main } = await import('./ingest.mjs');
  await main(['--offline']);
  for (const file of files) assert.equal(sha256(await readFile(file)), before.get(file), `Idempotent output: ${file}`);
  console.log(`Verified byte-identical offline rebuild of ${files.length} JSON artifacts`);
}
