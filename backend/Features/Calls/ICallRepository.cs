using TravelDisruptionAgent.Api.Infrastructure.Data.Entities;
using TravelDisruptionAgent.Api.Infrastructure.Paging;

namespace TravelDisruptionAgent.Api.Features.Calls;

public interface ICallRepository
{
    Task AddAsync(Call call, CancellationToken ct = default);
    Task<Call?> FindAsync(Guid id, CancellationToken ct = default);
    Task<Call?> FindWithDetailsAsync(Guid id, CancellationToken ct = default);
    Task<List<Call>> ListForCaseAsync(Guid caseId, CancellationToken ct = default);
    Task<List<Call>> ListIncomingForGuestAsync(Guid guestUserId, CancellationToken ct = default);
    Task<PagedResult<Call>> ListForCoordinatorAsync(
        Guid coordinatorUserId, Guid? caseId, string? calleeType, string? status,
        DateTimeOffset? from, DateTimeOffset? to, int page, int pageSize, CancellationToken ct = default);

    Task AddRecordingAsync(CallRecording recording, CancellationToken ct = default);
    Task<CallRecording?> FindRecordingAsync(Guid id, CancellationToken ct = default);
    Task<CallRecording?> FindRecordingByCallIdAsync(Guid callId, CancellationToken ct = default);
    Task<CallRecording?> FindRecordingWithCallAsync(Guid callId, CancellationToken ct = default);
    Task<PagedResult<CallRecording>> ListRecordingsForAuditAsync(
        string? query, Guid? coordinatorId, DateTimeOffset? from, DateTimeOffset? to, string? auditStatus,
        Guid? mineCoordinatorId, bool auditedOnly, int page, int pageSize, CancellationToken ct = default);
    Task<Dictionary<Guid, string>> ListNicknamesAsync(IEnumerable<Guid> userIds, CancellationToken ct = default);

    Task SaveChangesAsync(CancellationToken ct = default);
    Task TransitionAsync(Call call, string expectedStatus, CancellationToken ct = default);
}
