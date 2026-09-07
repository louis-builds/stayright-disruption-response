using TravelDisruptionAgent.Api.Features.Cases;
using TravelDisruptionAgent.Api.Infrastructure.Data.Entities;
using TravelDisruptionAgent.Api.Infrastructure.Paging;

namespace TravelDisruptionAgent.Api.Features.Calls;

public class CallService(ICallRepository repo, ICaseRepository cases, ITelephonyProvider telephony) : ICallService
{
    public async Task<CallDto> InitiateCallAsync(Guid caseId, Guid coordinatorUserId, InitiateCallRequest request, CancellationToken ct = default)
    {
        _ = await cases.FindWithBookingAsync(caseId, ct) ?? throw new CaseNotFoundException();

        var now = DateTimeOffset.UtcNow;
        var call = new Call
        {
            Id = Guid.NewGuid(),
            CaseId = caseId,
            CalleeType = request.CalleeType,
            InitiatedByCoordinatorId = coordinatorUserId,
            Status = "connecting",
            StartedAt = now,
            CreatedAt = now,
            UpdatedAt = now,
        };
        await repo.AddAsync(call, ct);
        await repo.SaveChangesAsync(ct);

        await telephony.InitiateCallAsync(call.Id, request.SimulateOutcome, ct);

        return ToDto(call);
    }

    public async Task EndCallAsync(Guid callId, Guid coordinatorUserId, CancellationToken ct = default)
    {
        var call = await repo.FindAsync(callId, ct) ?? throw new CallNotFoundException();
        if (call.InitiatedByCoordinatorId != coordinatorUserId) throw new CallNotFoundException();
        await telephony.EndCallAsync(callId, ct);
    }

    public async Task<List<CallDto>> ListForCaseAsync(Guid caseId, CancellationToken ct = default) =>
        [.. (await repo.ListForCaseAsync(caseId, ct)).Select(ToDto)];

    public async Task<PagedResult<CallDto>> ListMineAsync(
        Guid coordinatorUserId, Guid? caseId, string? calleeType, string? status,
        DateTimeOffset? from, DateTimeOffset? to, int page, int pageSize, CancellationToken ct = default)
    {
        var paged = await repo.ListForCoordinatorAsync(coordinatorUserId, caseId, calleeType, status, from, to, page, pageSize, ct);
        return PagedResult<CallDto>.Create([.. paged.List.Select(ToDto)], paged.Total, paged.Page, paged.PageSize);
    }

    public async Task<CallRecordingDto> GetRecordingAsync(Guid callId, Guid coordinatorUserId, CancellationToken ct = default)
    {
        var call = await repo.FindAsync(callId, ct) ?? throw new CallNotFoundException();
        if (call.InitiatedByCoordinatorId != coordinatorUserId) throw new CallNotFoundException();

        var recording = await repo.FindRecordingByCallIdAsync(callId, ct) ?? throw new CallNotFoundException();
        return ToRecordingDto(recording);
    }

    public async Task ReviewRecordingAsync(Guid callId, Guid coordinatorUserId, ReviewRecordingRequest request, CancellationToken ct = default)
    {
        var call = await repo.FindAsync(callId, ct) ?? throw new CallNotFoundException();
        if (call.InitiatedByCoordinatorId != coordinatorUserId) throw new CallNotFoundException();

        var recording = await repo.FindRecordingByCallIdAsync(callId, ct) ?? throw new CallNotFoundException();
        recording.Reviewed = request.Reviewed;
        recording.CoordinatorNote = request.Note;
        recording.UpdatedAt = DateTimeOffset.UtcNow;
        await repo.SaveChangesAsync(ct);
    }

    private static CallDto ToDto(Call call) => new(
        call.Id, call.CaseId, call.CalleeType, call.Status, call.StartedAt, call.EndedAt,
        call.EndedAt is { } ended ? (int)(ended - call.StartedAt).TotalSeconds : null,
        call.Case?.Booking?.GuestUser?.Nickname, call.Case?.Booking?.Hotel?.Name, call.Case?.Booking?.ConfirmationNo);

    private static CallRecordingDto ToRecordingDto(CallRecording r) => new(
        r.Id, r.CallId, r.FileUrl, r.DurationSeconds, r.TranscriptText, r.AiSummary, r.ProcessingStatus, r.Reviewed, r.CoordinatorNote);
}
