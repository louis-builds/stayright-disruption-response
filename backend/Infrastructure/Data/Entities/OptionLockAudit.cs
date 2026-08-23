namespace TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

/// <summary>action: lock|unlock。</summary>
public class OptionLockAudit
{
    public Guid Id { get; set; }
    public Guid OptionId { get; set; }
    public Guid ActorUserId { get; set; }
    public string Action { get; set; } = "lock";
    public string? Reason { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}
