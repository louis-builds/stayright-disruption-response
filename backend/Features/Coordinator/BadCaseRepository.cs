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
}
