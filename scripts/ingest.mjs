import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OPENF1 = 'https://api.openf1.org/v1';
const JOLPICA = 'https://api.jolpi.ca/ergast/f1';
const TEAM_COLORS = {
  red_bull: '#3671C6', ferrari: '#E8002D', mercedes: '#27F4D2', mclaren: '#FF8000',
  aston_martin: '#229971', alpine: '#FF87BC', williams: '#64C4FF', rb: '#6692FF',
  sauber: '#52E252', haas: '#B6BABD', alphatauri: '#6692FF', alfa: '#52E252',
};

export const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const seconds = (ms) => Math.round(ms) / 1000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function parseLapTime(value) {
  if (typeof value !== 'string' || !/^\d+(?::\d{2})*\.\d+$/.test(value)) return null;
  return Math.round(value.split(':').reduce((sum, part) => sum * 60 + Number(part), 0) * 1000) / 1000;
}

export function normalizeResult(row, openDrivers = []) {
  const driver = row.Driver;
  const telemetry = openDrivers.find((item) => item.driver_number === Number(row.number));
  return {
    driverId: driver.driverId, number: Number(row.number ?? driver.permanentNumber),
    code: driver.code ?? telemetry?.name_acronym ?? driver.driverId.slice(0, 3).toUpperCase(),
    name: `${driver.givenName} ${driver.familyName}`, team: row.Constructor.name,
    color: telemetry?.team_colour ? `#${telemetry.team_colour.toUpperCase()}` : TEAM_COLORS[row.Constructor.constructorId] ?? '#94A3B8',
    position: Number(row.position), grid: Number(row.grid), laps: Number(row.laps), points: Number(row.points),
    status: row.status, fastestLapRank: row.FastestLap ? Number(row.FastestLap.rank) : null,
  };
}

export function mergeLapPages(pages) {
  const byLap = new Map();
  for (const page of pages) {
    for (const race of page.MRData.RaceTable.Races) {
      for (const lap of race.Laps ?? []) {
        const number = Number(lap.number);
        if (!byLap.has(number)) byLap.set(number, new Map());
        for (const timing of lap.Timings) byLap.get(number).set(timing.driverId, {
          driverId: timing.driverId, position: Number(timing.position), timeSeconds: parseLapTime(timing.time),
        });
      }
    }
  }
  return [...byLap].sort(([a], [b]) => a - b).map(([lap, timings]) => ({
    lap, timings: [...timings.values()].sort((a, b) => a.position - b.position || a.driverId.localeCompare(b.driverId)),
  }));
}

/** Retain an actual observation per elapsed-second bucket; never synthesize a point. */
export function sampleLocations(rows, originMs, endMs = Infinity) {
  const valid = [];
  let invalidPoints = 0;
  for (const row of rows) {
    const dateMs = Date.parse(row.date);
    if (!Number.isFinite(dateMs) || ![row.x, row.y, row.z].every(Number.isFinite)) {
      invalidPoints++;
      continue;
    }
    if (dateMs >= originMs && dateMs <= endMs) valid.push({ ...row, dateMs });
  }
  valid.sort((a, b) => a.dateMs - b.dateMs);
  const unique = valid.filter((point, index) => index === 0 || point.dateMs !== valid[index - 1].dateMs);
  const gaps = [];
  let maxGapSeconds = 0;
  for (let i = 1; i < unique.length; i++) {
    const gap = seconds(unique[i].dateMs - unique[i - 1].dateMs);
    maxGapSeconds = Math.max(maxGapSeconds, gap);
    if (gap > 5) gaps.push({ from: seconds(unique[i - 1].dateMs - originMs), to: seconds(unique[i].dateMs - originMs) });
  }
  const points = [];
  let previousBucket = -1;
  for (const row of unique) {
    const bucket = Math.floor((row.dateMs - originMs) / 1000);
    if (bucket !== previousBucket) {
      points.push([seconds(row.dateMs - originMs), row.x, row.y, row.z]);
      previousBucket = bucket;
    }
  }
  return { points, gaps, maxGapSeconds, invalidPoints, duplicatePoints: valid.length - unique.length, racePoints: unique.length };
}

