using TravelDisruptionAgent.Api.Features.Cases;
using TravelDisruptionAgent.Api.Infrastructure.Data.Entities;
using TravelDisruptionAgent.Api.Infrastructure.Email;

namespace TravelDisruptionAgent.Api.Features.Coordinator;

public class CoordinatorService(ICoordinatorRepository repo, IEmailService email) : ICoordinatorService
{
    // ponytail: 固定 24 小时在办超时阈值,没有配置项;真实 SLA 按中断严重程度分级时,改成从配置或 disruption 优先级读取。
    private const int OverdueThresholdHours = 24;

    public async Task<OverviewDto> GetOverviewAsync(CancellationToken ct = default)
    {
        var weather = await repo.CountActiveDisruptionsByTypeAsync("weather", ct);
        var flight = await repo.CountActiveDisruptionsByTypeAsync("flight", ct);
        var road = await repo.CountActiveDisruptionsByTypeAsync("road", ct);
        var newToday = await repo.CountNewAffectedBookingsTodayAsync(ct);
        var pending = await repo.CountByStatusAsync("pending", ct);
        var inProgress = await repo.CountByStatusAsync("in_progress", ct);
        var closedToday = await repo.CountClosedTodayAsync(ct);
        var biggest = await repo.FindBiggestImpactDisruptionAsync(ct);
        var overdue = (await repo.ListQueueAsync(ct)).Count(IsOverdue);

        return new OverviewDto(weather, flight, road, newToday, pending, inProgress, closedToday,
            biggest?.Id, biggest?.Title, biggest?.AffectedCount ?? 0, overdue);
    }

    private static bool IsOverdue(Case c) =>
        c.Status == "in_progress" && DateTimeOffset.UtcNow - c.CreatedAt > TimeSpan.FromHours(OverdueThresholdHours);

    private static readonly Dictionary<string, string> EscalationFilterMap = new()
    {
        ["all_rejected"] = "客人拒绝全部方案",
        ["must_manual"] = "必须人工",
        ["ai_stuck"] = "AI搞不定",
        ["low_confidence"] = "AI没把握",
        ["frustrated"] = "客人情绪激动",
        ["high_risk"] = "高风险",
    };

    public async Task<List<CaseQueueItemDto>> GetQueueAsync(string? filter, CancellationToken ct = default)
    {
        var list = await repo.ListQueueAsync(ct);
        if (!string.IsNullOrWhiteSpace(filter) && EscalationFilterMap.TryGetValue(filter, out var reason))
        {
            list = [.. list.Where(c => c.EscalationReason == reason)];
        }
        var names = await CoordinatorNamesAsync(ct);
        var highValue = await HighValueGuestIdsAsync(list, ct);
        var awaitingHotel = await repo.GetPendingHotelConfirmationCaseIdsAsync(list.Select(c => c.Id), ct);
        return [.. list.Select(c => ToQueueItemDto(c, names, highValue, awaitingHotel))];
    }

    public async Task<List<CaseQueueItemDto>> GetByDisruptionAsync(Guid disruptionId, CancellationToken ct = default)
    {
        var list = await repo.ListByDisruptionAsync(disruptionId, ct);
        var names = await CoordinatorNamesAsync(ct);
        var highValue = await HighValueGuestIdsAsync(list, ct);
        var awaitingHotel = await repo.GetPendingHotelConfirmationCaseIdsAsync(list.Select(c => c.Id), ct);
        return [.. list.Select(c => ToQueueItemDto(c, names, highValue, awaitingHotel))];
    }

    public async Task<List<CaseQueueItemDto>> GetMineAsync(Guid coordinatorId, string status, CancellationToken ct = default)
    {
        var list = await repo.ListMineAsync(coordinatorId, status, ct);
        var names = await CoordinatorNamesAsync(ct);
        var highValue = await HighValueGuestIdsAsync(list, ct);
        var awaitingHotel = await repo.GetPendingHotelConfirmationCaseIdsAsync(list.Select(c => c.Id), ct);
        return [.. list.Select(c => ToQueueItemDto(c, names, highValue, awaitingHotel))];
    }

    public async Task<List<CaseQueueItemDto>> GetClosedAsync(int days, CancellationToken ct = default)
    {
        var list = await repo.ListClosedAsync(days, ct);
        var names = await CoordinatorNamesAsync(ct);
        var highValue = await HighValueGuestIdsAsync(list, ct);
        var awaitingHotel = await repo.GetPendingHotelConfirmationCaseIdsAsync(list.Select(c => c.Id), ct);
        return [.. list.Select(c => ToQueueItemDto(c, names, highValue, awaitingHotel))];
    }

