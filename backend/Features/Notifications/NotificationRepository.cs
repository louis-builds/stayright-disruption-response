using Microsoft.EntityFrameworkCore;
using TravelDisruptionAgent.Api.Infrastructure.Data;
using TravelDisruptionAgent.Api.Infrastructure.Data.Entities;
using TravelDisruptionAgent.Api.Infrastructure.Paging;

namespace TravelDisruptionAgent.Api.Features.Notifications;

public class NotificationRepository(AppDbContext db) : INotificationRepository
{
    public Task<PagedResult<Notification>> ListForUserAsync(Guid userId, int page, int pageSize, CancellationToken ct = default) =>
        db.Notifications
            .Where(n => n.UserId == userId)
            .Include(n => n.Case).ThenInclude(c => c!.Disruption)
            .Include(n => n.Case).ThenInclude(c => c!.Booking)
            .OrderByDescending(n => n.SentAt)
            .ToPagedResultAsync(page, pageSize, ct);

    public Task<int> CountUnreadAsync(Guid userId, CancellationToken ct = default) =>
        db.Notifications.CountAsync(n => n.UserId == userId && n.ReadAt == null, ct);

    public Task<Notification?> FindAsync(Guid id, Guid userId, CancellationToken ct = default) =>
        db.Notifications.FirstOrDefaultAsync(n => n.Id == id && n.UserId == userId, ct);

    public Task SaveChangesAsync(CancellationToken ct = default) => db.SaveChangesAsync(ct);
}
