namespace TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

/// <summary>status: connecting|in_progress|completed|failed|no_answer.</summary>
public class Call
{
    public Guid Id { get; set; }
    public Guid CaseId { get; set; }
    public string CalleeType { get; set; } = "guest"; // guest|hotel
    public Guid InitiatedByCoordinatorId { get; set; }
    public string Status { get; set; } = "connecting";
    public DateTimeOffset StartedAt { get; set; }
    public DateTimeOffset? EndedAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }

    public Case? Case { get; set; }
    public CallRecording? Recording { get; set; }
}
