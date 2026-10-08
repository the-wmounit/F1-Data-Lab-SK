import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CachedSource, sha256, parseLapTime, sampleLocations, mergeLapPages, selectCircuit, jolpicaPages, locationWindows } from './ingest.mjs';

test('Lap times retain minute/hour precision and reject unavailable times', () => {
  assert.equal(parseLapTime('1:37.284'), 97.284);
  assert.equal(parseLapTime('1:02:03.456'), 3723.456);
  assert.equal(parseLapTime('45.125'), 45.125);
  assert.equal(parseLapTime(null), null);
  assert.equal(parseLapTime('bad'), null);
});

test('Downsampling preserves observed coordinates and times, sorts, deduplicates, and never fills gaps', () => {
  const origin = Date.parse('2024-03-02T15:00:00Z');
  const row = (t, x = t) => ({ date: new Date(origin + t * 1000).toISOString(), x, y: 10, z: -3 });
  const actual = sampleLocations([row(7.1), row(0.8), row(1.2), row(0.1), row(0.1), row(-2), row(8), row(2, null)], origin, origin + 7500);
  assert.deepEqual(actual.points, [[0.1, 0.1, 10, -3], [1.2, 1.2, 10, -3], [7.1, 7.1, 10, -3]]);
  assert.deepEqual(actual.gaps, [{ from: 1.2, to: 7.1 }]);
  assert.equal(actual.maxGapSeconds, 5.9);
  assert.equal(actual.invalidPoints, 1);
  assert.equal(actual.duplicatePoints, 1);
  assert.equal(actual.racePoints, 4);
});

test('A threshold gap of exactly 5 seconds is valid; empty streams remain empty', () => {
  assert.equal(sampleLocations([{ date: '2024-01-01T00:00:00Z', x: 0, y: 0, z: 0 },
    { date: '2024-01-01T00:00:05Z', x: 1, y: 1, z: 1 }], Date.parse('2024-01-01T00:00:00Z')).gaps.length, 0);
  assert.deepEqual(sampleLocations([], 0).points, []);
});

test('Jolpica pagination can split a lap across pages; timings are merged by driver identity', () => {
  const page = (lap, timings) => ({ MRData: { RaceTable: { Races: [{ Laps: [{ number: String(lap), Timings: timings }] }] } } });
  const laps = mergeLapPages([page(1, [{ driverId: 'a', position: '1', time: '1:30.000' }]),
    page(1, [{ driverId: 'b', position: '2', time: '1:31.500' }]),
    page(2, [{ driverId: 'a', position: '1', time: '1:29.500' }])]);
  assert.equal(laps.length, 2);
  assert.equal(laps[0].timings.length, 2);
  assert.equal(laps[0].timings[1].timeSeconds, 91.5);
});

test('Circuit selection refuses incomplete or missing telemetry rather than fabricating a track', () => {
  assert.throws(() => selectCircuit([], [{ driver_number: 1, lap_number: 5, date_start: '2024-01-01T00:00:00Z', lap_duration: 90 }],
    { number: 1, driverId: 'a' }, 57), /No complete clean circuit lap/);
});

test('Real committed OpenF1 sample is reproducible and every retained coordinate comes from a source record', async () => {
  const bytes = await readFile(new URL('../data/samples/location-bahrain.json', import.meta.url));
  const provenance = JSON.parse(await readFile(new URL('../data/samples/location-bahrain-source.json', import.meta.url), 'utf8'));
  assert.equal(sha256(bytes), provenance.subsetSha256);
  const rows = JSON.parse(bytes.toString('utf8')).filter((row) => row.driver_number === 1);
  const origin = Math.min(...rows.map((row) => Date.parse(row.date)));
  const sourceCoordinates = new Set(rows.map((row) => JSON.stringify([(Date.parse(row.date) - origin) / 1000, row.x, row.y, row.z])));
  for (const point of sampleLocations(rows, origin).points) assert.ok(sourceCoordinates.has(JSON.stringify(point)));
  assert.ok(rows.length > sampleLocations(rows, origin).points.length);
});

test('Jolpica pagination follows the returned limit rather than assuming the requested page size', async () => {
  const offsets = [];
  const client = { async get(url) {
    const offset = Number(new URL(url).searchParams.get('offset'));
    offsets.push(offset);
    return { MRData: { total: '5', limit: '2', offset: String(offset), RaceTable: { Races: [] } } };
  } };
  const pages = await jolpicaPages(client, '2024/results');
  assert.deepEqual(offsets, [0, 2, 4]);
  assert.equal(pages.length, 3);
});

test('Location windows cover a short session, retain empty windows, and include exact time boundaries', async () => {
  const urls = [];
  const client = { async get(url, options) {
    urls.push(url);
    assert.equal(options.allowEmpty, true);
    return urls.length === 2 ? [] : [{ driver_number: 1 }];
  } };
  const rows = await locationWindows(client, { session_key: 9472, date_start: '2024-03-02T15:00:00Z', date_end: '2024-03-02T15:00:25Z' }, 10);
  assert.equal(urls.length, 3);
  assert.equal(rows.length, 2);
  assert.equal(new URL(urls[1]).searchParams.get('date>'), '2024-03-02T15:00:09.999Z');
  assert.equal(new URL(urls[2]).searchParams.get('date<'), '2024-03-02T15:00:25.000Z');
});

test('Offline raw cache verifies content hashes and returns identical source metadata', async () => {
  const rawDir = await mkdtemp(path.join(tmpdir(), 'f1-data-cache-test-'));
  try {
    const url = 'https://api.openf1.org/v1/sessions?year=2024';
    const key = sha256(url);
    const raw = '[{"session_key":9472}]';
    const metadata = { url, fetchedAt: '2026-10-01T00:00:00Z', sha256: sha256(raw), bytes: Buffer.byteLength(raw) };
    await writeFile(path.join(rawDir, `${key}.json`), raw);
    await writeFile(path.join(rawDir, `${key}.meta.json`), JSON.stringify(metadata));
    const client = new CachedSource({ rawDir, offline: true });
    assert.deepEqual(await client.get(url), [{ session_key: 9472 }]);
    assert.deepEqual(client.manifest(), [metadata]);
    await writeFile(path.join(rawDir, `${key}.json`), '[{}]');
    await assert.rejects(client.get(url), /cache hash mismatch/);
    assert.equal(await readFile(path.join(rawDir, `${key}.json`), 'utf8'), '[{}]');
  } finally { await rm(rawDir, { recursive: true, force: true }); }
});
