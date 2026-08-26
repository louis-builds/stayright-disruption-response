using Microsoft.EntityFrameworkCore;
using TravelDisruptionAgent.Api.Infrastructure.Data;
using TravelDisruptionAgent.Api.Infrastructure.Data.Entities;
using DisruptionEntity = TravelDisruptionAgent.Api.Infrastructure.Data.Entities.Disruption;

namespace TravelDisruptionAgent.Api.Features.Disruption;

public class DisruptionRepository(AppDbContext db) : IDisruptionRepository
{
    public Task<List<DisruptionEntity>> ListAsync(string? type, string? region, CancellationToken ct = default)
    {
        var q = db.Disruptions.AsQueryable();
        if (!string.IsNullOrWhiteSpace(type)) q = q.Where(d => d.Type == type);
        if (!string.IsNullOrWhiteSpace(region)) q = q.Where(d => EF.Functions.ILike(d.Region, $"%{region}%"));
        return q.OrderByDescending(d => d.CreatedAt).ToListAsync(ct);
    }

    public Task<DisruptionEntity?> FindByIdAsync(Guid id, CancellationToken ct = default) =>
        db.Disruptions.FirstOrDefaultAsync(d => d.Id == id, ct);

    public async Task AddDisruptionAsync(DisruptionEntity disruption, CancellationToken ct = default) =>
        await db.Disruptions.AddAsync(disruption, ct);

    public Task<int> CountAffectedAsync(Guid disruptionId, CancellationToken ct = default) =>
        db.Cases.CountAsync(c => c.DisruptionId == disruptionId, ct);

    public Task<List<Booking>> ListCandidateBookingsAsync(DisruptionEntity disruption, CancellationToken ct = default)
    {
        var windowEnd = disruption.EndAtOrWindow;
        return db.Bookings
            .Include(b => b.Hotel)
            .Include(b => b.GuestUser)
            .Where(b => b.Hotel != null && EF.Functions.ILike(b.Hotel.Address, $"%{disruption.Region}%"))
            .Where(b => b.CheckOut >= DateOnly.FromDateTime(disruption.StartAt.UtcDateTime))
            .Where(b => windowEnd == null || b.CheckIn <= DateOnly.FromDateTime(windowEnd.Value.UtcDateTime))
            .Where(b => !db.Cases.Any(c => c.BookingId == b.Id && c.DisruptionId == disruption.Id))
            .Where(b => !db.DisruptionExclusions.Any(x => x.DisruptionId == disruption.Id && x.BookingId == b.Id))
            .OrderBy(b => b.CheckIn)
            .ToListAsync(ct);
    }

    public async Task AddExclusionAsync(DisruptionExclusion exclusion, CancellationToken ct = default) =>
        await db.DisruptionExclusions.AddAsync(exclusion, ct);

    public async Task AddWindowAuditAsync(DisruptionWindowAudit audit, CancellationToken ct = default) =>
        await db.DisruptionWindowAudits.AddAsync(audit, ct);

    public async Task AddCaseAsync(Case caseEntity, CancellationToken ct = default) =>
        await db.Cases.AddAsync(caseEntity, ct);

    public async Task AddInquiryAsync(Inquiry inquiry, CancellationToken ct = default) =>
        await db.Inquiries.AddAsync(inquiry, ct);

    public async Task AddNotificationAsync(Notification notification, CancellationToken ct = default) =>
        await db.Notifications.AddAsync(notification, ct);

    public Task<Guid?> FindHotelAccountUserIdAsync(Guid hotelId, CancellationToken ct = default) =>
        db.Users.Where(u => u.Role == "hotel" && u.HotelId == hotelId).Select(u => (Guid?)u.Id).FirstOrDefaultAsync(ct);

    // 平台口径的高价值客人：近12个月内下单≥2次且累计消费≥NZD 1000，不分酒店——跟 HotelRepository
    // 的"这家酒店的回头客"是两个不同概念，见 CoordinatorRepository 里同名方法的注释。
    public async Task<HashSet<Guid>> GetHighValueGuestIdsAsync(IEnumerable<Guid> guestUserIds, CancellationToken ct = default)
    {
        var ids = guestUserIds.Distinct().ToList();
        if (ids.Count == 0) return [];
        var since = DateTimeOffset.UtcNow.AddYears(-1);
        var highValue = await db.Bookings
            .Where(b => ids.Contains(b.GuestUserId) && b.Status != "cancelled" && b.CreatedAt >= since)
            .GroupBy(b => b.GuestUserId)
            .Where(g => g.Count() >= 2 && g.Sum(b => b.TotalAmount) >= 1000m)
            .Select(g => g.Key)
            .ToListAsync(ct);
        return [.. highValue];
    }

    public Task SaveChangesAsync(CancellationToken ct = default) => db.SaveChangesAsync(ct);
}
