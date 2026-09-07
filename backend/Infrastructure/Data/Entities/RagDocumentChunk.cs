using Pgvector;

namespace TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

/// <summary>文档切片 + 向量。向量存 pgvector vector(1024)，检索用库内余弦距离（&lt;=&gt;）。</summary>
public class RagDocumentChunk
{
    public Guid Id { get; set; }
    public Guid RagDocumentId { get; set; }
    public int ChunkIndex { get; set; }
    public string Content { get; set; } = "";
    public Vector? Embedding { get; set; }
    public DateTimeOffset CreatedAt { get; set; }

    public RagDocument? RagDocument { get; set; }
}
