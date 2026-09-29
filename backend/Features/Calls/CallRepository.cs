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

    public Task<CallRecording?> FindRecordingWithCallAsync(Guid callId, CancellationToken ct = default) =>
        db.CallRecordings
            .Include(r => r.Call!).ThenInclude(c => c.Case!).ThenInclude(cs => cs.Booking!).ThenInclude(b => b!.GuestUser)
            .Include(r => r.Call!).ThenInclude(c => c.Case!).ThenInclude(cs => cs.Booking!).ThenInclude(b => b!.Hotel)
            .FirstOrDefaultAsync(r => r.CallId == callId, ct);

    public async Task<PagedResult<CallRecording>> ListRecordingsForAuditAsync(
        string? query, Guid? coordinatorId, DateTimeOffset? from, DateTimeOffset? to, string? auditStatus,
        Guid? mineCoordinatorId, bool auditedOnly, int page, int pageSize, CancellationToken ct = default)
    {
        var rows = db.CallRecordings
            .Include(r => r.Call!).ThenInclude(c => c.Case!).ThenInclude(cs => cs.Booking!).ThenInclude(b => b!.GuestUser)
            .Include(r => r.Call!).ThenInclude(c => c.Case!).ThenInclude(cs => cs.Booking!).ThenInclude(b => b!.Hotel)
            .AsQueryable();
        if (mineCoordinatorId is { } mine)
            rows = rows.Where(r => r.Call!.InitiatedByCoordinatorId == mine);
        if (coordinatorId is { } cid)
            rows = rows.Where(r => r.Call!.InitiatedByCoordinatorId == cid);
        if (from is { } start)
            rows = rows.Where(r => r.Call!.StartedAt >= start);
        if (to is { } end)
            rows = rows.Where(r => r.Call!.StartedAt <= end);
        if (auditedOnly || auditStatus == "done")
            rows = rows.Where(r => r.AuditedAt != null);
        else if (auditStatus == "pending")
            rows = rows.Where(r => r.AuditedAt == null);
        if (!string.IsNullOrWhiteSpace(query))
        {
            var term = query.Trim();
            var coordIds = await db.Users
                .Where(u => EF.Functions.ILike(u.Nickname, $"%{term}%") || EF.Functions.ILike(u.Email, $"%{term}%"))
                .Select(u => u.Id)
                .ToListAsync(ct);
            rows = rows.Where(r =>
                coordIds.Contains(r.Call!.InitiatedByCoordinatorId)
                || (r.Call.Case!.Booking!.GuestUser != null && EF.Functions.ILike(r.Call.Case.Booking.GuestUser.Nickname, $"%{term}%"))
                || (r.Call.Case.Booking.ConfirmationNo != null && EF.Functions.ILike(r.Call.Case.Booking.ConfirmationNo, $"%{term}%")));
        }
        return await rows.OrderByDescending(r => r.Call!.StartedAt).ToPagedResultAsync(page, pageSize, ct);
    }

    public async Task<Dictionary<Guid, string>> ListNicknamesAsync(IEnumerable<Guid> userIds, CancellationToken ct = default)
    {
        var ids = userIds.Distinct().ToList();
        if (ids.Count == 0) return [];
        var rows = await db.Users.Where(u => ids.Contains(u.Id)).Select(u => new { u.Id, u.Nickname }).ToListAsync(ct);
        return rows.ToDictionary(u => u.Id, u => u.Nickname);
    }

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
