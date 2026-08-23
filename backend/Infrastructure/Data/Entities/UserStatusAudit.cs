namespace TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

/// <summary>action: enable|disable|reset_password。</summary>
public class UserStatusAudit
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public Guid ActorUserId { get; set; }
    public string Action { get; set; } = "disable";
    public string? Reason { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}
