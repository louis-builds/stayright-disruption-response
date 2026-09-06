using TravelDisruptionAgent.Api.Infrastructure.Data.Entities;
using TravelDisruptionAgent.Api.Infrastructure.Paging;

namespace TravelDisruptionAgent.Api.Features.Notifications;

public interface INotificationRepository
{
    Task<PagedResult<Notification>> ListForUserAsync(Guid userId, int page, int pageSize, bool unreadOnly = false, CancellationToken ct = default);
    Task<int> CountUnreadAsync(Guid userId, CancellationToken ct = default);
    Task MarkCaseReadAsync(Guid userId, Guid caseId, CancellationToken ct = default);
    Task<Notification?> FindAsync(Guid id, Guid userId, CancellationToken ct = default);
    Task SaveChangesAsync(CancellationToken ct = default);
}
