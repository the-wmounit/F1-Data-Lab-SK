using System.Collections.Concurrent;
using System.Text.Json;
using System.Text.Json.Nodes;
using F1DataLab;
using Microsoft.Extensions.FileProviders;
using Microsoft.AspNetCore.StaticFiles;

var importOnly = args.Contains("--import-only", StringComparer.Ordinal);
var webArgs = args.Where(arg => arg != "--import-only").ToArray();
var repoRoot = LocateRepository(AppContext.BaseDirectory, Directory.GetCurrentDirectory());
var webRoot = Path.Combine(repoRoot, "wwwroot");
Directory.CreateDirectory(webRoot);
var builder = WebApplication.CreateBuilder(new WebApplicationOptions
{
    Args = webArgs,
    ContentRootPath = repoRoot,
    WebRootPath = webRoot
});
var dataDirectory = Path.GetFullPath(builder.Configuration["DataDirectory"] ?? Path.Combine(repoRoot, "data"));
var cacheFile = Path.GetFullPath(builder.Configuration["CacheFile"] ?? Path.Combine(repoRoot, ".cache", "f1.sqlite"));
var serializerOptions = new JsonSerializerOptions(JsonSerializerDefaults.Web) { WriteIndented = false };
using var store = new DataStore(cacheFile);
ImportSummary summary;
try
{
    summary = store.Import(dataDirectory);
}
catch (DataValidationException exception)
{
    Console.Error.WriteLine($"Import annulé : {exception.Message}");
    Environment.ExitCode = 1;
    return;
}
if (importOnly)
{
    Console.WriteLine(JsonSerializer.Serialize(summary, serializerOptions));
    return;
}
var datasets = store.LoadSnapshots();
var ready = datasets.ContainsKey("catalog.json") && datasets.ContainsKey("championship-2024.json");
var championshipCache = new ConcurrentDictionary<string, CachedDataset>(StringComparer.Ordinal);
var app = builder.Build();
// SDK static-web-assets manifests list linked files but do not always expose their
// external directories. Use the real directory for index.html discovery as well.
using var staticFiles = new PhysicalFileProvider(webRoot);
app.Environment.WebRootFileProvider = staticFiles;
app.UseDefaultFiles(new DefaultFilesOptions { FileProvider = staticFiles });
var contentTypes = new FileExtensionContentTypeProvider();
contentTypes.Mappings[".glb"] = "model/gltf-binary";
contentTypes.Mappings[".gltf"] = "model/gltf+json";
app.UseStaticFiles(new StaticFileOptions { FileProvider = staticFiles, ContentTypeProvider = contentTypes });
app.MapGet("/api/health", () => Results.Json(new
{
    status = ready ? "ready" : "missing-data",
    mode = "offline",
    schemaVersion = DataStore.SchemaVersion,
    datasets = datasets.Count,
    import = new { summary.Imported, summary.Unchanged, summary.TelemetryPoints, summary.LapTimings, summary.PitStops }
}, serializerOptions, statusCode: ready ? 200 : 503));

app.MapGet("/api/races", (HttpContext context) => Dataset(context, "catalog.json", false));
app.MapGet("/api/results/{year:int}/{round:int}", (HttpContext context, int year, int round) =>
    Dataset(context, $"{year}/{round}/results.json"));
app.MapGet("/api/laps/{year:int}/{round:int}", (HttpContext context, int year, int round) =>
    Dataset(context, $"{year}/{round}/laps.json"));
app.MapGet("/api/pits/{year:int}/{round:int}", (HttpContext context, int year, int round) =>
    Dataset(context, $"{year}/{round}/pits.json"));
app.MapGet("/api/replay/{year:int}/{round:int}", (HttpContext context, int year, int round) =>
    Dataset(context, $"{year}/{round}/replay.json"));
