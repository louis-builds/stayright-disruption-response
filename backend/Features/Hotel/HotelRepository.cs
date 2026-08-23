using Microsoft.EntityFrameworkCore;
using TravelDisruptionAgent.Api.Infrastructure.Data;
using TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

namespace TravelDisruptionAgent.Api.Features.HotelPortal;

public class HotelRepository(AppDbContext db) : IHotelRepository
{
    public Task<Guid?> FindHotelIdForUserAsync(Guid userId, CancellationToken ct = default) =>
        db.Users.Where(u => u.Id == userId).Select(u => u.HotelId).FirstOrDefaultAsync(ct);

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

    private static IQueryable<Inquiry> WithIncludes(IQueryable<Inquiry> q) =>
        q.Include(i => i.Case).ThenInclude(c => c!.Disruption)
            .Include(i => i.Case).ThenInclude(c => c!.Booking).ThenInclude(b => b!.GuestUser)
            .Include(i => i.Case).ThenInclude(c => c!.Booking).ThenInclude(b => b!.RoomType);

    public Task<List<Inquiry>> ListInquiriesAsync(Guid hotelId, string? status, CancellationToken ct = default)
    {
        var query = WithIncludes(db.Inquiries.Where(i => i.HotelId == hotelId));
        if (!string.IsNullOrWhiteSpace(status)) query = query.Where(i => i.Status == status);
        return query.OrderBy(i => i.RequestedAt).ToListAsync(ct);
    }

    public Task<Inquiry?> FindInquiryAsync(Guid inquiryId, Guid hotelId, CancellationToken ct = default) =>
        WithIncludes(db.Inquiries).FirstOrDefaultAsync(i => i.Id == inquiryId && i.HotelId == hotelId, ct);

    public Task<List<Option>> ListSelectedPendingOptionsAsync(CancellationToken ct = default) =>
        db.Options
            .Include(o => o.Case).ThenInclude(c => c!.Disruption)
            .Include(o => o.Case).ThenInclude(c => c!.Booking).ThenInclude(b => b!.Hotel)
            .Include(o => o.Case).ThenInclude(c => c!.Booking).ThenInclude(b => b!.GuestUser)
            // 案件可能已经通过别的方案(比如客人后来改选了别的选项)结案，这条曾经被请求执行、
            // 但从没被酒店确认/拒绝过的选项就成了孤儿——不能再当"待处理"推给酒店，
            // 不然酒店确认/拒绝一个早已结案案件的选项，还会误发一条通知给客人。
            .Where(o => o.ExecutionRequestedAt != null && o.Availability == "pending" &&
                (o.OptionType == "defer" || o.OptionType == "alternate") && o.Case!.Status != "closed")
            .ToListAsync(ct);

    public Task<List<Option>> ListResolvedOptionsForHotelHistoryAsync(Guid hotelId, CancellationToken ct = default) =>
        db.Options
            .Include(o => o.Case).ThenInclude(c => c!.Disruption)
            .Include(o => o.Case).ThenInclude(c => c!.Booking).ThenInclude(b => b!.Hotel)
            .Include(o => o.Case).ThenInclude(c => c!.Booking).ThenInclude(b => b!.GuestUser)
            .Where(o => o.ExecutionRequestedAt != null && o.Availability != "pending" && (o.OptionType == "defer" || o.OptionType == "alternate"))
            .OrderByDescending(o => o.UpdatedAt)
            .ToListAsync(ct);

    public Task<Option?> FindOptionByCaseAndTypeAsync(Guid caseId, string optionType, CancellationToken ct = default) =>
        db.Options
            .Include(o => o.Case).ThenInclude(c => c!.Booking).ThenInclude(b => b!.Hotel)
            .Where(o => o.CaseId == caseId && o.OptionType == optionType && o.Availability != "unavailable")
            .FirstOrDefaultAsync(ct);

    public Task<Option?> FindOptionAsync(Guid optionId, CancellationToken ct = default) =>
        db.Options
            .Include(o => o.Case).ThenInclude(c => c!.Booking).ThenInclude(b => b!.Hotel)
            .FirstOrDefaultAsync(o => o.Id == optionId, ct);

    public Task<TravelDisruptionAgent.Api.Infrastructure.Data.Entities.Hotel?> FindHotelByNameAsync(string name, CancellationToken ct = default) =>
        db.Hotels.FirstOrDefaultAsync(h => h.Name == name, ct);

    public Task<TravelDisruptionAgent.Api.Infrastructure.Data.Entities.Hotel?> FindHotelWithRoomTypesAsync(Guid hotelId, CancellationToken ct = default) =>
        db.Hotels.Include(h => h.RoomTypes).FirstOrDefaultAsync(h => h.Id == hotelId, ct);

    public async Task AddRoomTypeAsync(RoomType roomType, CancellationToken ct = default) =>
        await db.RoomTypes.AddAsync(roomType, ct);

    public Task<RoomType?> FindRoomTypeAsync(Guid roomTypeId, Guid hotelId, CancellationToken ct = default) =>
        db.RoomTypes.FirstOrDefaultAsync(r => r.Id == roomTypeId && r.HotelId == hotelId, ct);

    public Task RemoveRoomTypeAsync(RoomType roomType, CancellationToken ct = default)
    {
        db.RoomTypes.Remove(roomType);
        return Task.CompletedTask;
    }

    public Task<List<HotelPerk>> ListPerksAsync(Guid hotelId, CancellationToken ct = default) =>
        db.HotelPerks.Where(p => p.HotelId == hotelId).OrderBy(p => p.Name).ToListAsync(ct);

    public async Task AddPerkAsync(HotelPerk perk, CancellationToken ct = default) =>
        await db.HotelPerks.AddAsync(perk, ct);

    public Task<HotelPerk?> FindPerkAsync(Guid perkId, Guid hotelId, CancellationToken ct = default) =>
        db.HotelPerks.FirstOrDefaultAsync(p => p.Id == perkId && p.HotelId == hotelId, ct);

    public Task RemovePerkAsync(HotelPerk perk, CancellationToken ct = default)
    {
        db.HotelPerks.Remove(perk);
        return Task.CompletedTask;
    }

    public Task<Case?> FindCaseWithBookingAsync(Guid caseId, CancellationToken ct = default) =>
        db.Cases.Include(c => c.Booking).ThenInclude(b => b!.GuestUser)
            .Include(c => c.Disruption)
            .FirstOrDefaultAsync(c => c.Id == caseId, ct);

    public Task<List<Option>> ListOptionsForCaseAsync(Guid caseId, CancellationToken ct = default) =>
        db.Options.Where(o => o.CaseId == caseId).ToListAsync(ct);

    public async Task AddOptionAsync(Option option, CancellationToken ct = default) =>
        await db.Options.AddAsync(option, ct);

    public Task SaveChangesAsync(CancellationToken ct = default) => db.SaveChangesAsync(ct);
}
