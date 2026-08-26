namespace TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

/// <summary>单行全局配置表——只有两个字段，不做通用 KV。永远只有一行，见迁移里的种子 INSERT。</summary>
public class SystemSettings
{
    public Guid Id { get; set; }
    public int UnresolvedTurnThreshold { get; set; } = 5;
    public bool LowConfidenceEscalationEnabled { get; set; } = true;
    /// <summary>FAQ 聚类后台任务的游标——处理到这个时间点之前的客人提问了，下一轮只看更晚的。</summary>
    public DateTimeOffset? FaqProcessedThrough { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}
