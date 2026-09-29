using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.DependencyInjection;
using System.Text.Json;
using TravelDisruptionAgent.Api.Features.Auth;
using TravelDisruptionAgent.Api.Features.Cases;
using TravelDisruptionAgent.Api.Features.Notifications;
using TravelDisruptionAgent.Api.Infrastructure.Data.Entities;
using TravelDisruptionAgent.Api.Infrastructure.Paging;

namespace TravelDisruptionAgent.Api.Features.Calls;

public class CallService(
    ICallRepository repo,
    ICaseRepository cases,
    IHubContext<CallHub> hub,
    CallRecordingStorage storage,
    IServiceScopeFactory scopes,
    IUserRepository users,
    INotificationRepository notifications) : ICallService
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
        call.Case = caseItem;

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
        var call = await repo.FindWithDetailsAsync(callId, ct) ?? throw new CallNotFoundException();
        if (call.InitiatedByCoordinatorId != coordinatorUserId) throw new CallNotFoundException();
        var recording = await repo.FindRecordingByCallIdAsync(callId, ct) ?? throw new CallNotFoundException();
        return ToRecordingDto(recording, storage.ResolvePlayableUrl(recording.FileUrl), call.Case?.Booking?.GuestUser);
    }

    public async Task<CallRecordingDto> UploadRecordingAsync(
        Guid callId, Guid coordinatorUserId, Stream content, string fileName, string? contentType,
        int? durationSeconds, CancellationToken ct = default)
    {
        var call = await repo.FindAsync(callId, ct) ?? throw new CallNotFoundException();
        if (call.InitiatedByCoordinatorId != coordinatorUserId) throw new CallAccessDeniedException();
        if (call.Status is not ("completed" or "in_progress" or "failed"))
            throw new CallStateConflictException("Recording can only be saved after the call has started");

        var url = await storage.SaveAsync(callId, fileName, contentType, content, ct);
        var duration = durationSeconds
            ?? (call.AnsweredAt is { } answered && call.EndedAt is { } ended
                ? Math.Max(1, (int)(ended - answered).TotalSeconds)
                : 1);
        var recording = await repo.FindRecordingByCallIdAsync(callId, ct);
        var now = DateTimeOffset.UtcNow;
        if (recording is null)
        {
            recording = new CallRecording
            {
                Id = Guid.NewGuid(), CallId = callId, FileUrl = url, DurationSeconds = duration,
                ProcessingStatus = "pending", CreatedAt = now, UpdatedAt = now,
            };
            await repo.AddRecordingAsync(recording, ct);
        }
        else
        {
            recording.FileUrl = url;
            recording.DurationSeconds = duration;
            recording.ProcessingStatus = "pending";
            recording.TranscriptText = null;
            recording.AiSummary = null;
            recording.InsightsJson = null;
            recording.UpdatedAt = now;
        }
        await repo.SaveChangesAsync(ct);

        var recordingId = recording.Id;
        _ = Task.Run(async () =>
        {
            using var scope = scopes.CreateScope();
            await scope.ServiceProvider.GetRequiredService<CallRecordingProcessor>().ProcessAsync(recordingId);
        });
        return ToRecordingDto(recording, storage.ResolvePlayableUrl(recording.FileUrl));
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

    public async Task<CallRecordingDto> ConfirmInsightsAsync(
        Guid callId, Guid coordinatorUserId, ConfirmCallInsightsRequest request, CancellationToken ct = default)
    {
        var call = await repo.FindWithDetailsAsync(callId, ct) ?? throw new CallNotFoundException();
        if (call.InitiatedByCoordinatorId != coordinatorUserId) throw new CallNotFoundException();
        var recording = await repo.FindRecordingByCallIdAsync(callId, ct) ?? throw new CallNotFoundException();
        var guestId = call.Case?.Booking?.GuestUserId ?? throw new CallValidationException("This call has no guest to attach preferences to");
        var guest = await users.FindByIdAsync(guestId, ct) ?? throw new CallNotFoundException();

        guest.KeepMessagesSimple = request.KeepMessagesSimple;
        guest.SpeakSlowly = request.SpeakSlowly;
        guest.StayPreference = NormalizeStayPreference(request.StayPreference);
        guest.UpdatedAt = DateTimeOffset.UtcNow;
        await users.SaveChangesAsync(ct);
        return ToRecordingDto(recording, storage.ResolvePlayableUrl(recording.FileUrl), guest);
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
        call.Case?.Booking?.ConfirmationNo, call.Case?.Booking?.GuestUser?.SpeakSlowly == true);

    private static CallRecordingDto ToRecordingDto(CallRecording recording, string? fileUrl = null, User? guest = null)
    {
        var stored = ParseInsights(recording.InsightsJson);
        return new(
            recording.Id, recording.CallId, fileUrl ?? recording.FileUrl, recording.DurationSeconds,
            recording.TranscriptText, recording.AiSummary, recording.ProcessingStatus,
            recording.Reviewed, recording.CoordinatorNote,
            new CallInsightsDto(
                new CallInsightFlagDto(stored.KeepMessagesSimple.Suggested, stored.KeepMessagesSimple.Quote, guest?.KeepMessagesSimple == true),
                new CallInsightFlagDto(stored.SpeakSlowly.Suggested, stored.SpeakSlowly.Quote, guest?.SpeakSlowly == true),
                new CallStayInsightDto(stored.StayPreference.Suggested, stored.StayPreference.Quote, guest?.StayPreference)));
    }

    private static readonly JsonSerializerOptions InsightsJson = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
    };

    private static CallInsights ParseInsights(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return CallInsights.Empty;
        try
        {
            var payload = JsonSerializer.Deserialize<CallInsightsPayload>(json, InsightsJson);
            return payload is null ? CallInsights.Empty : new(payload.KeepMessagesSimple, payload.SpeakSlowly, payload.StayPreference);
        }
        catch (JsonException)
        {
            return CallInsights.Empty;
        }
    }

    internal static string? NormalizeStayPreference(string? value) =>
        value is "cheaper" or "closer" or "larger" ? value : null;

    public Task<PagedResult<RecordingAuditListItemDto>> ListForAuditAsync(
        string? query, Guid? coordinatorId, DateTimeOffset? from, DateTimeOffset? to, string? auditStatus,
        int page, int pageSize, CancellationToken ct = default) =>
        MapAuditPage(query, coordinatorId, from, to, auditStatus, null, false, page, pageSize, ct);

    public Task<PagedResult<RecordingAuditListItemDto>> ListMineAuditsAsync(
        Guid coordinatorUserId, int page, int pageSize, CancellationToken ct = default) =>
        MapAuditPage(null, null, null, null, "done", coordinatorUserId, true, page, pageSize, ct);

    public async Task<RecordingAuditDetailDto> GetForAuditAsync(Guid callId, CancellationToken ct = default)
    {
        var recording = await repo.FindRecordingWithCallAsync(callId, ct) ?? throw new CallNotFoundException();
        return await ToAuditDetailAsync(recording, ct);
    }

    public async Task<RecordingAuditDetailDto> SubmitAuditAsync(
        Guid callId, Guid adminUserId, SubmitRecordingAuditRequest request, CancellationToken ct = default)
    {
        if (request.Rating is < 1 or > 5)
            throw new CallValidationException("Rating must be between 1 and 5");
        var recording = await repo.FindRecordingWithCallAsync(callId, ct) ?? throw new CallNotFoundException();
        var call = recording.Call ?? throw new CallNotFoundException();
        var now = DateTimeOffset.UtcNow;
        recording.AuditRating = request.Rating;
        recording.AuditComment = string.IsNullOrWhiteSpace(request.Comment) ? null : request.Comment.Trim();
        recording.AuditedAt = now;
        recording.AuditedByUserId = adminUserId;
        recording.UpdatedAt = now;

        var comment = recording.AuditComment;
        await notifications.AddAsync(new Notification
        {
            Id = Guid.NewGuid(),
            UserId = call.InitiatedByCoordinatorId,
            Channel = "in_app",
            Type = "call_audit",
            Title = "Call recording reviewed",
            Body = comment is null
                ? $"An admin rated your call {request.Rating}/5."
                : $"An admin rated your call {request.Rating}/5: {comment}",
            CaseId = call.CaseId,
            SentAt = now,
            Success = true,
            CreatedAt = now,
            UpdatedAt = now,
        }, ct);
        await repo.SaveChangesAsync(ct);
        return await ToAuditDetailAsync(recording, ct);
    }

    private async Task<PagedResult<RecordingAuditListItemDto>> MapAuditPage(
        string? query, Guid? coordinatorId, DateTimeOffset? from, DateTimeOffset? to, string? auditStatus,
        Guid? mineCoordinatorId, bool auditedOnly, int page, int pageSize, CancellationToken ct)
    {
        var paged = await repo.ListRecordingsForAuditAsync(
            query, coordinatorId, from, to, auditStatus, mineCoordinatorId, auditedOnly, page, pageSize, ct);
        var userIds = paged.List.SelectMany(r => new Guid?[] { r.Call?.InitiatedByCoordinatorId, r.AuditedByUserId })
            .Where(id => id is not null).Select(id => id!.Value);
        var names = await repo.ListNicknamesAsync(userIds, ct);
        var items = paged.List.Select(r => ToAuditListItem(r, names)).ToList();
        return PagedResult<RecordingAuditListItemDto>.Create(items, paged.Total, paged.Page, paged.PageSize);
    }

    private async Task<RecordingAuditDetailDto> ToAuditDetailAsync(CallRecording recording, CancellationToken ct)
    {
        var call = recording.Call ?? throw new CallNotFoundException();
        var names = await repo.ListNicknamesAsync(
            new[] { call.InitiatedByCoordinatorId }.Concat(recording.AuditedByUserId is { } a ? [a] : []), ct);
        return new(
            call.Id, recording.Id, call.CaseId, call.InitiatedByCoordinatorId,
            names.GetValueOrDefault(call.InitiatedByCoordinatorId, "Coordinator"),
            call.Case?.Booking?.GuestUser?.Nickname, call.Case?.Booking?.ConfirmationNo, call.CalleeType,
            call.StartedAt, recording.DurationSeconds, storage.ResolvePlayableUrl(recording.FileUrl),
            recording.TranscriptText, recording.AiSummary, recording.ProcessingStatus, recording.CoordinatorNote,
            recording.AuditRating, recording.AuditComment, recording.AuditedAt,
            recording.AuditedByUserId is { } auditor ? names.GetValueOrDefault(auditor) : null);
    }

    private static RecordingAuditListItemDto ToAuditListItem(CallRecording recording, Dictionary<Guid, string> names)
    {
        var call = recording.Call!;
        return new(
            call.Id, recording.Id, call.CaseId, call.InitiatedByCoordinatorId,
            names.GetValueOrDefault(call.InitiatedByCoordinatorId, "Coordinator"),
            call.Case?.Booking?.GuestUser?.Nickname, call.Case?.Booking?.ConfirmationNo, call.CalleeType,
            call.StartedAt, recording.DurationSeconds, recording.ProcessingStatus,
            recording.AuditRating, recording.AuditComment, recording.AuditedAt,
            recording.AuditedByUserId is { } auditor ? names.GetValueOrDefault(auditor) : null);
    }
}