    public async Task<List<CaseQueueItemDto>> SearchAsync(string query, CancellationToken ct = default)
    {
        var list = await repo.SearchAsync(query, ct);
        var names = await CoordinatorNamesAsync(ct);
        var highValue = await HighValueGuestIdsAsync(list, ct);
        var awaitingHotel = await repo.GetPendingHotelConfirmationCaseIdsAsync(list.Select(c => c.Id), ct);
        return [.. list.Select(c => ToQueueItemDto(c, names, highValue, awaitingHotel))];
    }

    private async Task<Dictionary<Guid, string>> CoordinatorNamesAsync(CancellationToken ct) =>
        (await repo.ListCoordinatorsAsync(ct)).ToDictionary(u => u.Id, u => u.Nickname);

    private Task<HashSet<Guid>> HighValueGuestIdsAsync(IEnumerable<Case> cases, CancellationToken ct) =>
        repo.GetHighValueGuestIdsAsync(cases.Where(c => c.Booking is not null).Select(c => c.Booking!.GuestUserId), ct);

    private static CaseQueueItemDto ToQueueItemDto(Case c, Dictionary<Guid, string> coordinatorNames, HashSet<Guid> highValueGuestIds,
        HashSet<Guid> awaitingHotelCaseIds) => new(
        c.Id, c.DisruptionId, c.Booking?.ConfirmationNo ?? "", c.Booking?.GuestUser?.Nickname ?? "", c.Disruption?.Title ?? "",
        c.EscalationReason, DateTimeOffset.UtcNow - c.CreatedAt, c.Priority, c.Status,
        c.AssigneeCoordinatorId,
        c.AssigneeCoordinatorId.HasValue && coordinatorNames.TryGetValue(c.AssigneeCoordinatorId.Value, out var n) ? n : null,
        IsOverdue(c), c.Booking is not null && highValueGuestIds.Contains(c.Booking.GuestUserId),
        awaitingHotelCaseIds.Contains(c.Id));

    public async Task<List<CoordinatorOptionDto>> ListCoordinatorsAsync(CancellationToken ct = default) =>
        [.. (await repo.ListCoordinatorsAsync(ct)).Select(u => new CoordinatorOptionDto(u.Id, u.Nickname))];

    public async Task TransferAsync(Guid caseId, Guid toCoordinatorId, Guid actorUserId, CancellationToken ct = default)
    {
        var c = await repo.FindByIdAsync(caseId, ct) ?? throw new CaseNotFoundException();
        var from = c.AssigneeCoordinatorId;
        c.AssigneeCoordinatorId = toCoordinatorId;
        // Assignment means a coordinator has started handling the case.
        // Keep closed cases closed, but move newly assigned pending cases into the active workflow.
        if (c.Status == "pending")
        {
            c.Status = "in_progress";
        }
        c.UpdatedAt = DateTimeOffset.UtcNow;

        await repo.AddAssignmentAsync(new CaseAssignment
        {
            Id = Guid.NewGuid(), CaseId = caseId, ActorUserId = actorUserId,
            FromCoordinatorId = from, ToCoordinatorId = toCoordinatorId,
            Action = from is null ? "assign" : "transfer", CreatedAt = DateTimeOffset.UtcNow,
        }, ct);
        await repo.SaveChangesAsync(ct);
    }

    /// <summary>新中断/新待办生成时按在办数量最少的协调员自动分派;供后续任务(P2 自动匹配受影响预订)接入。</summary>
    public async Task<Guid?> AssignLeastBusyCoordinatorAsync(CancellationToken ct = default)
    {
        var coordinators = await repo.ListCoordinatorsAsync(ct);
        if (coordinators.Count == 0) return null;

        Guid? best = null;
        var bestLoad = int.MaxValue;
        foreach (var coordinator in coordinators)
        {
            var load = await repo.CountInProgressForCoordinatorAsync(coordinator.Id, ct);
            if (load < bestLoad)
            {
                bestLoad = load;
                best = coordinator.Id;
            }
        }
        return best;
    }

    private static readonly string[] RefundCloseReasons = ["取消退款完成结案"];

