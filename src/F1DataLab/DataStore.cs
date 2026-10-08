using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Data.Sqlite;

namespace F1DataLab;

public sealed record CachedDataset(string RelativePath, string Json, string Sha256);

/// <summary>Immutable local JSON snapshots plus inspectable, normalized tables in SQLite.</summary>
public sealed class DataStore : IDisposable
{
    public const int SchemaVersion = 1;
    private readonly SqliteConnection connection;
    public string CacheFile { get; }

    public DataStore(string cacheFile)
    {
        CacheFile = Path.GetFullPath(cacheFile);
        Directory.CreateDirectory(Path.GetDirectoryName(CacheFile)!);
        connection = new SqliteConnection(new SqliteConnectionStringBuilder
        {
            DataSource = CacheFile,
            ForeignKeys = true,
            DefaultTimeout = 30
        }.ToString());
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = """
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS datasets (
                path TEXT PRIMARY KEY, sha256 TEXT NOT NULL, json TEXT NOT NULL, imported_utc TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS race_results (
                source_path TEXT NOT NULL REFERENCES datasets(path) ON DELETE CASCADE,
                year INTEGER NOT NULL, round INTEGER NOT NULL, sprint INTEGER NOT NULL,
                driver_id TEXT NOT NULL, position INTEGER NOT NULL, laps INTEGER NOT NULL,
                points REAL NOT NULL, status TEXT NOT NULL, fastest_lap_rank INTEGER,
                PRIMARY KEY(source_path, round, sprint, driver_id)
            );
            CREATE TABLE IF NOT EXISTS lap_timings (
                source_path TEXT NOT NULL REFERENCES datasets(path) ON DELETE CASCADE,
                year INTEGER NOT NULL, round INTEGER NOT NULL, lap INTEGER NOT NULL,
                driver_id TEXT NOT NULL, position INTEGER NOT NULL, time_seconds REAL NOT NULL,
                PRIMARY KEY(source_path, lap, driver_id)
            );
            CREATE TABLE IF NOT EXISTS pit_stops (
                source_path TEXT NOT NULL REFERENCES datasets(path) ON DELETE CASCADE,
                year INTEGER NOT NULL, round INTEGER NOT NULL, driver_id TEXT NOT NULL,
                lap INTEGER NOT NULL, stop INTEGER NOT NULL, duration_seconds REAL NOT NULL,
                PRIMARY KEY(source_path, driver_id, stop)
            );
            CREATE TABLE IF NOT EXISTS telemetry (
                source_path TEXT NOT NULL REFERENCES datasets(path) ON DELETE CASCADE,
                year INTEGER NOT NULL, round INTEGER NOT NULL, driver_id TEXT NOT NULL,
                t REAL NOT NULL, x REAL NOT NULL, y REAL NOT NULL, z REAL NOT NULL,
                PRIMARY KEY(source_path, driver_id, t)
            );
            CREATE INDEX IF NOT EXISTS ix_telemetry_session ON telemetry(year, round, driver_id, t);
            PRAGMA user_version=1;
            """;
        command.ExecuteNonQuery();
    }

