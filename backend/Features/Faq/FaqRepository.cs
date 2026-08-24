using Microsoft.EntityFrameworkCore;
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

    public async Task AddClusterAsync(FaqQuestion cluster, CancellationToken ct = default) =>
        await db.FaqQuestions.AddAsync(cluster, ct);

    public Task<List<FaqQuestion>> ListTopAsync(int count, CancellationToken ct = default) =>
        db.FaqQuestions.OrderByDescending(f => f.AskCount).ThenByDescending(f => f.LastAskedAt).Take(count).ToListAsync(ct);

    public Task SaveChangesAsync(CancellationToken ct = default) => db.SaveChangesAsync(ct);
}