/** Choose an observed complete leader lap with no timing gaps or pit lane lap. */
export function selectCircuit(rows, laps, leader, totalLaps) {
  const candidates = laps.filter((lap) => lap.driver_number === leader.number && lap.lap_number >= 5 &&
    lap.lap_number <= totalLaps - 2 && lap.lap_duration > 50 && lap.lap_duration < 180 &&
    lap.date_start && !lap.is_pit_out_lap).sort((a, b) => a.lap_number - b.lap_number);
  for (const lap of candidates) {
    const start = Date.parse(lap.date_start);
    const end = start + lap.lap_duration * 1000;
    const points = rows.filter((row) => row.driver_number === leader.number && Date.parse(row.date) >= start &&
      Date.parse(row.date) <= end && [row.x, row.y, row.z].every(Number.isFinite)).sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
    if (points.length < 100 || Date.parse(points[0].date) - start > 1000 || end - Date.parse(points.at(-1).date) > 1000) continue;
    const hasGap = points.some((row, index) => index > 0 && Date.parse(row.date) - Date.parse(points[index - 1].date) > 1000);
    // Avoid a pit-in lap even if the source marks only the following pit-out lap.
    const nextLap = laps.find((row) => row.driver_number === leader.number && row.lap_number === lap.lap_number + 1);
    if (hasGap || nextLap?.is_pit_out_lap) continue;
    const xyz = points.map((point) => [point.x, point.y, point.z]);
    const span = Math.max(...xyz.map((p) => p[0])) - Math.min(...xyz.map((p) => p[0]));
    const closure = Math.hypot(xyz[0][0] - xyz.at(-1)[0], xyz[0][1] - xyz.at(-1)[1]);
    if (span < 500 || closure > span * 0.12) continue;
    return { driverId: leader.driverId, lap: lap.lap_number, points: xyz };
  }
  throw new Error(`No complete clean circuit lap for ${leader.driverId}; do not substitute invented coordinates.`);
}

export class CachedSource {
  constructor({ rawDir = path.join(ROOT, 'data/raw'), refresh = false, offline = false } = {}) {
    this.rawDir = rawDir;
    this.refresh = refresh;
    this.offline = offline;
    this.sources = new Map();
    this.requests = new Map();
  }
  async get(url, { allowEmpty = false } = {}) {
    const key = sha256(url);
    const rawPath = path.join(this.rawDir, `${key}.json`);
    const metadataPath = path.join(this.rawDir, `${key}.meta.json`);
    if (!this.refresh || this.offline) {
      try {
        const [raw, metadataText] = await Promise.all([readFile(rawPath), readFile(metadataPath, 'utf8')]);
        const metadata = JSON.parse(metadataText);
        if (metadata.url !== url || metadata.sha256 !== sha256(raw)) throw new Error('cache hash mismatch');
        const parsed = JSON.parse(raw.toString('utf8'));
        this.sources.set(url, metadata);
        console.log(`cache ${url}`);
        return metadata.emptyResult ? [] : parsed;
      } catch (error) {
        if (this.offline) throw new Error(`Offline cache unavailable or corrupt: ${url} (${error.message})`);
      }
    }
    const host = new URL(url).hostname;
    for (let attempt = 0; attempt < 5; attempt++) {
      // OpenF1's unauthenticated ceiling is 30/minute; 2.1s minimum spacing also stays below 3/s.
      const delay = host === 'api.openf1.org' ? 2100 : 350;
      await sleep(Math.max(0, (this.requests.get(host) ?? 0) + delay - Date.now()));
      this.requests.set(host, Date.now());
      console.log(`fetch ${url}`);
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(240_000), headers: { 'User-Agent': 'F1DataLab-EducationalOfflineFixture/1.0' } });
        let raw, parsed, emptyResult = false;
        if (response.status === 404 && allowEmpty) {
          raw = Buffer.from(await response.arrayBuffer());
          parsed = JSON.parse(raw.toString('utf8'));
          emptyResult = parsed.detail === 'No results found.';
        }
        if (!response.ok && !emptyResult) {
          const retryable = response.status === 429 || response.status >= 500;
          if (!retryable) throw new Error(`HTTP ${response.status} ${url}`);
          const retryHeader = response.headers.get('retry-after');
          const wait = retryHeader && Number.isFinite(Number(retryHeader)) ? Number(retryHeader) * 1000 : (attempt + 1) * 5000;
          if (attempt === 4) throw new Error(`HTTP ${response.status} after retries ${url}`);
          await sleep(wait);
          continue;
        }
        raw ??= Buffer.from(await response.arrayBuffer());
        parsed ??= JSON.parse(raw.toString('utf8'));
        if (!emptyResult && (parsed?.error || parsed?.detail)) throw new Error(`API error: ${JSON.stringify(parsed).slice(0, 500)}`);
        const metadata = { url, fetchedAt: new Date().toISOString(), sha256: sha256(raw), bytes: raw.length };
        if (emptyResult) Object.assign(metadata, { httpStatus: 404, emptyResult: true });
        await mkdir(this.rawDir, { recursive: true });
        await writeFile(`${rawPath}.tmp`, raw);
        await rename(`${rawPath}.tmp`, rawPath);
        await writeFile(`${metadataPath}.tmp`, JSON.stringify(metadata));
        await rename(`${metadataPath}.tmp`, metadataPath);
        this.sources.set(url, metadata);
        console.log(`received ${raw.length.toLocaleString('en-US')} bytes / ${Array.isArray(parsed) ? parsed.length.toLocaleString('en-US') + ' rows' : 'JSON'}`);
        return emptyResult ? [] : parsed;
      } catch (error) {
        if (attempt === 4 || /^HTTP [234]/.test(error.message)) throw error;
        console.warn(`retry ${attempt + 1}: ${error.message}`);
        await sleep((attempt + 1) * 5000);
      }
    }
    throw new Error(`Exhausted retries ${url}`);
  }
  manifest(urls = null) {
    const selected = urls ? new Set(urls) : null;
    return [...this.sources.values()].filter((source) => !selected || selected.has(source.url)).sort((a, b) => a.url.localeCompare(b.url));
  }
}

