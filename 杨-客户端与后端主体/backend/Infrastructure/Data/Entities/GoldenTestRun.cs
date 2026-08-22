namespace TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

public class GoldenTestRun
{
    public Guid Id { get; set; }
    public string? TriggerDocumentName { get; set; }
    public int? TriggerVersion { get; set; }
    public int PassCount { get; set; }
    public int FailCount { get; set; }
    public DateTimeOffset CreatedAt { get; set; }

    public List<GoldenTestRunItem> Items { get; set; } = [];
}

public class GoldenTestRunItem
{
    public Guid Id { get; set; }
    public Guid RunId { get; set; }
    public Guid GoldenTestId { get; set; }
    public string Input { get; set; } = "";
    public string Expect { get; set; } = "";
    public string Actual { get; set; } = "";
    public bool Passed { get; set; }

    public GoldenTestRun? Run { get; set; }
}
