using Microsoft.EntityFrameworkCore;
using Pgvector;
using TravelDisruptionAgent.Api.Features.Chat;
using TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

namespace TravelDisruptionAgent.Api.Infrastructure.Data;

/// <summary>
/// Task 17 把种子文档从"整篇字符串"升级成"切片+向量"。种子导入本身是幂等跳过的（users 表有数据就不再跑），
/// 所以旧环境升级到这个版本时，已有的种子文档不会自动补切片——这里单独、幂等地补一次
/// （只处理还没有 chunk 的文档，重复启动不会重复生成）。
/// </summary>
public static class RagChunkBackfill
{
    public static async Task RunAsync(AppDbContext db, GeminiClient gemini, ILogger logger, CancellationToken ct = default)
    {
        var docsNeedingChunks = await db.RagDocuments
            .Where(d => !db.RagDocumentChunks.Any(c => c.RagDocumentId == d.Id))
            .ToListAsync(ct);

        if (docsNeedingChunks.Count == 0) return;

        var now = DateTimeOffset.UtcNow;
        foreach (var doc in docsNeedingChunks)
        {
            var sections = doc.Content.Split("\n## ", StringSplitOptions.RemoveEmptyEntries)
                .Select(s => s.Trim()).Where(s => s.Length > 0).ToList();
            for (var i = 0; i < sections.Count; i++)
            {
                var embedding = await gemini.EmbedAsync(sections[i], ct);
                db.RagDocumentChunks.Add(new RagDocumentChunk
                {
                    Id = Guid.NewGuid(), RagDocumentId = doc.Id, ChunkIndex = i, Content = sections[i],
                    Embedding = embedding is { Length: > 0 } ? new Vector(embedding) : null, CreatedAt = now,
                });
            }
        }
        await db.SaveChangesAsync(ct);
        logger.LogInformation("RAG chunk backfill: embedded {Count} document(s)", docsNeedingChunks.Count);
    }

    /// <summary>这个功能上线前就已经存在的酒店退改签政策从来没经过 RagRepository.ReplaceHotelPolicyDocumentAsync，
    /// 没有对应的 RagDocument/chunk——补一次，之后每次酒店重新上传/编辑都会自己保持最新，不需要再跑。</summary>
    public static async Task RunHotelPolicyBackfillAsync(AppDbContext db, IRagRepository ragRepository, ILogger logger, CancellationToken ct = default)
    {
        var hotelIdsNeedingIndex = await db.HotelRefundPolicies
            .Where(p => p.IsActive && !db.RagDocuments.Any(d => d.HotelId == p.HotelId))
            .Select(p => new { p.HotelId, p.Content })
            .ToListAsync(ct);

        foreach (var p in hotelIdsNeedingIndex)
            await ragRepository.ReplaceHotelPolicyDocumentAsync(p.HotelId, p.Content, ct);

        if (hotelIdsNeedingIndex.Count > 0)
            logger.LogInformation("RAG chunk backfill: indexed {Count} existing hotel polic(y/ies)", hotelIdsNeedingIndex.Count);
    }
}
