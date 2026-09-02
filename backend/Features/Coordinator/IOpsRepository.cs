using TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

namespace TravelDisruptionAgent.Api.Features.Coordinator;

public interface IOpsRepository
{
    Task<DateTimeOffset?> FindLastDisruptionAtAsync(string type, CancellationToken ct = default);
    Task<int> CountFailedNotificationsAsync(CancellationToken ct = default);
    Task<int> CountOverdueInquiriesAsync(TimeSpan threshold, CancellationToken ct = default);
    Task<int> CountEscalationBacklogAsync(CancellationToken ct = default);
    Task<double> NotificationSuccessRateAsync(string channel, CancellationToken ct = default);
    Task<bool> PingDatabaseAsync(CancellationToken ct = default);
    Task<bool> IsAcknowledgedTodayAsync(string alertKey, CancellationToken ct = default);
    Task AddAcknowledgementAsync(AlertAcknowledgement ack, CancellationToken ct = default);

    /// <summary>day=null 表示不按天过滤；disruptionId=null 表示不按事件过滤。</summary>
    Task<List<Case>> ListCasesForKpiAsync(DateOnly? day, Guid? disruptionId, CancellationToken ct = default);
    Task<List<Notification>> ListFirstNotificationsForCasesAsync(List<Guid> caseIds, CancellationToken ct = default);
    Task<int> CountInProgressAsync(CancellationToken ct = default);
    Task<List<CaseWorkflowStateHistory>> ListWorkflowHistoryAsync(DateTimeOffset start, DateTimeOffset end, CancellationToken ct = default);
    Task<List<Case>> ListCasesCreatedOrClosedSinceAsync(DateTimeOffset start, CancellationToken ct = default);

    Task SaveChangesAsync(CancellationToken ct = default);
}
