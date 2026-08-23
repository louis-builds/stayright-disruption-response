namespace TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

/// <summary>P2 人工复核误伤剔除:标记某预订不属于该中断事件的受影响范围,不再进入通知/匹配候选。</summary>
public class DisruptionExclusion
{
    public Guid Id { get; set; }
    public Guid DisruptionId { get; set; }
    public Guid BookingId { get; set; }
    public string Reason { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; }
}