    public ImportSummary Import(string dataDirectory)
    {
        var root = Path.GetFullPath(dataDirectory);
        var files = Directory.Exists(root)
            ? Directory.GetFiles(root, "*.json", SearchOption.AllDirectories)
                .Where(path => IsSnapshot(Path.GetRelativePath(root, path).Replace('\\', '/')))
                .Order(StringComparer.Ordinal).ToArray()
            : [];
        var imported = 0;
        var unchanged = 0;
        // A failed validation rolls back the whole import, including deletion of obsolete snapshots.
        using var transaction = connection.BeginTransaction();
        var present = new HashSet<string>(StringComparer.Ordinal);
        foreach (var file in files)
        {
            var relative = Path.GetRelativePath(root, file).Replace('\\', '/');
            present.Add(relative);
            var payload = File.ReadAllText(file, Encoding.UTF8);
            var hash = Sha256(payload);
            using var existing = connection.CreateCommand();
            existing.Transaction = transaction;
            existing.CommandText = "SELECT sha256 FROM datasets WHERE path=$path";
            existing.Parameters.AddWithValue("$path", relative);
            if ((string?)existing.ExecuteScalar() == hash)
            {
                unchanged++;
                continue;
            }
            JsonDocument document;
            try { document = JsonDocument.Parse(payload); }
            catch (JsonException exception)
            {
                throw new DataValidationException($"JSON invalide ({relative}) : {exception.Message}");
            }
            using (document)
            {
                if (document.RootElement.ValueKind != JsonValueKind.Object)
                    throw new DataValidationException($"{relative} doit contenir un objet JSON.");
                Execute(transaction, "DELETE FROM datasets WHERE path=$path", ("$path", relative));
                Execute(transaction,
                    "INSERT INTO datasets(path,sha256,json,imported_utc) VALUES($path,$hash,$json,$utc)",
                    ("$path", relative), ("$hash", hash), ("$json", payload),
                    ("$utc", DateTimeOffset.UtcNow.ToString("O")));
                try { Normalize(transaction, relative, document.RootElement); }
                catch (Exception exception) when (exception is InvalidOperationException or KeyNotFoundException
                    or FormatException or SqliteException)
                {
                    throw new DataValidationException($"Données invalides ({relative}) : {exception.Message}");
                }
            }
            imported++;
        }
        var cachedPaths = new List<string>();
        using (var command = connection.CreateCommand())
        {
            command.Transaction = transaction;
            command.CommandText = "SELECT path FROM datasets";
            using var reader = command.ExecuteReader();
            while (reader.Read()) cachedPaths.Add(reader.GetString(0));
        }
        foreach (var missing in cachedPaths.Where(path => !present.Contains(path)))
            Execute(transaction, "DELETE FROM datasets WHERE path=$path", ("$path", missing));
        transaction.Commit();
        return new ImportSummary(files.Length, imported, unchanged, Count("telemetry"), Count("lap_timings"),
            Count("pit_stops"), CacheFile);
    }

    public Dictionary<string, CachedDataset> LoadSnapshots()
    {
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT path,json,sha256 FROM datasets";
        using var reader = command.ExecuteReader();
        var datasets = new Dictionary<string, CachedDataset>(StringComparer.Ordinal);
        while (reader.Read())
        {
            var path = reader.GetString(0);
            datasets.Add(path, new CachedDataset(path, reader.GetString(1), reader.GetString(2)));
        }
        return datasets;
    }

    private static bool IsSnapshot(string relative)
    {
        if (relative is "catalog.json" or "source-manifest.json") return true;
        if (relative.StartsWith("championship-", StringComparison.Ordinal)
            && relative.EndsWith(".json", StringComparison.Ordinal) && !relative.Contains('/')) return true;
        var parts = relative.Split('/');
        return parts.Length == 3 && int.TryParse(parts[0], out _) && int.TryParse(parts[1], out _)
            && parts[2] is "results.json" or "laps.json" or "pits.json" or "replay.json" or "quality.json";
    }

