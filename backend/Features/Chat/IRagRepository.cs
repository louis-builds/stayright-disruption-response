using TravelDisruptionAgent.Api.Infrastructure.Data.Entities;
using Pgvector;

namespace TravelDisruptionAgent.Api.Features.Chat;

public interface IRagRepository
{
    Task<List<RagDocument>> GetDefaultDocumentsAsync(CancellationToken ct = default);
    /// <summary>guestUserId 有个人版本覆盖时用覆盖版本的切片，否则用各文档的默认版本。</summary>
    Task<List<RagDocumentChunk>> GetSearchableChunksAsync(Guid? guestUserId, CancellationToken ct = default);
    Task<(string Content, string DocName, int Version, double Distance)?> FindNearestSnippetAsync(
        Guid? guestUserId, Vector query, CancellationToken ct = default);

    /// <summary>ragas 评测用：不做 guestUserId 过滤、不限 top-1、不做阈值丢弃，原样返回 top-k 排名。</summary>
    Task<List<(Guid ChunkId, string Content, int ChunkIndex, string DocName, int Version, double Distance)>>
        SearchTopKAsync(Vector query, int topK, CancellationToken ct = default);
}
