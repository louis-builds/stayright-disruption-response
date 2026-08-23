namespace TravelDisruptionAgent.Api.Features.Coordinator;

public interface ICoordinatorService
{
    Task<OverviewDto> GetOverviewAsync(CancellationToken ct = default);
    Task<List<CaseQueueItemDto>> GetQueueAsync(string? filter, CancellationToken ct = default);
    Task<List<CaseQueueItemDto>> GetByDisruptionAsync(Guid disruptionId, CancellationToken ct = default);
    Task<List<CaseQueueItemDto>> GetMineAsync(Guid coordinatorId, string status, CancellationToken ct = default);
    Task<List<CaseQueueItemDto>> GetClosedAsync(int days, CancellationToken ct = default);
    Task<List<CaseQueueItemDto>> SearchAsync(string query, CancellationToken ct = default);
    Task<List<CoordinatorOptionDto>> ListCoordinatorsAsync(CancellationToken ct = default);
    /// <summary>按当前在办数量最少的协调员自动分派;供后续任务(P2 自动匹配受影响预订)在创建新案件时调用。</summary>
    Task<Guid?> AssignLeastBusyCoordinatorAsync(CancellationToken ct = default);
    Task TransferAsync(Guid caseId, Guid toCoordinatorId, Guid actorUserId, CancellationToken ct = default);
    Task CloseAsync(Guid caseId, CloseCaseRequest request, Guid actorUserId, CancellationToken ct = default);
    Task SetPriorityAsync(Guid caseId, string priority, CancellationToken ct = default);
    Task<List<CaseNoteDto>> ListNotesAsync(Guid caseId, CancellationToken ct = default);
    Task AddNoteAsync(Guid caseId, Guid authorUserId, string body, CancellationToken ct = default);
    Task<List<CaseNotificationDto>> ListCaseNotificationsAsync(Guid caseId, CancellationToken ct = default);
    Task<PushOptionsResultDto> ResendNotificationAsync(Guid notificationId, CancellationToken ct = default);
}
