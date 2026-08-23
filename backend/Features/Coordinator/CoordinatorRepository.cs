using Microsoft.EntityFrameworkCore;
using TravelDisruptionAgent.Api.Infrastructure.Data;
using TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

namespace TravelDisruptionAgent.Api.Features.Coordinator;

public class CoordinatorRepository(AppDbContext db) : ICoordinatorRepository
{
    private static IQueryable<Case> WithIncludes(IQueryable<Case> q) =>
        q.Include(c => c.Disruption).Include(c => c.Booking).ThenInclude(b => b!.GuestUser)
            .Include(c => c.Booking).ThenInclude(b => b!.Hotel);

    public Task<List<Case>> ListQueueAsync(CancellationToken ct = default) =>
        WithIncludes(db.Cases.Where(c => c.Status != "closed"))
            .OrderByDescending(c => c.Priority == "high").ThenBy(c => c.CreatedAt)
            .ToListAsync(ct);

    public Task<List<Case>> ListByDisruptionAsync(Guid disruptionId, CancellationToken ct = default) =>
        WithIncludes(db.Cases.Where(c => c.DisruptionId == disruptionId))
            .OrderByDescending(c => c.CreatedAt)
            .ToListAsync(ct);

    public Task<List<Case>> ListMineAsync(Guid coordinatorId, string status, CancellationToken ct = default) =>
        WithIncludes(db.Cases.Where(c => c.AssigneeCoordinatorId == coordinatorId && c.Status == status))
            .OrderByDescending(c => c.Priority == "high").ThenBy(c => c.CreatedAt)
            .ToListAsync(ct);

    public Task<List<Case>> ListClosedAsync(int days, CancellationToken ct = default)
    {
        var since = DateTimeOffset.UtcNow.AddDays(-days);
        return WithIncludes(db.Cases.Where(c => c.Status == "closed" && c.ClosedAt >= since))
            .OrderByDescending(c => c.ClosedAt)
            .ToListAsync(ct);
    }

    // 空查询 = 不过滤，返回全部案件("All" 标签页默认状态)；有查询词时按确认号/姓名/邮箱/电话模糊匹配。
    public Task<List<Case>> SearchAsync(string query, CancellationToken ct = default) =>
        WithIncludes(db.Cases.Where(c =>
                string.IsNullOrWhiteSpace(query) ||
                EF.Functions.ILike(c.Booking!.ConfirmationNo, $"%{query}%") ||
                EF.Functions.ILike(c.Booking!.GuestUser!.Nickname, $"%{query}%") ||
                EF.Functions.ILike(c.Booking!.GuestUser!.Email, $"%{query}%") ||
                EF.Functions.ILike(c.Booking!.GuestUser!.Phone, $"%{query}%")))
            .OrderByDescending(c => c.CreatedAt)
            .ToListAsync(ct);

    public Task<Case?> FindByIdAsync(Guid caseId, CancellationToken ct = default) =>
        WithIncludes(db.Cases).FirstOrDefaultAsync(c => c.Id == caseId, ct);

    public Task<int> CountInProgressForCoordinatorAsync(Guid coordinatorId, CancellationToken ct = default) =>
        db.Cases.CountAsync(c => c.AssigneeCoordinatorId == coordinatorId && c.Status == "in_progress", ct);

    public Task<List<User>> ListCoordinatorsAsync(CancellationToken ct = default) =>
        db.Users.Where(u => u.Role == "coordinator" && u.Status == "active").OrderBy(u => u.Nickname).ToListAsync(ct);

    public async Task AddAssignmentAsync(CaseAssignment assignment, CancellationToken ct = default) =>
        await db.CaseAssignments.AddAsync(assignment, ct);

    public Task<List<CaseNote>> ListNotesAsync(Guid caseId, CancellationToken ct = default) =>
        db.CaseNotes.Include(n => n.Author).Where(n => n.CaseId == caseId).OrderBy(n => n.CreatedAt).ToListAsync(ct);

    public async Task AddNoteAsync(CaseNote note, CancellationToken ct = default) =>
        await db.CaseNotes.AddAsync(note, ct);

    public async Task<HashSet<Guid>> GetHighValueGuestIdsAsync(IEnumerable<Guid> guestUserIds, CancellationToken ct = default)
    {
        var ids = guestUserIds.Distinct().ToList();
        if (ids.Count == 0) return [];
        var highValue = await db.Bookings
            .Where(b => ids.Contains(b.GuestUserId) && b.Status != "cancelled")
            .GroupBy(b => b.GuestUserId)
            .Where(g => g.Count() >= 2)
            .Select(g => g.Key)
            .ToListAsync(ct);
        return [.. highValue];
    }

    public Task<int> CountActiveDisruptionsByTypeAsync(string type, CancellationToken ct = default) =>
        db.Disruptions.CountAsync(d => d.Status == "active" && d.Type == type, ct);

    public Task<int> CountNewAffectedBookingsTodayAsync(CancellationToken ct = default)
    {
        var todayStart = new DateTimeOffset(DateTime.UtcNow.Date, TimeSpan.Zero);
        return db.Cases.CountAsync(c => c.CreatedAt >= todayStart, ct);
    }

    public Task<int> CountByStatusAsync(string status, CancellationToken ct = default) =>
        db.Cases.CountAsync(c => c.Status == status, ct);

    public Task<int> CountClosedTodayAsync(CancellationToken ct = default)
    {
        var todayStart = new DateTimeOffset(DateTime.UtcNow.Date, TimeSpan.Zero);
        return db.Cases.CountAsync(c => c.Status == "closed" && c.ClosedAt >= todayStart, ct);
    }

    public async Task<(Guid Id, string Title, int AffectedCount)?> FindBiggestImpactDisruptionAsync(CancellationToken ct = default)
    {
        var result = await db.Disruptions
            .Where(d => d.Status == "active")
            .Select(d => new { d.Id, d.Title, AffectedCount = db.Cases.Count(c => c.DisruptionId == d.Id) })
            .OrderByDescending(d => d.AffectedCount)
            .FirstOrDefaultAsync(ct);
        return result is null ? null : (result.Id, result.Title, result.AffectedCount);
    }

    public Task<bool> HasRefundConfirmationAsync(Guid caseId, CancellationToken ct = default) =>
        db.RefundConfirmations.AnyAsync(r => r.CaseId == caseId, ct);

    public Task<Guid?> FindHotelAccountUserIdAsync(Guid hotelId, CancellationToken ct = default) =>
        db.Users.Where(u => u.Role == "hotel" && u.HotelId == hotelId).Select(u => (Guid?)u.Id).FirstOrDefaultAsync(ct);

    public Task<List<Notification>> ListCaseNotificationsAsync(Guid caseId, CancellationToken ct = default) =>
        db.Notifications.Where(n => n.CaseId == caseId).OrderByDescending(n => n.SentAt).ToListAsync(ct);

    public Task<Notification?> FindNotificationAsync(Guid notificationId, CancellationToken ct = default) =>
        db.Notifications.FirstOrDefaultAsync(n => n.Id == notificationId, ct);

    public async Task AddNotificationAsync(Notification notification, CancellationToken ct = default) =>
        await db.Notifications.AddAsync(notification, ct);

    public Task<User?> FindUserByIdAsync(Guid userId, CancellationToken ct = default) =>
        db.Users.FirstOrDefaultAsync(u => u.Id == userId, ct);

    public Task SaveChangesAsync(CancellationToken ct = default) => db.SaveChangesAsync(ct);
}
