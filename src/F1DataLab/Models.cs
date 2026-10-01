namespace F1DataLab;

public sealed record ChampionshipData(int Year, List<ChampionshipRace> Races);
public sealed record ChampionshipRace(int Round, string Name, string Date,
    List<DriverResult> Results, List<DriverResult>? SprintResults);
public sealed record DriverResult(string DriverId, int Number, string Code, string Name,
    string Team, string Color, int Position, double Points, string Status,
    int? FastestLapRank, int Laps, int Grid = 0);
public sealed record ChampionshipResponse(int Year, string Scoring, double[] Points,
    bool IncludesSprints, List<ChampionshipFrame> Frames);
public sealed record ChampionshipFrame(int Round, string Name, List<Standing> Standings);
public sealed record Standing(string DriverId, string Code, string Name, string Team,
    string Color, double Points, int Rank);
public sealed record ImportSummary(int Files, int Imported, int Unchanged, long TelemetryPoints,
    long LapTimings, long PitStops, string CacheFile);

public sealed class DataValidationException(string message) : Exception(message);
