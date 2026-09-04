namespace TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

/// <summary>案件历史上给这位客人推荐过的备用酒店，跨越多次 Regenerate 也不会忘——
/// 用来给 alternate 打分时排除掉已经推荐过的酒店。</summary>
public class AlternateOfferAudit
{
    public Guid Id { get; set; }
    public Guid CaseId { get; set; }
    public Guid HotelId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}
