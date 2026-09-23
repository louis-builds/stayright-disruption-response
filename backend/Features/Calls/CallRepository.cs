using Microsoft.EntityFrameworkCore;
using TravelDisruptionAgent.Api.Infrastructure.Data;
using TravelDisruptionAgent.Api.Infrastructure.Data.Entities;
using TravelDisruptionAgent.Api.Infrastructure.Paging;

namespace TravelDisruptionAgent.Api.Features.Calls;

public class CallRepository(AppDbContext db) : ICallRepository
{
    public async Task AddAsync(Call call, CancellationToken ct = default) =>
        await db.Calls.AddAsync(call, ct);

    public Task<Call?> FindAsync(Guid id, CancellationToken ct = default) =>
        db.Calls.FirstOrDefaultAsync(c => c.Id == id, ct);

    public Task<Call?> FindWithDetailsAsync(Guid id, CancellationToken ct = default) =>
        WithDetails().FirstOrDefaultAsync(c => c.Id == id, ct);

    public Task<List<Call>> ListForCaseAsync(Guid caseId, CancellationToken ct = default) =>
        WithDetails().Where(c => c.CaseId == caseId).OrderByDescending(c => c.StartedAt).ToListAsync(ct);

    public Task<List<Call>> ListIncomingForGuestAsync(Guid guestUserId, CancellationToken ct = default) =>
        WithDetails()
            .Where(c => c.ReceiverUserId == guestUserId && c.Status == "ringing")
            .OrderByDescending(c => c.StartedAt)
            .ToListAsync(ct);

    public Task<PagedResult<Call>> ListForCoordinatorAsync(
        Guid coordinatorUserId, Guid? caseId, string? calleeType, string? status,
        DateTimeOffset? from, DateTimeOffset? to, int page, int pageSize, CancellationToken ct = default)
    {
        var query = WithDetails()
            .Where(c => c.InitiatedByCoordinatorId == coordinatorUserId);
        if (caseId is { } cid) query = query.Where(c => c.CaseId == cid);
        if (!string.IsNullOrWhiteSpace(calleeType)) query = query.Where(c => c.CalleeType == calleeType);
        if (!string.IsNullOrWhiteSpace(status)) query = query.Where(c => c.Status == status);
        if (from is { } f) query = query.Where(c => c.StartedAt >= f);
        if (to is { } t) query = query.Where(c => c.StartedAt <= t);

        return query.OrderByDescending(c => c.StartedAt).ToPagedResultAsync(page, pageSize, ct);
    }

    public async Task AddRecordingAsync(CallRecording recording, CancellationToken ct = default) =>
        await db.CallRecordings.AddAsync(recording, ct);

    public Task<CallRecording?> FindRecordingAsync(Guid id, CancellationToken ct = default) =>
        db.CallRecordings.FirstOrDefaultAsync(r => r.Id == id, ct);

    public Task<CallRecording?> FindRecordingByCallIdAsync(Guid callId, CancellationToken ct = default) =>
        db.CallRecordings.FirstOrDefaultAsync(r => r.CallId == callId, ct);

    public Task SaveChangesAsync(CancellationToken ct = default) => db.SaveChangesAsync(ct);

    public async Task TransitionAsync(Call call, string expectedStatus, CancellationToken ct = default)
    {
        var count = await db.Calls.Where(c => c.Id == call.Id && c.Status == expectedStatus)
            .ExecuteUpdateAsync(s => s.SetProperty(c => c.Status, call.Status)
                .SetProperty(c => c.AnsweredAt, call.AnsweredAt)
                .SetProperty(c => c.EndedAt, call.EndedAt)
                .SetProperty(c => c.EndedReason, call.EndedReason)
                .SetProperty(c => c.UpdatedAt, call.UpdatedAt), ct);
        if (count == 0) throw new CallStateConflictException("The call changed. Refresh its status.");
        db.Entry(call).State = EntityState.Unchanged;
    }

    private IQueryable<Call> WithDetails() => db.Calls
        .Include(c => c.Case).ThenInclude(c => c!.Booking).ThenInclude(b => b!.GuestUser)
        .Include(c => c.Case).ThenInclude(c => c!.Booking).ThenInclude(b => b!.Hotel);
}
