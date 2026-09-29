using Microsoft.EntityFrameworkCore;
using TravelDisruptionAgent.Api.Infrastructure.Data;
using TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

namespace TravelDisruptionAgent.Api.Features.Coordinator;

public class BadCaseRepository(AppDbContext db) : IBadCaseRepository
{
    public Task<List<Message>> ListDislikedAsync(CancellationToken ct = default) =>
        db.Messages
            .Include(m => m.Case).ThenInclude(c => c!.Disruption)
            .Include(m => m.Case).ThenInclude(c => c!.Booking).ThenInclude(b => b!.GuestUser)
            .Where(m => m.SenderRole == "ai" && m.Vote == "dislike")
            .OrderByDescending(m => m.CreatedAt)
            .ToListAsync(ct);

    public Task<Message?> FindMessageAsync(Guid messageId, CancellationToken ct = default) =>
        db.Messages
            .Include(m => m.Case).ThenInclude(c => c!.Disruption)
            .Include(m => m.Case).ThenInclude(c => c!.Booking).ThenInclude(b => b!.GuestUser)
            .FirstOrDefaultAsync(m => m.Id == messageId, ct);

    public Task<Message?> FindPrecedingGuestMessageAsync(Guid caseId, DateTimeOffset beforeCreatedAt, CancellationToken ct = default) =>
        db.Messages
            .Where(m => m.CaseId == caseId && m.SenderRole == "guest" && m.CreatedAt < beforeCreatedAt)
            .OrderByDescending(m => m.CreatedAt)
            .FirstOrDefaultAsync(ct);

    public Task<List<Message>> ListAiThreadAsync(Guid caseId, CancellationToken ct = default) =>
        db.Messages
            .Where(m => m.CaseId == caseId && m.Thread == "ai")
            .OrderBy(m => m.CreatedAt)
            .ToListAsync(ct);

    public async Task<bool> SetMissedEscalationConfirmedAsync(Guid messageId, bool confirmed, CancellationToken ct = default)
    {
        var message = await db.Messages.FirstOrDefaultAsync(m => m.Id == messageId, ct);
        if (message is null) return false;
        message.MissedEscalationConfirmed = confirmed;
        message.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
        return true;
    }

    public async Task<Dictionary<Guid, BadCaseLearning>> ListLearningsByMessageIdsAsync(
        IEnumerable<Guid> messageIds, CancellationToken ct = default)
    {
        var ids = messageIds.Distinct().ToList();
        if (ids.Count == 0) return [];
        return await db.BadCaseLearnings.Where(l => ids.Contains(l.MessageId)).ToDictionaryAsync(l => l.MessageId, ct);
    }

    public Task<BadCaseLearning?> FindLearningByMessageIdAsync(Guid messageId, CancellationToken ct = default) =>
        db.BadCaseLearnings.FirstOrDefaultAsync(l => l.MessageId == messageId, ct);

    public async Task AddLearningAsync(BadCaseLearning learning, CancellationToken ct = default) =>
        await db.BadCaseLearnings.AddAsync(learning, ct);

    public Task SaveChangesAsync(CancellationToken ct = default) => db.SaveChangesAsync(ct);
}
