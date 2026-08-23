namespace TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

/// <summary>文档切片 + 向量。向量存 real[]（float[]），不引入 pgvector 扩展 —— 语料量小，
/// 余弦相似度直接在应用层算，等语料规模真的大了再迁 pgvector。</summary>
public class RagDocumentChunk
{
    public Guid Id { get; set; }
    public Guid RagDocumentId { get; set; }
    public int ChunkIndex { get; set; }
    public string Content { get; set; } = "";
    public float[]? Embedding { get; set; }
    public DateTimeOffset CreatedAt { get; set; }

    public RagDocument? RagDocument { get; set; }
}
