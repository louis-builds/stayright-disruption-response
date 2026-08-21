namespace TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

/// <summary>type: weather|flight|road; status: active|closed.</summary>
public class Disruption
{
    public Guid Id { get; set; }
    public string Type { get; set; } = "weather";
    public string Title { get; set; } = "";
    public string Region { get; set; } = "";
    public DateTimeOffset StartAt { get; set; }
    public DateTimeOffset? EndAtOrWindow { get; set; }
    public string Status { get; set; } = "active";
    public string RawSignalText { get; set; } = "";
    public Guid? AssigneeCoordinatorId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}
