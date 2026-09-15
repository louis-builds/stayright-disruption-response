using TravelDisruptionAgent.Api.Infrastructure.Paging;

namespace TravelDisruptionAgent.Api.Features.Calls;

public interface ICallService
{
    Task<CallDto> InitiateCallAsync(Guid caseId, Guid coordinatorUserId, InitiateCallRequest request, CancellationToken ct = default);
    Task EndCallAsync(Guid callId, Guid coordinatorUserId, CancellationToken ct = default);
    Task<List<CallDto>> ListForCaseAsync(Guid caseId, CancellationToken ct = default);
    Task<PagedResult<CallDto>> ListMineAsync(
        Guid coordinatorUserId, Guid? caseId, string? calleeType, string? status,
        DateTimeOffset? from, DateTimeOffset? to, int page, int pageSize, CancellationToken ct = default);
    Task<CallRecordingDto> GetRecordingAsync(Guid callId, Guid coordinatorUserId, CancellationToken ct = default);
    Task ReviewRecordingAsync(Guid callId, Guid coordinatorUserId, ReviewRecordingRequest request, CancellationToken ct = default);
}
