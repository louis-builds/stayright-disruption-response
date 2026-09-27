using TravelDisruptionAgent.Api.Infrastructure.Paging;

namespace TravelDisruptionAgent.Api.Features.Calls;

public interface ICallService
{
    Task<CallDto> InitiateCallAsync(Guid caseId, Guid coordinatorUserId, InitiateCallRequest request, CancellationToken ct = default);
    Task<CallDto> GetAsync(Guid callId, Guid userId, string role, CancellationToken ct = default);
    Task<List<CallDto>> ListIncomingAsync(Guid guestUserId, CancellationToken ct = default);
    Task<CallDto> AcceptAsync(Guid callId, Guid guestUserId, CancellationToken ct = default);
    Task<CallDto> RejectAsync(Guid callId, Guid guestUserId, CancellationToken ct = default);
    Task<CallDto> EndCallAsync(Guid callId, Guid userId, string role, CancellationToken ct = default);
    Task<bool> CanAccessAsync(Guid callId, Guid userId, string role, CancellationToken ct = default);
    Task<List<CallDto>> ListForCaseAsync(Guid caseId, CancellationToken ct = default);
    Task<PagedResult<CallDto>> ListMineAsync(
        Guid coordinatorUserId, Guid? caseId, string? calleeType, string? status,
        DateTimeOffset? from, DateTimeOffset? to, int page, int pageSize, CancellationToken ct = default);
    Task<CallRecordingDto> GetRecordingAsync(Guid callId, Guid coordinatorUserId, CancellationToken ct = default);
    Task ReviewRecordingAsync(Guid callId, Guid coordinatorUserId, ReviewRecordingRequest request, CancellationToken ct = default);
}
