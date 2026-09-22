namespace TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

/// <summary>status: ringing|in_progress|rejected|completed|failed|no_answer.</summary>
public class Call
{
    public Guid Id { get; set; }
    public Guid CaseId { get; set; }
    public string CalleeType { get; set; } = "guest"; // guest|hotel
    public Guid InitiatedByCoordinatorId { get; set; }
    public Guid ReceiverUserId { get; set; }
    public string Status { get; set; } = "ringing";
    public DateTimeOffset StartedAt { get; set; }
    public DateTimeOffset? AnsweredAt { get; set; }
    public DateTimeOffset? EndedAt { get; set; }
    public string? EndedReason { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }

    public Case? Case { get; set; }
    public CallRecording? Recording { get; set; }
}
