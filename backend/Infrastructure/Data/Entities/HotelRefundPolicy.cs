namespace TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

/// <summary>酒店退款/取消政策。每个酒店最多只有一条 active 记录；更新时旧记录 IsActive 置 false。
/// Content 是 markdown 原文，用于展示给客人和协调员；StructuredRulesJson 是可选的确定性规则，
/// 用于自动计算取消选项的违约金。没有酒店级政策时，系统回退到平台默认的 RagDocument 政策。</summary>
public class HotelRefundPolicy
{
    public Guid Id { get; set; }
    public Guid HotelId { get; set; }
    public string Content { get; set; } = "";
    public string? StructuredRulesJson { get; set; }
    // 上传文件路径的归档引用：SourceFileKey 是 S3 object key（纯文本直填时为空），
    // SourceFileName 是原始文件名，仅展示用。
    public string? SourceFileKey { get; set; }
    public string? SourceFileName { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTimeOffset? EffectiveFrom { get; set; }
    public DateTimeOffset? EffectiveUntil { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }

    public Hotel Hotel { get; set; } = null!;
}
