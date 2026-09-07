using Microsoft.EntityFrameworkCore;
using Pgvector;
using Pgvector.EntityFrameworkCore;
using TravelDisruptionAgent.Api.Infrastructure.Data;
using TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

namespace TravelDisruptionAgent.Api.Features.Faq;

public class FaqRepository(AppDbContext db) : IFaqRepository
{
    public Task<List<Message>> ListUnprocessedGuestQuestionsAsync(DateTimeOffset? since, CancellationToken ct = default) =>
        db.Messages
            .Where(m => m.Thread == "ai" && m.SenderRole == "guest" && (since == null || m.CreatedAt > since))
            .OrderBy(m => m.CreatedAt)
            .ToListAsync(ct);

    public Task<List<FaqQuestion>> ListClustersAsync(CancellationToken ct = default) =>
        db.FaqQuestions.ToListAsync(ct);

    public async Task<(FaqQuestion Cluster, double Distance)?> FindNearestClusterAsync(Vector query, CancellationToken ct = default)
    {
        var row = await db.FaqQuestions
            .OrderBy(c => c.Embedding.CosineDistance(query))
            .Select(c => new { c.Id, Distance = c.Embedding.CosineDistance(query) })
            .FirstOrDefaultAsync(ct);
        if (row is null) return null;

        var cluster = await db.FaqQuestions.FirstAsync(c => c.Id == row.Id, ct);
        return (cluster, (double)row.Distance);
    }

    public async Task AddClusterAsync(FaqQuestion cluster, CancellationToken ct = default) =>
        await db.FaqQuestions.AddAsync(cluster, ct);

    public Task<List<FaqQuestion>> ListTopAsync(int count, CancellationToken ct = default) =>
        db.FaqQuestions.OrderByDescending(f => f.AskCount).ThenByDescending(f => f.LastAskedAt).Take(count).ToListAsync(ct);

    public Task SaveChangesAsync(CancellationToken ct = default) => db.SaveChangesAsync(ct);
}
