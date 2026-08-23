namespace TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

/// <summary>channel: in_app|email.</summary>
public class Notification
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public string Channel { get; set; } = "in_app";
    public string Type { get; set; } = "";
    public string Title { get; set; } = "";
    public string Body { get; set; } = "";
    public Guid? CaseId { get; set; }
    public DateTimeOffset SentAt { get; set; }
    public DateTimeOffset? ReadAt { get; set; }
    public bool Success { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }

    public User? User { get; set; }
    public Case? Case { get; set; }
}
