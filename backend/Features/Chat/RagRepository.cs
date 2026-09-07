using Microsoft.EntityFrameworkCore;
using Pgvector;
using Pgvector.EntityFrameworkCore;
using TravelDisruptionAgent.Api.Infrastructure.Data;
using TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

namespace TravelDisruptionAgent.Api.Features.Chat;

public class RagRepository(AppDbContext db) : IRagRepository
{
    public Task<List<RagDocument>> GetDefaultDocumentsAsync(CancellationToken ct = default) =>
        db.RagDocuments.Where(d => d.IsDefaultVersion).ToListAsync(ct);

    public async Task<List<RagDocumentChunk>> GetSearchableChunksAsync(Guid? guestUserId, CancellationToken ct = default)
    {
        var ids = await GetSearchableChunkIdsAsync(guestUserId, ct);
        return await db.RagDocumentChunks.Include(c => c.RagDocument)
            .Where(c => ids.Contains(c.Id))
            .ToListAsync(ct);
    }

    public async Task<(string Content, string DocName, int Version, double Distance)?> FindNearestSnippetAsync(
        Guid? guestUserId, Vector query, CancellationToken ct = default)
    {
        var ids = await GetSearchableChunkIdsAsync(guestUserId, ct);
        if (ids.Count == 0) return null;

        var row = await db.RagDocumentChunks
            .Where(c => ids.Contains(c.Id) && c.Embedding != null)
            .OrderBy(c => c.Embedding!.CosineDistance(query))
            .Select(c => new
            {
                c.Content,
                DocName = c.RagDocument!.Name,
                Version = c.RagDocument.Version,
                Distance = c.Embedding!.CosineDistance(query),
            })
            .FirstOrDefaultAsync(ct);

        return row is null ? null : (row.Content, row.DocName, row.Version, (double)row.Distance);
    }

    private async Task<List<Guid>> GetSearchableChunkIdsAsync(Guid? guestUserId, CancellationToken ct)
    {
        var docs = await db.RagDocuments.Select(d => new { d.Id, d.Name, d.Version, d.IsDefaultVersion }).ToListAsync(ct);
        var overrides = guestUserId.HasValue
            ? await db.UserDocumentVersions.Where(o => o.UserId == guestUserId.Value).ToListAsync(ct)
            : [];

        var docIds = new List<Guid>();
        foreach (var group in docs.GroupBy(d => d.Name))
        {
            var overrideVersion = overrides.FirstOrDefault(o => o.DocumentName == group.Key)?.Version;
            var chosen = overrideVersion.HasValue
                ? group.FirstOrDefault(d => d.Version == overrideVersion.Value)
                : group.FirstOrDefault(d => d.IsDefaultVersion);
            if (chosen is not null) docIds.Add(chosen.Id);
        }

        return await db.RagDocumentChunks
            .Where(c => docIds.Contains(c.RagDocumentId))
            .Select(c => c.Id)
            .ToListAsync(ct);
    }
}
