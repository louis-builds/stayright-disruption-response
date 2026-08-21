namespace TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

/// <summary>type: defer|alternate; status: pending|accepted|rejected.</summary>
public class Inquiry
{
    public Guid Id { get; set; }
    public Guid CaseId { get; set; }
    public Guid HotelId { get; set; }
    public string Type { get; set; } = "defer";
    public string Status { get; set; } = "pending";
    public DateTimeOffset RequestedAt { get; set; }
    public DateTimeOffset? RespondedAt { get; set; }
    public string? RejectReason { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }

    public Case? Case { get; set; }
    public Hotel? Hotel { get; set; }
}
