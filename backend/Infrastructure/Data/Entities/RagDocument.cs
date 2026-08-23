namespace TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

/// <summary>知识库文档：常见问题.md / 使用说明.md / 取消与改订政策.md，带 version。</summary>
public class RagDocument
{
    public Guid Id { get; set; }
    public string Name { get; set; } = "";
    public int Version { get; set; }
    public string Content { get; set; } = "";
    public bool IsDefaultVersion { get; set; }
    public string SourceType { get; set; } = "md";
    public DateTimeOffset? EffectiveFrom { get; set; }
    public DateTimeOffset? EffectiveUntil { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }

    public List<RagDocumentChunk> Chunks { get; set; } = [];
}
