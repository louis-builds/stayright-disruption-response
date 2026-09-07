using TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

namespace TravelDisruptionAgent.Api.Features.Coordinator;

public interface ICoordinatorRepository
{
    Task<List<Case>> ListQueueAsync(CancellationToken ct = default);
    Task<List<Case>> ListByDisruptionAsync(Guid disruptionId, CancellationToken ct = default);
    Task<List<Case>> ListMineAsync(Guid coordinatorId, string status, CancellationToken ct = default);
    Task<List<Case>> ListClosedAsync(int days, CancellationToken ct = default);
    Task<List<Case>> SearchAsync(string query, CancellationToken ct = default);
    Task<Case?> FindByIdAsync(Guid caseId, CancellationToken ct = default);
    Task<int> CountInProgressForCoordinatorAsync(Guid coordinatorId, CancellationToken ct = default);
    Task<List<User>> ListCoordinatorsAsync(CancellationToken ct = default);
    Task AddAssignmentAsync(CaseAssignment assignment, CancellationToken ct = default);
    Task<List<CaseNote>> ListNotesAsync(Guid caseId, CancellationToken ct = default);
    Task AddNoteAsync(CaseNote note, CancellationToken ct = default);
    /// <summary>"高价值客人"：判定口径是有 2 次及以上非取消预订(回头客)，不是消费金额——demo 数据里金额字段不够可靠。</summary>
    Task<HashSet<Guid>> GetHighValueGuestIdsAsync(IEnumerable<Guid> guestUserIds, CancellationToken ct = default);

    Task<int> CountActiveDisruptionsByTypeAsync(string type, CancellationToken ct = default);
    Task<int> CountNewAffectedBookingsTodayAsync(CancellationToken ct = default);
    Task<int> CountByStatusAsync(string status, CancellationToken ct = default);
    Task<int> CountClosedTodayAsync(CancellationToken ct = default);
    Task<(Guid Id, string Title, int AffectedCount)?> FindBiggestImpactDisruptionAsync(CancellationToken ct = default);

    Task<bool> HasRefundConfirmationAsync(Guid caseId, CancellationToken ct = default);
    Task<bool> HasPendingHotelConfirmationAsync(Guid caseId, CancellationToken ct = default);
    Task<HashSet<Guid>> GetPendingHotelConfirmationCaseIdsAsync(IEnumerable<Guid> caseIds, CancellationToken ct = default);
    Task<Guid?> FindHotelAccountUserIdAsync(Guid hotelId, CancellationToken ct = default);
    Task<List<Notification>> ListCaseNotificationsAsync(Guid caseId, CancellationToken ct = default);
    Task<Notification?> FindNotificationAsync(Guid notificationId, CancellationToken ct = default);
    Task AddNotificationAsync(Notification notification, CancellationToken ct = default);
    Task<User?> FindUserByIdAsync(Guid userId, CancellationToken ct = default);

    Task SaveChangesAsync(CancellationToken ct = default);
}