    public async Task CloseAsync(Guid caseId, CloseCaseRequest request, Guid actorUserId, CancellationToken ct = default)
    {
        var c = await repo.FindByIdAsync(caseId, ct) ?? throw new CaseNotFoundException();
        if (c.Status == "closed") throw new CaseAlreadyClosedException();

        // A submitted defer/alternate is not a completed rebooking until the hotel accepts it.
        // Keep this guard in the API as well as the UI so a direct request cannot close the case early.
        if (await repo.HasPendingHotelConfirmationAsync(caseId, ct))
        {
            throw new HotelConfirmationPendingException();
        }

        // 退款强制规则(Task 6):退款类结案必须先有协调员退款确认记录,不能靠这里直接把状态标完成绕过去。
        if (RefundCloseReasons.Contains(request.CloseReason) && !await repo.HasRefundConfirmationAsync(caseId, ct))
        {
            throw new RefundNotConfirmedException();
        }

        var now = DateTimeOffset.UtcNow;
        c.Status = "closed";
        c.CloseReason = request.CloseReason;
        c.ResultSummary = request.ResultSummary;
        c.ClosedAt = now;
        c.ClosedByUserId = actorUserId;
        c.UpdatedAt = now;

        var guest = c.Booking?.GuestUser;
        if (guest is not null)
        {
            var guestSuccess = true;
            try
            {
                var caseLink = CaseEmailLinks.BuildCaseLink(caseId);
                var htmlBody = EmailTemplate.Build("Your case has been resolved", $"""
                    <p>Your case for {System.Net.WebUtility.HtmlEncode(c.Booking!.Hotel?.Name)} has been resolved: {System.Net.WebUtility.HtmlEncode(request.ResultSummary)}</p>
                    {EmailTemplate.Button(caseLink, "View this case")}
                    """);
                await email.SendEmailAsync(guest.Email, "Your case has been resolved",
                    $"Your case for {c.Booking!.Hotel?.Name} has been resolved: {request.ResultSummary}\n\nView this case: {caseLink}", ct, htmlBody);
            }
            catch
            {
                guestSuccess = false;
            }
            await repo.AddNotificationAsync(new Notification
            {
                Id = Guid.NewGuid(), UserId = guest.Id, Channel = "email", Type = "case_resolved",
                Title = "Your case has been resolved", Body = request.ResultSummary,
                CaseId = caseId, SentAt = now, Success = guestSuccess, CreatedAt = now, UpdatedAt = now,
            }, ct);
        }

        if (c.Booking is not null)
        {
            var hotelUserId = await repo.FindHotelAccountUserIdAsync(c.Booking.HotelId, ct);
            if (hotelUserId.HasValue)
            {
                await repo.AddNotificationAsync(new Notification
                {
                    Id = Guid.NewGuid(), UserId = hotelUserId.Value, Channel = "in_app", Type = "case_resolved",
                    Title = "A guest case has been resolved", Body = $"Case for booking {c.Booking.ConfirmationNo} is now resolved ({request.CloseReason}).",
                    CaseId = caseId, SentAt = now, Success = true, CreatedAt = now, UpdatedAt = now,
                }, ct);
            }
        }

        await repo.SaveChangesAsync(ct);
    }

    public async Task<List<CaseNotificationDto>> ListCaseNotificationsAsync(Guid caseId, CancellationToken ct = default) =>
        [.. (await repo.ListCaseNotificationsAsync(caseId, ct))
            .Select(n => new CaseNotificationDto(n.Id, n.Channel, n.Type, n.Title, n.Body, n.Success, n.SentAt))];

    public async Task<PushOptionsResultDto> ResendNotificationAsync(Guid notificationId, CancellationToken ct = default)
    {
        var n = await repo.FindNotificationAsync(notificationId, ct) ?? throw new CaseNotFoundException();
        var recipient = await repo.FindUserByIdAsync(n.UserId, ct);
        var now = DateTimeOffset.UtcNow;
        var success = true;

        if (recipient is not null && n.Channel == "email")
        {
            try
            {
                var caseLink = n.CaseId is { } cid ? CaseEmailLinks.BuildCaseLink(cid) : null;
                var body = caseLink is null ? n.Body : $"{n.Body}\n\nView this case: {caseLink}";
                var htmlBody = EmailTemplate.Build(n.Title, $"""
                    <p>{System.Net.WebUtility.HtmlEncode(n.Body)}</p>
                    {(caseLink is null ? "" : EmailTemplate.Button(caseLink, "View this case"))}
                    """);
                await email.SendEmailAsync(recipient.Email, n.Title, body, ct, htmlBody);
            }
            catch
            {
                success = false;
            }
        }

        n.Success = success;
        n.SentAt = now;
        n.UpdatedAt = now;
        await repo.SaveChangesAsync(ct);
        return new PushOptionsResultDto(success, now);
    }

    public async Task SetPriorityAsync(Guid caseId, string priority, CancellationToken ct = default)
    {
        var c = await repo.FindByIdAsync(caseId, ct) ?? throw new CaseNotFoundException();
        c.Priority = priority;
        c.UpdatedAt = DateTimeOffset.UtcNow;
        await repo.SaveChangesAsync(ct);
    }

    public async Task<List<CaseNoteDto>> ListNotesAsync(Guid caseId, CancellationToken ct = default) =>
        [.. (await repo.ListNotesAsync(caseId, ct)).Select(n => new CaseNoteDto(n.Id, n.Author?.Nickname ?? "", n.Body, n.CreatedAt))];

    public async Task AddNoteAsync(Guid caseId, Guid authorUserId, string body, CancellationToken ct = default)
    {
        await repo.AddNoteAsync(new CaseNote
        {
            Id = Guid.NewGuid(), CaseId = caseId, AuthorUserId = authorUserId, Body = body, CreatedAt = DateTimeOffset.UtcNow,
        }, ct);
        await repo.SaveChangesAsync(ct);
    }
}
