using System.Text.Json;
using F1DataLab;

var count = 0;
try
{
    Run("validation custom", CustomValidation);
    Run("barèmes et bonus de meilleur tour", ScoringAndBonus);
    Run("sprint conservé et classement déterministe", SprintAndTieBreak);
    Run("abandon classé à 90% et disqualification", Classification);
    Run("import idempotent et rollback atomique", ImportAndRollback);
    var realData = Path.Combine(LocateRoot(), "data", "championship-2024.json");
    if (File.Exists(realData)) Run("saison 2024 : concordance des points officiels", () => OfficialSeason(realData));
    else Console.WriteLine("SKIP : fixtures 2024 absentes (relancer après ingestion)");
    Console.WriteLine($"PASS : {count} vérifications métier/SQLite.");
}
catch (Exception exception)
{
    Console.Error.WriteLine($"FAIL : {exception}");
    Environment.ExitCode = 1;
}

void Run(string name, Action test)
{
    test();
    count++;
    Console.WriteLine($"PASS : {name}");
}

static DriverResult Driver(string id, int position, double points = 0, string status = "Finished",
    int laps = 57, int? fastest = null) => new(id, position, id.ToUpperInvariant(), id, "Team", "#112233",
        position, points, status, fastest, laps);

static ChampionshipRace Race(int round, List<DriverResult> drivers, List<DriverResult>? sprint = null)
    => new(round, $"Round {round}", "2024-01-01", drivers, sprint);

static void Equal<T>(T expected, T actual)
{
    if (!EqualityComparer<T>.Default.Equals(expected, actual))
        throw new InvalidOperationException($"Expected {expected}, actual {actual}");
}

static void Reject(Action action)
{
    try { action(); }
    catch (DataValidationException) { return; }
    throw new InvalidOperationException("Expected a data validation failure.");
}

static void CustomValidation()
{
    foreach (var value in new[] { "", "1,-1", "1,2", "NaN", "Infinity", "-Infinity", "25,x", "1e999", string.Join(',', Enumerable.Repeat("1", 31)) })
        Reject(() => ChampionshipCalculator.ParseScoring("custom", value));
    Reject(() => ChampionshipCalculator.ParseScoring("2025", null));
    Equal(3, ChampionshipCalculator.ParseScoring("custom", "10,10,0").Length);
    Equal(2.5, ChampionshipCalculator.ParseScoring("custom", "2.5,1.5")[0]);
}

static void ScoringAndBonus()
{
    var drivers = new List<DriverResult> { Driver("a", 1, 25), Driver("b", 2, 19, fastest: 1), Driver("c", 11, fastest: 2) };
    var data = new ChampionshipData(2024, [Race(1, drivers)]);
    var modern = ChampionshipCalculator.Calculate(data, "2024", null).Frames[0].Standings;
    var legacy = ChampionshipCalculator.Calculate(data, "2010", null).Frames[0].Standings;
    Equal(19d, modern.Single(s => s.DriverId == "b").Points);
    Equal(18d, legacy.Single(s => s.DriverId == "b").Points);
    Equal(7d, ChampionshipCalculator.Calculate(data, "custom", "10,7").Frames[0].Standings.Single(s => s.DriverId == "b").Points);
    drivers[1] = Driver("b", 2, 18, fastest: 2);
    drivers[2] = Driver("c", 11, fastest: 1);
    Equal(0d, ChampionshipCalculator.Calculate(data, "2024", null).Frames[0].Standings.Single(s => s.DriverId == "c").Points);
}

static void SprintAndTieBreak()
{
    var data = new ChampionshipData(2024,
    [
        Race(2, [Driver("z", 11), Driver("a", 12), Driver("b", 20)], [Driver("sprint", 1, 8)]),
        Race(1, [Driver("z", 12), Driver("a", 13), Driver("b", 20)])
    ]);
    var response = ChampionshipCalculator.Calculate(data, "custom", "0");
    Equal(1, response.Frames[0].Round);
    Equal("sprint", response.Frames[1].Standings[0].DriverId);
    Equal(8d, response.Frames[1].Standings[0].Points);
    Equal("z", response.Frames[1].Standings[1].DriverId); // P11 matters in a zero-point tie.
    Equal("a", response.Frames[1].Standings[2].DriverId);
    var identical = new ChampionshipData(2024, [Race(1, [Driver("z", 1), Driver("a", 1)])]);
    Equal("a", ChampionshipCalculator.Calculate(identical, "custom", "0").Frames[0].Standings[0].DriverId);
}

