namespace TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

/// <summary>processingStatus: pending|transcribing|summarizing|done|failed.</summary>
public class CallRecording
{
    public Guid Id { get; set; }
    public Guid CallId { get; set; }
    public string FileUrl { get; set; } = "";
    public int DurationSeconds { get; set; }
    public string? TranscriptText { get; set; }
    public string? AiSummary { get; set; }
    public string ProcessingStatus { get; set; } = "pending";
    public bool Reviewed { get; set; }
    public string? CoordinatorNote { get; set; }
    public string? InsightsJson { get; set; }
    public int? AuditRating { get; set; }
    public string? AuditComment { get; set; }
    public DateTimeOffset? AuditedAt { get; set; }
    public Guid? AuditedByUserId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }

    public Call? Call { get; set; }
}