    private void Normalize(SqliteTransaction transaction, string path, JsonElement root)
    {
        var name = Path.GetFileName(path);
        if (name is "results.json")
        {
            InsertResults(transaction, path, root.GetProperty("year").GetInt32(),
                root.GetProperty("round").GetInt32(), false, root.GetProperty("drivers"));
        }
        else if (name.StartsWith("championship-", StringComparison.Ordinal))
        {
            var year = root.GetProperty("year").GetInt32();
            foreach (var race in root.GetProperty("races").EnumerateArray())
            {
                var round = race.GetProperty("round").GetInt32();
                InsertResults(transaction, path, year, round, false, race.GetProperty("results"));
                if (race.TryGetProperty("sprintResults", out var sprint) && sprint.ValueKind == JsonValueKind.Array)
                    InsertResults(transaction, path, year, round, true, sprint);
            }
        }
        else if (name is "laps.json")
        {
            using var command = Prepared(transaction,
                "INSERT INTO lap_timings VALUES($path,$year,$round,$lap,$driver,$position,$time)",
                "$path", "$year", "$round", "$lap", "$driver", "$position", "$time");
            foreach (var lap in root.GetProperty("laps").EnumerateArray())
                foreach (var timing in lap.GetProperty("timings").EnumerateArray())
                    Row(command, path, root.GetProperty("year").GetInt32(), root.GetProperty("round").GetInt32(),
                        lap.GetProperty("lap").GetInt32(), timing.GetProperty("driverId").GetString()!,
                        timing.GetProperty("position").GetInt32(), Finite(timing.GetProperty("timeSeconds")));
        }
        else if (name is "pits.json")
        {
            using var command = Prepared(transaction,
                "INSERT INTO pit_stops VALUES($path,$year,$round,$driver,$lap,$stop,$duration)",
                "$path", "$year", "$round", "$driver", "$lap", "$stop", "$duration");
            foreach (var stop in root.GetProperty("stops").EnumerateArray())
                Row(command, path, root.GetProperty("year").GetInt32(), root.GetProperty("round").GetInt32(),
                    stop.GetProperty("driverId").GetString()!, stop.GetProperty("lap").GetInt32(),
                    stop.GetProperty("stop").GetInt32(), Finite(stop.GetProperty("durationSeconds")));
        }
        else if (name is "replay.json")
        {
            if (root.GetProperty("sampleHz").GetDouble() != 1)
                throw new DataValidationException($"{path} : le replay local doit être sous-échantillonné à 1 Hz.");
            using var command = Prepared(transaction,
                "INSERT INTO telemetry VALUES($path,$year,$round,$driver,$t,$x,$y,$z)",
                "$path", "$year", "$round", "$driver", "$t", "$x", "$y", "$z");
            var year = root.GetProperty("year").GetInt32();
            var round = root.GetProperty("round").GetInt32();
            foreach (var driver in root.GetProperty("drivers").EnumerateArray())
            {
                var previous = double.NegativeInfinity;
                foreach (var point in driver.GetProperty("points").EnumerateArray())
                {
                    if (point.GetArrayLength() != 4)
                        throw new DataValidationException($"{path} : un point doit contenir [t,x,y,z].");
                    var t = Finite(point[0]);
                    if (t < 0 || t <= previous)
                        throw new DataValidationException($"{path} : timestamps négatifs, dupliqués ou désordonnés.");
                    previous = t;
                    Row(command, path, year, round, driver.GetProperty("driverId").GetString()!,
                        t, Finite(point[1]), Finite(point[2]), Finite(point[3]));
                }
            }
        }
    }

    private void InsertResults(SqliteTransaction transaction, string path, int year, int round, bool sprint, JsonElement rows)
    {
        using var command = Prepared(transaction,
            "INSERT INTO race_results VALUES($path,$year,$round,$sprint,$driver,$position,$laps,$points,$status,$fastest)",
            "$path", "$year", "$round", "$sprint", "$driver", "$position", "$laps", "$points", "$status", "$fastest");
        foreach (var result in rows.EnumerateArray())
        {
            object fastest = result.TryGetProperty("fastestLapRank", out var rank) && rank.ValueKind == JsonValueKind.Number
                ? rank.GetInt32() : DBNull.Value;
            Row(command, path, year, round, sprint ? 1 : 0, result.GetProperty("driverId").GetString()!,
                result.GetProperty("position").GetInt32(), result.GetProperty("laps").GetInt32(),
                Finite(result.GetProperty("points")), result.GetProperty("status").GetString()!, fastest);
        }
    }

    private static double Finite(JsonElement element)
    {
        var value = element.GetDouble();
        if (!double.IsFinite(value)) throw new DataValidationException("Un nombre fini est requis.");
        return value;
    }

    private SqliteCommand Prepared(SqliteTransaction transaction, string sql, params string[] parameters)
    {
        var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = sql;
        foreach (var parameter in parameters) command.Parameters.AddWithValue(parameter, DBNull.Value);
        command.Prepare();
        return command;
    }

    private static void Row(SqliteCommand command, params object[] values)
    {
        for (var i = 0; i < values.Length; i++) command.Parameters[i].Value = values[i];
        command.ExecuteNonQuery();
    }

    private void Execute(SqliteTransaction transaction, string sql, params (string Name, object Value)[] parameters)
    {
        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = sql;
        foreach (var (name, value) in parameters) command.Parameters.AddWithValue(name, value);
        command.ExecuteNonQuery();
    }

    private long Count(string table)
    {
        using var command = connection.CreateCommand();
        // The table names here are hardcoded by the importer, never supplied by a request.
        command.CommandText = $"SELECT COUNT(*) FROM {table}";
        return (long)command.ExecuteScalar()!;
    }

    public static string Sha256(string text) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(text))).ToLowerInvariant();
    public void Dispose() => connection.Dispose();
}
