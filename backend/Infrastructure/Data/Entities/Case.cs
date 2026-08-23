namespace TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

/// <summary>status: pending|in_progress|closed.</summary>
public class Case
{
    public Guid Id { get; set; }
    public Guid BookingId { get; set; }
    public Guid DisruptionId { get; set; }
    public string Status { get; set; } = "pending";
    public Guid? AssigneeCoordinatorId { get; set; }
    public string Priority { get; set; } = "normal";
    public string? CloseReason { get; set; }
    /// <summary>转人工原因分类：拒光方案|必须人工|AI搞不定|没把握|高风险。人工升级队列的过滤标签用这个字段。</summary>
    public string? EscalationReason { get; set; }
    public DateTimeOffset? ClosedAt { get; set; }
    public Guid? ClosedByUserId { get; set; }
    public string? ResultSummary { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }

    public Booking? Booking { get; set; }
    public Disruption? Disruption { get; set; }
    public List<Message> Messages { get; set; } = [];
}