app.MapGet("/api/quality/{year:int}/{round:int}", (HttpContext context, int year, int round) =>
{
    if (!datasets.TryGetValue($"{year}/{round}/quality.json", out var quality))
        return Missing($"{year}/{round}/quality.json");
    var report = JsonNode.Parse(quality.Json)!.AsObject();
    report["cache"] = JsonSerializer.SerializeToNode(new
    {
        schemaVersion = DataStore.SchemaVersion,
        importedDatasets = datasets.Count,
        telemetryPoints = summary.TelemetryPoints,
        lapTimings = summary.LapTimings,
        pitStops = summary.PitStops,
        idempotence = "SHA-256 du fichier + transaction SQLite"
    }, serializerOptions);
    return JsonResponse(context, new CachedDataset(quality.RelativePath,
        report.ToJsonString(serializerOptions), DataStore.Sha256(report.ToJsonString(serializerOptions))));
});
app.MapGet("/api/championship/{year:int}", (HttpContext context, int year, string? scoring, string? points) =>
{
    scoring ??= "2024";
    try
    {
        // Validate query parameters even when a snapshot for this season is absent.
        ChampionshipCalculator.ParseScoring(scoring, points);
        if (!datasets.TryGetValue($"championship-{year}.json", out var source))
            return Missing($"championship-{year}.json");
        var key = $"{year}|{scoring}|{points}";
        if (!championshipCache.TryGetValue(key, out var result))
        {
            var data = JsonSerializer.Deserialize<ChampionshipData>(source.Json, serializerOptions)!;
            var response = ChampionshipCalculator.Calculate(data, scoring, points);
            var json = JsonSerializer.Serialize(response, serializerOptions);
            result = new CachedDataset(key, json, DataStore.Sha256(json));
            // Do not allow arbitrary custom query strings to grow a server-side cache forever.
            if (scoring != "custom") championshipCache.TryAdd(key, result);
        }
        return JsonResponse(context, result);
    }
    catch (DataValidationException exception)
    {
        return Results.Problem(exception.Message, statusCode: 400, title: "Barème invalide");
    }
});
// Leave unmatched paths to ASP.NET's 404 response. A routed MapFallback would
// capture directory URLs before default-file middleware discovers index.html.

app.Logger.LogInformation("F1 Data Lab offline: {Count} snapshots, {Points} GPS samples, {Changed} imported, {Unchanged} unchanged",
    datasets.Count, summary.TelemetryPoints, summary.Imported, summary.Unchanged);
app.Run();

IResult Dataset(HttpContext context, string path, bool perRace = true) =>
    datasets.TryGetValue(path, out var dataset) ? JsonResponse(context, dataset)
        : perRace ? Missing(path) : Results.Problem("Aucune donnée locale disponible. Lancez la préparation des fixtures.",
            statusCode: 503, title: "Données absentes");

IResult Missing(string path) => Results.Problem($"Le snapshot local {path} n'est pas disponible.",
    statusCode: 404, title: "Données non disponibles");

static IResult JsonResponse(HttpContext context, CachedDataset dataset)
{
    var etag = $"\"{dataset.Sha256}\"";
    context.Response.Headers.ETag = etag;
    context.Response.Headers.CacheControl = "public, max-age=0, must-revalidate";
    if (context.Request.Headers.IfNoneMatch.ToString().Split(',').Select(value => value.Trim())
        .Any(value => value == "*" || value.Replace("W/", "", StringComparison.Ordinal) == etag))
        return Results.StatusCode(304);
    return Results.Text(dataset.Json, "application/json", System.Text.Encoding.UTF8);
}

static string LocateRepository(params string[] candidates)
{
    // Prefer the editable checkout over copies generated under bin/ during builds.
    foreach (var candidate in candidates)
    {
        var directory = new DirectoryInfo(candidate);
        while (directory is not null)
        {
            if (Directory.Exists(Path.Combine(directory.FullName, "src", "F1DataLab"))
                && File.Exists(Path.Combine(directory.FullName, "docs", "data-contract.md")))
                return directory.FullName;
            directory = directory.Parent;
        }
    }
    // Published output includes data/, wwwroot/ and the contract, without src/.
    foreach (var candidate in candidates)
    {
        if (File.Exists(Path.Combine(candidate, "docs", "data-contract.md"))
            && Directory.Exists(Path.Combine(candidate, "data"))
            && Directory.Exists(Path.Combine(candidate, "wwwroot")))
            return Path.GetFullPath(candidate);
    }
    throw new DirectoryNotFoundException("Racine F1 Data Lab introuvable (docs/data-contract.md, data/ et wwwroot/).");
}
