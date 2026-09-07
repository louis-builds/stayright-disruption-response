namespace TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

public class GuestCustomTag
{
    public Guid Id { get; set; }
    public Guid CustomTagId { get; set; }
    public Guid GuestUserId { get; set; }
    public Guid AppliedByUserId { get; set; }
    public DateTimeOffset AppliedAt { get; set; }

    public CustomTag? CustomTag { get; set; }
}
