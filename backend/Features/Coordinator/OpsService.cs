using TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

namespace TravelDisruptionAgent.Api.Features.Coordinator;

public class OpsService(IOpsRepository repo) : IOpsService
{
    // ponytail: 没有真实的天气/航班/道路信号轮询服务(全项目范围内都没接外部信号 API,种子数据直接落库模拟)，
    // 这里如实展示"未配置实时信号源"而不是伪造一个"已连接"，用最近一次同类型中断事件的入库时间代替"最近拉取时间"。
    private static readonly string[] SignalTypes = ["weather", "flight", "road"];

    // ponytail: 酒店询单超时阈值先写死 4 小时,没有单独配置项;真实场景应按渠道 SLA 从配置读取。
    private static readonly TimeSpan HotelInquiryOverdueThreshold = TimeSpan.FromHours(4);

    private static int FirstNotifyDeadlineMinutes =>
        int.TryParse(Environment.GetEnvironmentVariable("FIRST_NOTIFICATION_DEADLINE_MINUTES"), out var m) ? m : 15;

    private static readonly string[] RebookingCloseReasons = ["改订成功结案", "取消退款完成结案", "人工决议结案", "中断解除-维持原订"];

    public async Task<OpsOverviewDto> GetOverviewAsync(CancellationToken ct = default)
    {
        var signals = new List<SignalSourceStatusDto>();
        foreach (var type in SignalTypes)
        {
            var last = await repo.FindLastDisruptionAtAsync(type, ct);
            signals.Add(new SignalSourceStatusDto(type, false, last));
        }

        var failedNotifications = await repo.CountFailedNotificationsAsync(ct);
        var overdueInquiries = await repo.CountOverdueInquiriesAsync(HotelInquiryOverdueThreshold, ct);
        var escalationBacklog = await repo.CountEscalationBacklogAsync(ct);
        var emailRate = await repo.NotificationSuccessRateAsync("email", ct);
        var inAppRate = await repo.NotificationSuccessRateAsync("in_app", ct);
        var dbHealthy = await repo.PingDatabaseAsync(ct);

        var alerts = new List<AlertDto>();
        if (failedNotifications > 0) alerts.Add(await BuildAlertAsync("failed_notifications", "warning", $"{failedNotifications} notification(s) failed to send.", ct));
        if (escalationBacklog >= 3) alerts.Add(await BuildAlertAsync("escalation_backlog", "warning", $"Escalation queue depth is {escalationBacklog}.", ct));
        foreach (var s in signals.Where(s => s.LastIngestedAt is null))
            alerts.Add(await BuildAlertAsync($"signal_{s.Type}", "info", $"No {s.Type} disruption signal has ever been ingested.", ct));
        if (!dbHealthy) alerts.Add(await BuildAlertAsync("database_down", "critical", "Database health check failed.", ct));

        var todayKpi = await GetKpiAsync(DateOnly.FromDateTime(DateTime.UtcNow), null, ct);

        return new OpsOverviewDto(signals, failedNotifications, overdueInquiries, escalationBacklog,
            emailRate, inAppRate, dbHealthy, alerts, todayKpi);
    }

    private async Task<AlertDto> BuildAlertAsync(string key, string level, string message, CancellationToken ct) =>
        new(key, level, message, await repo.IsAcknowledgedTodayAsync(key, ct));

    public async Task AcknowledgeAlertAsync(string alertKey, Guid actorUserId, CancellationToken ct = default)
    {
        await repo.AddAcknowledgementAsync(new AlertAcknowledgement
        {
            Id = Guid.NewGuid(), AlertKey = alertKey, AcknowledgedByUserId = actorUserId,
            AcknowledgedDate = DateOnly.FromDateTime(DateTime.UtcNow), CreatedAt = DateTimeOffset.UtcNow,
        }, ct);
        await repo.SaveChangesAsync(ct);
    }

