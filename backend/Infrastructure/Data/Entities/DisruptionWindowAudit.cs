namespace TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

/// <summary>P2 手工修正恢复窗口的审计记录。</summary>
public class DisruptionWindowAudit
{
    public Guid Id { get; set; }
    public Guid DisruptionId { get; set; }
    public Guid ActorUserId { get; set; }
    public DateTimeOffset OldStartAt { get; set; }
    public DateTimeOffset? OldEndAtOrWindow { get; set; }
    public DateTimeOffset NewStartAt { get; set; }
    public DateTimeOffset? NewEndAtOrWindow { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}
