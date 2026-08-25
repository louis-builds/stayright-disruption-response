namespace TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

/// <summary>
/// detect 那条 Python 管线只给外部 guest_id/booking_id（纯字符串，不是这边的 Guid），
/// 现在还没做真实客人/订单匹配——先把绑定关系落地留痕，证明 ingest 管线本身跑通，
/// 匹配到真实 Booking 是以后的事，不在这张表里做。
/// </summary>
public class HandoffAffectedCustomer
{
    public Guid Id { get; set; }
    public Guid DisruptionId { get; set; }
    public string ExternalGuestId { get; set; } = "";
    public string ExternalBookingId { get; set; } = "";
    public DateTimeOffset ReceivedAt { get; set; }
}
