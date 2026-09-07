using Pgvector;

namespace TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

/// <summary>语义聚类后的高频客户问题。QuestionText 固定用首次出现时的原始问法，
/// Embedding 同样固定，不随后续命中的新问法滚动更新——语料量小，这个简化不影响可用性。</summary>
public class FaqQuestion
{
    public Guid Id { get; set; }
    public string QuestionText { get; set; } = "";
    public Vector Embedding { get; set; } = null!;
    public int AskCount { get; set; } = 1;
    public DateTimeOffset LastAskedAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}
