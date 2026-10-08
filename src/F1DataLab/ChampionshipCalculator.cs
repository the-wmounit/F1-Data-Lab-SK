using System.Globalization;

namespace F1DataLab;

/// <summary>Changes grand-prix points only; sprint totals remain the source's official totals.</summary>
public static class ChampionshipCalculator
{
    private static readonly double[] StandardPoints = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];

    public static double[] ParseScoring(string scoring, string? custom)
    {
        if (scoring is "2024" or "2010") return [.. StandardPoints];
        if (scoring != "custom")
            throw new DataValidationException("Barème inconnu : choisissez 2024, 2010 ou custom.");
        if (string.IsNullOrWhiteSpace(custom))
            throw new DataValidationException("Le barème custom nécessite points=25,18,15,...");
        var parts = custom.Split(',');
        if (parts.Length > 30)
            throw new DataValidationException("Le barème accepte au maximum 30 positions.");
        var points = new double[parts.Length];
        for (var i = 0; i < parts.Length; i++)
        {
            if (!double.TryParse(parts[i], NumberStyles.Float, CultureInfo.InvariantCulture, out points[i])
                || !double.IsFinite(points[i]) || points[i] < 0)
                throw new DataValidationException("Les points doivent être des nombres finis supérieurs ou égaux à 0.");
            if (i > 0 && points[i] > points[i - 1])
                throw new DataValidationException("Les points doivent être classés par ordre décroissant.");
        }
        return points;
    }

    public static ChampionshipResponse Calculate(ChampionshipData data, string scoring, string? custom)
    {
        var points = ParseScoring(scoring, custom);
        var totals = new Dictionary<string, Accumulator>(StringComparer.Ordinal);
        var frames = new List<ChampionshipFrame>();
        foreach (var race in data.Races.OrderBy(r => r.Round))
        {
            var winnerLaps = race.Results.FirstOrDefault(d => d.Position == 1)?.Laps
                ?? race.Results.Select(d => d.Laps).DefaultIfEmpty(0).Max();
            foreach (var driver in race.Results)
            {
                var total = Get(totals, driver);
                if (HasRecordedFinish(driver))
                    total.Finishes[driver.Position] = total.Finishes.GetValueOrDefault(driver.Position) + 1;
                if (QualifiesForRacePoints(driver, winnerLaps) && driver.Position <= points.Length)
                    total.AddPoints(points[driver.Position - 1]);
                if (scoring == "2024" && driver.FastestLapRank == 1 && driver.Position <= 10
                    && QualifiesForRacePoints(driver, winnerLaps))
                    total.AddPoints(1);
            }
            foreach (var driver in race.SprintResults ?? [])
            {
                var total = Get(totals, driver);
                total.AddPoints(driver.Points);
            }
            var ranked = totals.Values.ToList();
            ranked.Sort(Compare);
            frames.Add(new ChampionshipFrame(race.Round, race.Name,
                ranked.Select((total, i) => new Standing(total.Driver.DriverId, total.Driver.Code,
                    total.Driver.Name, total.Driver.Team, total.Driver.Color, total.Points, i + 1)).ToList()));
        }
        return new ChampionshipResponse(data.Year, scoring, points, true, frames);
    }

    private static bool InvalidStatus(string status) => status.Equals("Disqualified", StringComparison.OrdinalIgnoreCase)
        || status.Equals("Excluded", StringComparison.OrdinalIgnoreCase)
        || status.Equals("Not classified", StringComparison.OrdinalIgnoreCase)
        || status.StartsWith("Did not", StringComparison.OrdinalIgnoreCase)
        || status.Equals("Withdrawn", StringComparison.OrdinalIgnoreCase);

    private static bool HasRecordedFinish(DriverResult driver) => driver.Position > 0 && !InvalidStatus(driver.Status);

    private static bool QualifiesForRacePoints(DriverResult driver, int winnerLaps) => HasRecordedFinish(driver)
        && (driver.Points > 0 || driver.Status.Equals("Finished", StringComparison.OrdinalIgnoreCase)
            || driver.Status.StartsWith('+')
            || (winnerLaps > 0 && driver.Laps >= Math.Floor(winnerLaps * 0.9)));

    private static Accumulator Get(Dictionary<string, Accumulator> totals, DriverResult driver)
    {
        if (!totals.TryGetValue(driver.DriverId, out var accumulator))
            totals.Add(driver.DriverId, accumulator = new Accumulator(driver));
        // Use the latest team identity, including a mid-season transfer.
        accumulator.Driver = driver;
        return accumulator;
    }

    private static int Compare(Accumulator left, Accumulator right)
    {
        var points = right.Points.CompareTo(left.Points);
        if (points != 0) return points;
        var positions = left.Finishes.Keys.Concat(right.Finishes.Keys).Distinct().Order();
        foreach (var position in positions)
        {
            var count = right.Finishes.GetValueOrDefault(position).CompareTo(left.Finishes.GetValueOrDefault(position));
            if (count != 0) return count;
        }
        return string.CompareOrdinal(left.Driver.DriverId, right.Driver.DriverId);
    }

    private sealed class Accumulator(DriverResult driver)
    {
        public DriverResult Driver { get; set; } = driver;
        public double Points { get; set; }
        public Dictionary<int, int> Finishes { get; } = [];
        public void AddPoints(double points)
        {
            var next = Points + points;
            if (!double.IsFinite(next)) throw new DataValidationException("Le total des points dépasse la capacité numérique.");
            Points = next;
        }
    }
}
