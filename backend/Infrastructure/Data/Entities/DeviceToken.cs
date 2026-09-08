namespace TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

/// <summary>platform: ios|android.</summary>
public class DeviceToken
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public string ExpoPushToken { get; set; } = "";
    public string Platform { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }

    public User? User { get; set; }
}
