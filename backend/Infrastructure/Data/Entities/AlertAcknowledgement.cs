namespace TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

/// <summary>运营概览告警的确认消警记录，按 AlertKey + 当天日期生效一天。</summary>
public class AlertAcknowledgement
{
    public Guid Id { get; set; }
    public string AlertKey { get; set; } = "";
    public Guid AcknowledgedByUserId { get; set; }
    public DateOnly AcknowledgedDate { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}
