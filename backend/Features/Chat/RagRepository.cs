using Microsoft.EntityFrameworkCore;
using TravelDisruptionAgent.Api.Infrastructure.Data;
using TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

namespace TravelDisruptionAgent.Api.Features.Chat;

public class RagRepository(AppDbContext db) : IRagRepository
{
    public Task<List<RagDocument>> GetDefaultDocumentsAsync(CancellationToken ct = default) =>
        db.RagDocuments.Where(d => d.IsDefaultVersion).ToListAsync(ct);

    public async Task<List<RagDocumentChunk>> GetSearchableChunksAsync(Guid? guestUserId, CancellationToken ct = default)
    {
        var docs = await db.RagDocuments.Include(d => d.Chunks).ToListAsync(ct);
        var overrides = guestUserId.HasValue
            ? await db.UserDocumentVersions.Where(o => o.UserId == guestUserId.Value).ToListAsync(ct)
            : [];

        var chunks = new List<RagDocumentChunk>();
        foreach (var group in docs.GroupBy(d => d.Name))
        {
            var overrideVersion = overrides.FirstOrDefault(o => o.DocumentName == group.Key)?.Version;
            var chosen = overrideVersion.HasValue
                ? group.FirstOrDefault(d => d.Version == overrideVersion.Value)
                : group.FirstOrDefault(d => d.IsDefaultVersion);
            if (chosen is not null) chunks.AddRange(chosen.Chunks);
        }
        return chunks;
    }
}