static void Classification()
{
    var data = new ChampionshipData(2024, [Race(1,
    [
        Driver("winner", 1, 25),
        Driver("late", 12, status: "Engine", laps: 55),
        Driver("early", 13, status: "Engine", laps: 20),
        Driver("dsq", 2, status: "Disqualified", laps: 57),
        Driver("classified", 10, points: 1, status: "Engine", laps: 50)
    ])]);
    var custom = string.Join(',', Enumerable.Range(1, 20).Select(i => 21 - i));
    var result = ChampionshipCalculator.Calculate(data, "custom", custom).Frames[0].Standings;
    Equal(9d, result.Single(s => s.DriverId == "late").Points);
    Equal(0d, result.Single(s => s.DriverId == "early").Points);
    Equal(0d, result.Single(s => s.DriverId == "dsq").Points);
    Equal(11d, result.Single(s => s.DriverId == "classified").Points);
}

static void ImportAndRollback()
{
    var testRoot = Path.GetFullPath(Path.Combine(LocateRoot(), ".cache", "selftests"));
    var directory = Path.GetFullPath(Path.Combine(testRoot, Guid.NewGuid().ToString("N")));
    if (!directory.StartsWith(testRoot + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
        throw new InvalidOperationException("Test output escaped the intended directory.");
    Directory.CreateDirectory(Path.Combine(directory, "data", "2024", "1"));
    var fixtureDir = Path.Combine(directory, "data");
    var replayPath = Path.Combine(fixtureDir, "2024", "1", "replay.json");
    var catalogPath = Path.Combine(fixtureDir, "catalog.json");
    const string replay = """{"year":2024,"round":1,"sampleHz":1,"drivers":[{"driverId":"a","points":[[0,1,2,3],[1,2,3,4],[12,3,4,5]],"gaps":[{"from":1,"to":12}]}]}""";
    File.WriteAllText(catalogPath, "{\"schemaVersion\":1,\"races\":[]}");
    File.WriteAllText(replayPath, replay);
    using (var store = new DataStore(Path.Combine(directory, "test.sqlite")))
    {
        var first = store.Import(fixtureDir);
        Equal(2, first.Imported);
        Equal(3L, first.TelemetryPoints);
        var second = store.Import(fixtureDir);
        Equal(0, second.Imported);
        Equal(2, second.Unchanged);
        Equal(3L, second.TelemetryPoints); // Gap preserved; no synthesized intermediate points.
        File.WriteAllText(catalogPath, "{\"schemaVersion\":2,\"races\":[]}");
        File.WriteAllText(replayPath, replay.Replace("[12,3,4,5]", "[1,3,4,5]"));
        Reject(() => store.Import(fixtureDir));
        Equal("{\"schemaVersion\":1,\"races\":[]}", store.LoadSnapshots()["catalog.json"].Json);
        Equal(replay, store.LoadSnapshots()["2024/1/replay.json"].Json);
        File.WriteAllText(replayPath, replay);
        File.WriteAllText(catalogPath, "{\"schemaVersion\":1,\"races\":[]}");
        Equal(2, store.Import(fixtureDir).Unchanged);
        File.Delete(replayPath);
        Equal(0L, store.Import(fixtureDir).TelemetryPoints); // Cascades reconcile an obsolete snapshot.
    }
    // SQLite pools may briefly retain files on Windows; outputs stay under ignored .cache/selftests.
}

static void OfficialSeason(string path)
{
    var data = JsonSerializer.Deserialize<ChampionshipData>(File.ReadAllText(path), new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
    var expected = data.Races.SelectMany(r => r.Results.Concat(r.SprintResults ?? []))
        .GroupBy(d => d.DriverId).ToDictionary(group => group.Key, group => group.Sum(d => d.Points));
    var response = ChampionshipCalculator.Calculate(data, "2024", null);
    Equal(24, response.Frames.Count);
    foreach (var standing in response.Frames[^1].Standings) Equal(expected[standing.DriverId], standing.Points);
    Equal(437d, response.Frames[^1].Standings.Single(s => s.DriverId == "max_verstappen").Points);
    Equal(374d, response.Frames[^1].Standings.Single(s => s.DriverId == "norris").Points);
    Equal(356d, response.Frames[^1].Standings.Single(s => s.DriverId == "leclerc").Points);
}

static string LocateRoot()
{
    var directory = new DirectoryInfo(Directory.GetCurrentDirectory());
    while (directory is not null)
    {
        if (File.Exists(Path.Combine(directory.FullName, "docs", "data-contract.md"))) return directory.FullName;
        directory = directory.Parent;
    }
    throw new DirectoryNotFoundException("Run selftests from the repository.");
}
