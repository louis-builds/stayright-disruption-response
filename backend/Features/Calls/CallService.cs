using Microsoft.AspNetCore.SignalR;
using TravelDisruptionAgent.Api.Features.Cases;
using TravelDisruptionAgent.Api.Infrastructure.Data.Entities;
using TravelDisruptionAgent.Api.Infrastructure.Paging;

namespace TravelDisruptionAgent.Api.Features.Calls;

public class CallService(
    ICallRepository repo,
    ICaseRepository cases,
    IHubContext<CallHub> hub) : ICallService
{
    private static readonly HashSet<string> TerminalStatuses = ["rejected", "completed", "failed", "no_answer"];

    public async Task<CallDto> InitiateCallAsync(
        Guid caseId, Guid coordinatorUserId, InitiateCallRequest request, CancellationToken ct = default)
    {
        if (request.CalleeType != "guest")
            throw new CallValidationException("WebRTC MVP currently supports guest calls only");

        var caseItem = await cases.FindWithBookingAsync(caseId, ct) ?? throw new CaseNotFoundException();
        var receiverUserId = caseItem.Booking?.GuestUserId
            ?? throw new CallValidationException("The case has no guest receiver");
        var now = DateTimeOffset.UtcNow;
        var call = new Call
        {
            Id = Guid.NewGuid(), CaseId = caseId, CalleeType = "guest",
            InitiatedByCoordinatorId = coordinatorUserId, ReceiverUserId = receiverUserId,
            Status = "ringing", StartedAt = now, CreatedAt = now, UpdatedAt = now,
        };
        await repo.AddAsync(call, ct);
        await repo.SaveChangesAsync(ct);

        var dto = ToDto(call);
        await hub.Clients.User(receiverUserId.ToString()).SendAsync("IncomingCall", dto, ct);
        return dto;
    }

    public async Task<CallDto> GetAsync(Guid callId, Guid userId, string role, CancellationToken ct = default) =>
        ToDto(await FindAuthorizedAsync(callId, userId, role, ct));

    public async Task<List<CallDto>> ListIncomingAsync(Guid guestUserId, CancellationToken ct = default) =>
        [.. (await repo.ListIncomingForGuestAsync(guestUserId, ct)).Select(ToDto)];

    public async Task<CallDto> AcceptAsync(Guid callId, Guid guestUserId, CancellationToken ct = default)
    {
        var call = await FindAuthorizedAsync(callId, guestUserId, "guest", ct);
        if (call.Status != "ringing")
            throw new CallStateConflictException($"A {call.Status} call cannot be accepted");

        var now = DateTimeOffset.UtcNow;
        call.Status = "in_progress";
        call.AnsweredAt = now;
        call.UpdatedAt = now;
        await repo.TransitionAsync(call, "ringing", ct);

        var dto = ToDto(call);
        await hub.Clients.User(call.InitiatedByCoordinatorId.ToString()).SendAsync("CallAccepted", dto, ct);
        await hub.Clients.Group(CallHub.GroupName(call.Id)).SendAsync("CallUpdated", dto, ct);
        return dto;
    }

    public async Task<CallDto> RejectAsync(Guid callId, Guid guestUserId, CancellationToken ct = default)
    {
        var call = await FindAuthorizedAsync(callId, guestUserId, "guest", ct);
        if (call.Status != "ringing")
            throw new CallStateConflictException($"A {call.Status} call cannot be rejected");

        var now = DateTimeOffset.UtcNow;
        call.Status = "rejected";
        call.EndedAt = now;
        call.EndedReason = "rejected";
        call.UpdatedAt = now;
        await repo.TransitionAsync(call, "ringing", ct);

        var dto = ToDto(call);
        await hub.Clients.User(call.InitiatedByCoordinatorId.ToString()).SendAsync("CallRejected", dto, ct);
        await hub.Clients.Group(CallHub.GroupName(call.Id)).SendAsync("CallUpdated", dto, ct);
        return dto;
    }

    public async Task<CallDto> EndCallAsync(
        Guid callId, Guid userId, string role, CancellationToken ct = default)
    {
        var call = await FindAuthorizedAsync(callId, userId, role, ct);
        if (TerminalStatuses.Contains(call.Status)) return ToDto(call);
        if (call.Status is not ("ringing" or "in_progress"))
            throw new CallStateConflictException($"A {call.Status} call cannot be ended");

        var now = DateTimeOffset.UtcNow;
        var previousStatus = call.Status;
        call.Status = call.Status == "ringing" ? "no_answer" : "completed";
        call.EndedAt = now;
        call.EndedReason = role == "coordinator" ? "ended_by_caller" : "ended_by_receiver";
        call.UpdatedAt = now;
        await repo.TransitionAsync(call, previousStatus, ct);

        var dto = ToDto(call);
        await hub.Clients.Users(call.InitiatedByCoordinatorId.ToString(), call.ReceiverUserId.ToString())
            .SendAsync("CallEnded", dto, ct);
        await hub.Clients.Group(CallHub.GroupName(call.Id)).SendAsync("CallUpdated", dto, ct);
        return dto;
    }

    public async Task<bool> CanAccessAsync(
        Guid callId, Guid userId, string role, CancellationToken ct = default)
    {
        var call = await repo.FindAsync(callId, ct);
        return call is not null && IsParticipant(call, userId, role);
    }

    public async Task<List<CallDto>> ListForCaseAsync(Guid caseId, CancellationToken ct = default) =>
        [.. (await repo.ListForCaseAsync(caseId, ct)).Select(ToDto)];

    public async Task<PagedResult<CallDto>> ListMineAsync(
        Guid coordinatorUserId, Guid? caseId, string? calleeType, string? status,
        DateTimeOffset? from, DateTimeOffset? to, int page, int pageSize, CancellationToken ct = default)
    {
        var paged = await repo.ListForCoordinatorAsync(
            coordinatorUserId, caseId, calleeType, status, from, to, page, pageSize, ct);
        return PagedResult<CallDto>.Create([.. paged.List.Select(ToDto)], paged.Total, paged.Page, paged.PageSize);
    }

    public async Task<CallRecordingDto> GetRecordingAsync(
        Guid callId, Guid coordinatorUserId, CancellationToken ct = default)
    {
        var call = await repo.FindAsync(callId, ct) ?? throw new CallNotFoundException();
        if (call.InitiatedByCoordinatorId != coordinatorUserId) throw new CallNotFoundException();
        var recording = await repo.FindRecordingByCallIdAsync(callId, ct) ?? throw new CallNotFoundException();
        return ToRecordingDto(recording);
    }

    public async Task ReviewRecordingAsync(
        Guid callId, Guid coordinatorUserId, ReviewRecordingRequest request, CancellationToken ct = default)
    {
        var call = await repo.FindAsync(callId, ct) ?? throw new CallNotFoundException();
        if (call.InitiatedByCoordinatorId != coordinatorUserId) throw new CallNotFoundException();
        var recording = await repo.FindRecordingByCallIdAsync(callId, ct) ?? throw new CallNotFoundException();
        recording.Reviewed = request.Reviewed;
        recording.CoordinatorNote = request.Note;
        recording.UpdatedAt = DateTimeOffset.UtcNow;
        await repo.SaveChangesAsync(ct);
    }

    private async Task<Call> FindAuthorizedAsync(
        Guid callId, Guid userId, string role, CancellationToken ct)
    {
        var call = await repo.FindWithDetailsAsync(callId, ct) ?? throw new CallNotFoundException();
        if (!IsParticipant(call, userId, role)) throw new CallAccessDeniedException();
        return call;
    }

    private static bool IsParticipant(Call call, Guid userId, string role) => role switch
    {
        "coordinator" => call.InitiatedByCoordinatorId == userId,
        "guest" => call.ReceiverUserId == userId,
        _ => false,
    };

    private static CallDto ToDto(Call call) => new(
        call.Id, call.CaseId, call.CalleeType, call.ReceiverUserId, call.Status,
        call.StartedAt, call.AnsweredAt, call.EndedAt, call.EndedReason,
        call.AnsweredAt is { } answered && call.EndedAt is { } ended
            ? Math.Max(0, (int)(ended - answered).TotalSeconds)
            : null,
        call.Case?.Booking?.GuestUser?.Nickname, call.Case?.Booking?.Hotel?.Name,
        call.Case?.Booking?.ConfirmationNo);

    private static CallRecordingDto ToRecordingDto(CallRecording recording) => new(
        recording.Id, recording.CallId, recording.FileUrl, recording.DurationSeconds,
        recording.TranscriptText, recording.AiSummary, recording.ProcessingStatus,
        recording.Reviewed, recording.CoordinatorNote);
}
