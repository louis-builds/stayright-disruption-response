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
}
