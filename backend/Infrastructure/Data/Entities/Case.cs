namespace TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

/// <summary>status: pending|in_progress|closed.</summary>
public class Case
{
    public Guid Id { get; set; }
    public Guid BookingId { get; set; }
    public Guid DisruptionId { get; set; }
    public string Status { get; set; } = "pending";
    public Guid? AssigneeCoordinatorId { get; set; }
    public string Priority { get; set; } = "normal";
    public string? CloseReason { get; set; }
    /// <summary>转人工原因分类：拒光方案|必须人工|AI搞不定|没把握|高风险。人工升级队列的过滤标签用这个字段。</summary>
    public string? EscalationReason { get; set; }
    /// <summary>转人工具体是哪条规则点的火：escalation_keyword|ai_unavailable|unresolved_turns|low_confidence|frustrated。
    /// EscalationReason 是给协调员看的人话分类，好几条规则共享同一个"AI搞不定"文案，光看那个字段
    /// 分不清是哪条规则触发的——离线复核阈值（比如 UnresolvedTurnThreshold）时必须精确筛到对应规则，
    /// 不能连着别的触发原因一起统计进去。</summary>
    public string? EscalationTrigger { get; set; }
    /// <summary>协调员对这次转人工的复核：这次AI转人工转得对不对，不对的话为什么——
    /// 用来沉淀"AI转人工准不准"的真实反馈，日后调阈值/权重要靠这个，不是拍脑袋。</summary>
    public bool? EscalationReviewedAsReasonable { get; set; }
    public string? EscalationReviewNote { get; set; }
    public Guid? EscalationReviewedByUserId { get; set; }
    public DateTimeOffset? EscalationReviewedAt { get; set; }
    public DateTimeOffset? ClosedAt { get; set; }
    public Guid? ClosedByUserId { get; set; }
    public string? ResultSummary { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }

    public Booking? Booking { get; set; }
    public Disruption? Disruption { get; set; }
    public List<Message> Messages { get; set; } = [];
}
