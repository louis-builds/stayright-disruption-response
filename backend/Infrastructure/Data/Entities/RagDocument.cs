namespace TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

/// <summary>知识库文档：常见问题.md / 使用说明.md / 取消与改订政策.md（平台默认，HotelId 为 null），
/// 或某个酒店自己的退改签政策（HotelId 有值，Name 固定为 "hotel-refund-policy:{HotelId}" 保证跨酒店
/// 不撞 (Name, Version) 唯一索引，人类可读的酒店名只在查询侧拼展示文案，不进这个字段）。
/// 酒店政策每次重新上传都是整份删掉重建（RagChunkBackfill.ReplaceHotelPolicyDocumentAsync），
/// 不像平台默认文档那样维护多个 Version 供覆盖。</summary>
public class RagDocument
{
    public Guid Id { get; set; }
    public string Name { get; set; } = "";
    public int Version { get; set; }
    public string Content { get; set; } = "";
    public bool IsDefaultVersion { get; set; }
    public string SourceType { get; set; } = "md";
    public Guid? HotelId { get; set; }
    public DateTimeOffset? EffectiveFrom { get; set; }
    public DateTimeOffset? EffectiveUntil { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }

    public Hotel? Hotel { get; set; }
    public List<RagDocumentChunk> Chunks { get; set; } = [];
}