export async function jolpicaPages(client, endpoint) {
  const pages = [];
  let offset = 0;
  let total = 1;
  while (offset < total) {
    const url = `${JOLPICA}/${endpoint}.json?limit=100&offset=${offset}`;
    const page = await client.get(url);
    const metadata = page.MRData;
    if (!metadata || !Array.isArray(metadata.RaceTable?.Races)) throw new Error(`Unexpected Jolpica schema: ${url}`);
    const limit = Number(metadata.limit);
    total = Number(metadata.total);
    if (!Number.isInteger(limit) || limit < 1 || !Number.isInteger(total) || total < 0) throw new Error(`Invalid pagination: ${url}`);
    if (Number(metadata.offset) !== offset) throw new Error(`Pagination offset mismatch: ${url}`);
    pages.push(page);
    offset += limit;
  }
  return pages;
}

async function writeJson(relative, value, compact = false) {
  const filename = path.join(ROOT, 'data', relative);
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(`${filename}.tmp`, JSON.stringify(value, null, compact ? undefined : 2) + '\n');
  await rename(`${filename}.tmp`, filename);
}

export async function locationWindows(client, session, windowSeconds = 600) {
  const rows = [];
  const start = Date.parse(session.date_start);
  const end = Date.parse(session.date_end);
  if (!(end > start) || windowSeconds < 1) throw new Error('Invalid location window');
  for (let from = start; from < end; from += windowSeconds * 1000) {
    const to = Math.min(from + windowSeconds * 1000, end);
    // Strict OpenF1 date filters: the 1ms lead-in includes observations exactly on a boundary.
    const url = `${OPENF1}/location?session_key=${session.session_key}&date%3E=${encodeURIComponent(new Date(from - 1).toISOString())}&date%3C=${encodeURIComponent(new Date(to).toISOString())}`;
    const chunk = await client.get(url, { allowEmpty: true });
    if (!Array.isArray(chunk)) throw new Error(`Unexpected location schema: ${url}`);
    rows.push(...chunk);
  }
  return rows;
}

function mergeRaces(pages, property) {
  const races = new Map();
  for (const page of pages) {
    for (const race of page.MRData.RaceTable.Races) {
      const round = Number(race.round);
      if (!races.has(round)) races.set(round, { ...race, [property]: [] });
      races.get(round)[property].push(...(race[property] ?? []));
    }
  }
  return [...races.values()].sort((a, b) => Number(a.round) - Number(b.round));
}

