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

    /// <summary>整份删掉该酒店现有的 RagDocument(级联删 chunk)，按 "\n## " 切片、逐片 embedding，
    /// 插入一份新文档——每次酒店重新上传退改签政策都整份重建，不维护历史版本。</summary>
    Task ReplaceHotelPolicyDocumentAsync(Guid hotelId, string content, CancellationToken ct = default);

    /// <summary>该酒店切片里离 query 最近的一条；酒店还没有过 RAG 化的政策(没调过
    /// ReplaceHotelPolicyDocumentAsync)时返回 null，调用方应回退到旧的关键词匹配。</summary>
    Task<string?> FindNearestHotelChunkAsync(Guid hotelId, Vector query, CancellationToken ct = default);
}