    public async Task<KpiMetricsDto> GetKpiAsync(DateOnly? day, Guid? disruptionId, CancellationToken ct = default)
    {
        var cases = await repo.ListCasesForKpiAsync(day, disruptionId, ct);
        var eligibleForNotify = cases.Where(c => c.CloseReason != "误伤关闭").ToList();
        var caseIds = eligibleForNotify.Select(c => c.Id).ToList();
        var firstNotifications = caseIds.Count > 0 ? await repo.ListFirstNotificationsForCasesAsync(caseIds, ct) : [];
        var firstNotifyByCaseId = firstNotifications.ToDictionary(n => n.CaseId!.Value, n => n.SentAt);

        var notifyDenominator = eligibleForNotify.Count;
        var notifyNumerator = eligibleForNotify.Count(c =>
            firstNotifyByCaseId.TryGetValue(c.Id, out var sentAt) &&
            (sentAt - c.CreatedAt) <= TimeSpan.FromMinutes(FirstNotifyDeadlineMinutes));
        var firstNotifyRate = notifyDenominator == 0 ? 100.0 : Math.Round(notifyNumerator * 100.0 / notifyDenominator, 1);

        var closedCases = cases.Where(c => c.Status == "closed").ToList();
        var rebookingEligible = closedCases.Where(c => c.CloseReason is not null && RebookingCloseReasons.Contains(c.CloseReason)
            && c.CloseReason != "重复案合并关闭").ToList();
        var rebookingSuccess = rebookingEligible.Count(c => c.CloseReason == "改订成功结案");
        var rebookingRate = rebookingEligible.Count == 0 ? 0.0 : Math.Round(rebookingSuccess * 100.0 / rebookingEligible.Count, 1);

        var resolutionHours = closedCases.Where(c => c.ClosedAt.HasValue)
            .Select(c => (c.ClosedAt!.Value - c.CreatedAt).TotalHours)
            .OrderBy(h => h).ToList();
        double? avgHours = resolutionHours.Count > 0 ? Math.Round(resolutionHours.Average(), 1) : null;
        double? medianHours = resolutionHours.Count > 0 ? Math.Round(resolutionHours[resolutionHours.Count / 2], 1) : null;

        var concurrentInProgress = await repo.CountInProgressAsync(ct);
        var escalationDepth = cases.Count(c => c.Status != "closed" && c.EscalationReason != null);
        var escalationOverdue = cases.Count(c => c.Status == "in_progress" && c.EscalationReason != null &&
            DateTimeOffset.UtcNow - c.CreatedAt > TimeSpan.FromHours(24));

        return new KpiMetricsDto(
            firstNotifyRate, notifyNumerator, notifyDenominator,
            rebookingRate, rebookingSuccess, rebookingEligible.Count,
            avgHours, medianHours,
            concurrentInProgress, notifyDenominator, closedCases.Count,
            escalationDepth, escalationOverdue);
    }

    public async Task<List<SevenDayTrendPointDto>> GetSevenDayTrendAsync(CancellationToken ct = default)
    {
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var firstDay = today.AddDays(-6);
        var rangeStart = new DateTimeOffset(firstDay.ToDateTime(TimeOnly.MinValue), TimeSpan.Zero);
        var rangeEnd = rangeStart.AddDays(7);
        var histories = await repo.ListWorkflowHistoryAsync(rangeStart, rangeEnd, ct);
        var cases = await repo.ListCasesCreatedOrClosedSinceAsync(rangeStart, ct);

        int Occupied(string state, DateTimeOffset start, DateTimeOffset end) => histories
            .Where(h => h.State == state && h.StartedAt < end && (h.EndedAt == null || h.EndedAt > start))
            .Select(h => h.CaseId)
            .Distinct()
            .Count();

        var result = new List<SevenDayTrendPointDto>();
        for (var offset = 0; offset < 7; offset++)
        {
            var date = firstDay.AddDays(offset);
            var start = new DateTimeOffset(date.ToDateTime(TimeOnly.MinValue), TimeSpan.Zero);
            var end = start.AddDays(1);
            result.Add(new SevenDayTrendPointDto(
                date,
                cases.Count(c => c.CreatedAt >= start && c.CreatedAt < end),
                Occupied("in_progress", start, end),
                Occupied("awaiting_guest", start, end),
                Occupied("awaiting_hotel", start, end),
                cases.Count(c => c.ClosedAt >= start && c.ClosedAt < end)));
        }
        return result;
    }
}