export async function ingestRace(client, year, round, sessions) {
  const resultsPages = await jolpicaPages(client, `${year}/${round}/results`);
  const race = mergeRaces(resultsPages, 'Results')[0];
  if (!race) throw new Error(`No results for ${year}/${round}`);
  // Dates and circuit metadata identify sessions; no hard-coded source IDs.
  const session = sessions.find((candidate) => candidate.session_name === 'Race' && candidate.date_start.slice(0, 10) === race.date);
  if (!session) throw new Error(`No OpenF1 race session on ${race.date}`);
  const sessionKey = session.session_key;
  const openDrivers = await client.get(`${OPENF1}/drivers?session_key=${sessionKey}`);
  const drivers = race.Results.map((row) => normalizeResult(row, openDrivers)).sort((a, b) => a.position - b.position);
  await writeJson(`${year}/${round}/results.json`, { year, round, drivers });

  const lapPages = await jolpicaPages(client, `${year}/${round}/laps`);
  const laps = mergeLapPages(lapPages);
  await writeJson(`${year}/${round}/laps.json`, { year, round, laps });
  const pitPages = await jolpicaPages(client, `${year}/${round}/pitstops`);
  const stops = mergeRaces(pitPages, 'PitStops').flatMap((item) => item.PitStops).map((row) => ({
    driverId: row.driverId, lap: Number(row.lap), stop: Number(row.stop), durationSeconds: parseLapTime(row.duration), time: row.time,
  })).sort((a, b) => a.lap - b.lap || a.driverId.localeCompare(b.driverId));
  await writeJson(`${year}/${round}/pits.json`, { year, round, stops });

  const openLaps = await client.get(`${OPENF1}/laps?session_key=${sessionKey}`);
  const leader = drivers[0];
  const firstLap = openLaps.find((row) => row.driver_number === leader.number && row.lap_number === 1 && row.date_start);
  const originMs = Date.parse(firstLap?.date_start ?? session.date_start);
  const finishes = openLaps.filter((row) => {
    const driver = drivers.find((candidate) => candidate.number === row.driver_number);
    return driver && row.lap_number <= driver.laps && row.date_start && row.lap_duration > 0;
  }).map((row) => Date.parse(row.date_start) + row.lap_duration * 1000).filter(Number.isFinite);
  const endMs = Math.min(Date.parse(session.date_end), Math.max(...finishes));
  if (!(endMs > originMs)) throw new Error('Invalid race time bounds');
  const locations = await locationWindows(client, { ...session, date_end: new Date(endMs).toISOString() });
  if (!Array.isArray(locations) || locations.length < 1000) throw new Error('Location response absent or unexpectedly truncated');
  const byNumber = new Map(drivers.map((driver) => [driver.number, []]));
  let unknownDriverPoints = 0;
  for (const row of locations) {
    if (byNumber.has(row.driver_number)) byNumber.get(row.driver_number).push(row);
    else unknownDriverPoints++;
  }
  let invalidPoints = 0, duplicatePoints = 0, racePoints = 0, maxGapSeconds = 0;
  const replayDrivers = drivers.map((driver) => {
    const sample = sampleLocations(byNumber.get(driver.number), originMs, endMs);
    invalidPoints += sample.invalidPoints;
    duplicatePoints += sample.duplicatePoints;
    racePoints += sample.racePoints;
    maxGapSeconds = Math.max(maxGapSeconds, sample.maxGapSeconds);
    const { driverId, number, code, name, team, color } = driver;
    return { driverId, number, code, name, team, color, points: sample.points, gaps: sample.gaps };
  });
  if (replayDrivers.some((driver) => driver.points.length === 0)) throw new Error('A result driver has no location observations');
  const circuit = selectCircuit(byNumber.get(leader.number), openLaps, leader, leader.laps);
  const notes = [
    'OpenF1 location is approximate local Cartesian telemetry with an arbitrary origin; not calibrated geographic GPS.',
    'Original z is retained but is not verified elevation above sea level; lateral placement and apparent passing distances are unreliable.',
    'One actual observation is retained per elapsed-second bucket. Exact sample timestamps are kept; missing seconds are not filled.',
    'Interior gaps longer than 5 seconds are reported before downsampling. Start/end absence can also reflect retirement or sensor availability.',
    'Race bounds use the winner first-lap timestamp and the last completed classified lap across drivers; formation and cooldown data are excluded.',
    'The source can keep publishing stationary coordinates after retirement; absence of time gaps does not establish that a car is still racing.',
    'Pit durations come from Jolpica and may represent pit lane transit time, not stationary tire-change time.',
  ];
  const sourceUrls = [...client.sources.keys()].filter((url) => url.includes(`/${year}/${round}/`) || url.includes(`session_key=${sessionKey}`));
  // Session catalog was fetched before this race and is needed for provenance too.
  sourceUrls.push(`${OPENF1}/sessions?year=${year}&session_name=Race`);
  const sources = client.manifest(sourceUrls);
  const quality = { rawPoints: locations.length, sampledPoints: replayDrivers.reduce((sum, driver) => sum + driver.points.length, 0),
    gapCount: replayDrivers.reduce((sum, driver) => sum + driver.gaps.length, 0), maxGapSeconds, notes };
  const replay = { schemaVersion: 1, year, round, sessionKey, originUtc: new Date(originMs).toISOString(),
    durationSeconds: seconds(endMs - originMs), sampleHz: 1, coordinateSystem: 'OpenF1 local coordinates (approximate)',
    circuit, drivers: replayDrivers, quality, sources };
  await writeJson(`${year}/${round}/replay.json`, replay, true);
  await writeJson(`${year}/${round}/quality.json`, {
    schemaVersion: 1, year, round, sessionKey, ...quality, racePoints, invalidPoints, duplicatePoints, unknownDriverPoints,
    excludedOutsideRace: locations.length - racePoints - invalidPoints - duplicatePoints - unknownDriverPoints,
    lapTimingCount: laps.reduce((sum, lap) => sum + lap.timings.length, 0), pitStopCount: stops.length,
    driverCount: drivers.length, circuitLap: circuit.lap, circuitPoints: circuit.points.length,
    drivers: replayDrivers.map((driver) => ({ driverId: driver.driverId, sampledPoints: driver.points.length,
      firstSampleSeconds: driver.points[0]?.[0] ?? null, lastSampleSeconds: driver.points.at(-1)?.[0] ?? null,
      gaps: driver.gaps, classifiedLaps: drivers.find((row) => row.driverId === driver.driverId).laps })),
    sources,
  });
  console.log(`READY ${year}/${round}: ${quality.rawPoints} raw -> ${quality.sampledPoints} samples; ${quality.gapCount} gaps; circuit lap ${circuit.lap}`);
  return { year, round, name: race.raceName, circuit: race.Circuit.circuitName, country: race.Circuit.Location.country,
    date: race.date, laps: leader.laps, sessionKey };
}

async function ingestChampionship(client, year) {
  const resultPages = await jolpicaPages(client, `${year}/results`);
  const sprintPages = await jolpicaPages(client, `${year}/sprint`);
  const sprints = new Map(mergeRaces(sprintPages, 'SprintResults').map((race) => [Number(race.round), race.SprintResults.map((row) => normalizeResult(row))]));
  const races = mergeRaces(resultPages, 'Results').map((race) => ({ round: Number(race.round), name: race.raceName,
    date: race.date, results: race.Results.map((row) => normalizeResult(row)).sort((a, b) => a.position - b.position),
    sprintResults: (sprints.get(Number(race.round)) ?? []).sort((a, b) => a.position - b.position) }));
  if (races.length !== 24) throw new Error(`Expected all 24 completed 2024 rounds, received ${races.length}`);
  const sources = client.manifest([...client.sources.keys()].filter((url) => url.includes(`/${year}/results.json`) || url.includes(`/${year}/sprint.json`)));
  await writeJson(`championship-${year}.json`, { year, races, sources });
  console.log(`READY championship ${year}: ${races.length} races / ${races.filter((race) => race.sprintResults.length).length} sprints`);
}

export async function main(args = process.argv.slice(2)) {
  const refresh = args.includes('--refresh');
  const offline = args.includes('--offline');
  const rounds = (args.find((arg) => arg.startsWith('--rounds='))?.split('=')[1] ?? '1,2').split(',').map(Number);
  if (rounds.some((round) => ![1, 2].includes(round))) throw new Error('Available fixture rounds: --rounds=1,2');
  if (refresh && offline) throw new Error('--refresh and --offline are mutually exclusive');
  const client = new CachedSource({ refresh, offline });
  const year = 2024;
  const sessions = await client.get(`${OPENF1}/sessions?year=${year}&session_name=Race`);
  let existing = [];
  try { existing = JSON.parse(await readFile(path.join(ROOT, 'data/catalog.json'), 'utf8')).races; } catch { /* first run */ }
  for (const round of rounds) {
    const catalogRace = await ingestRace(client, year, round, sessions);
    existing = [...existing.filter((race) => race.year !== year || race.round !== round), catalogRace].sort((a, b) => a.year - b.year || a.round - b.round);
    await writeJson('catalog.json', { schemaVersion: 1, races: existing });
  }
  if (!args.includes('--skip-championship')) await ingestChampionship(client, year);
  const priorSources = new Map();
  try {
    const prior = JSON.parse(await readFile(path.join(ROOT, 'data/source-manifest.json'), 'utf8'));
    for (const source of prior.sources) priorSources.set(source.url, source);
  } catch { /* first run */ }
  for (const source of client.manifest()) priorSources.set(source.url, source);
  await writeJson('source-manifest.json', { schemaVersion: 1, generatedAt: [...priorSources.values()].map((source) => source.fetchedAt).sort().at(-1),
    sources: [...priorSources.values()].sort((a, b) => a.url.localeCompare(b.url)) });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}
