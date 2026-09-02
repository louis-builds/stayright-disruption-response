using Microsoft.EntityFrameworkCore;
using TravelDisruptionAgent.Api.Infrastructure.Data;
using TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

namespace TravelDisruptionAgent.Api.Features.HotelPortal;

public class HotelRepository(AppDbContext db) : IHotelRepository
{
    public Task<Guid?> FindHotelIdForUserAsync(Guid userId, CancellationToken ct = default) =>
        db.Users.Where(u => u.Id == userId).Select(u => u.HotelId).FirstOrDefaultAsync(ct);

    // 酒店口径的回头客：在这一家酒店本身≥2单，不看客人在平台其它酒店订过多少次——
    // 跟下面 GetPlatformHighValueGuestIdsAsync 那个"平台高价值客人"是两个不同概念，之前三边
    // (Coordinator/Disruption/Hotel)共用同一段终身累计、不分酒店的代码，酒店视角显示的"回头客"
    // 其实是"在平台任何酒店订过两次"，跟这家酒店本身有没有回头客毫无关系，语义是错的。
    // 不加时间窗口——同一家酒店订两次本来就是小概率事件，不需要再靠时间衰减去筛。
    public async Task<HashSet<Guid>> GetReturningGuestIdsAsync(IEnumerable<Guid> guestUserIds, Guid hotelId, CancellationToken ct = default)
    {
        var ids = guestUserIds.Distinct().ToList();
        if (ids.Count == 0) return [];
        var highValue = await db.Bookings
            .Where(b => ids.Contains(b.GuestUserId) && b.HotelId == hotelId && b.Status != "cancelled")
            .GroupBy(b => b.GuestUserId)
            .Where(g => g.Count() >= 2)
            .Select(g => g.Key)
            .ToListAsync(ct);
        return [.. highValue];
    }

    // 平台口径的高价值客人：跟 CoordinatorRepository/DisruptionRepository 同一套口径(近12个月≥2单
    // 且累计消费≥NZD 1000)。酒店端也要能看到——这标签跟"是不是我这家的回头客"无关，是平台整体
    // 判断这个客人值不值得多花心思服务，酒店视角同样有用。
    public async Task<HashSet<Guid>> GetPlatformHighValueGuestIdsAsync(IEnumerable<Guid> guestUserIds, CancellationToken ct = default)
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

    // H1 卡的"客人已拍板"状态来源：case 的 defer 方案被客人点过 P7 确认(ExecutionRequestedAt!=null)。
    // pending 的 H1 卡靠它把"请确认方案是否可行"升级成"客人已确认，等你核实空房"——同一件事
    // 不再另发 H2 卡(见 ListSelectedPendingOptionsAsync 的过滤)，这是那张卡唯一的升级通道。
    public async Task<HashSet<Guid>> GetCaseIdsWithCommittedDeferAsync(IEnumerable<Guid> caseIds, CancellationToken ct = default)
    {
        var ids = caseIds.Distinct().ToList();
        if (ids.Count == 0) return [];
        return [.. await db.Options
            .Where(o => ids.Contains(o.CaseId) && o.OptionType == "defer" && o.ExecutionRequestedAt != null)
            .Select(o => o.CaseId)
            .ToListAsync(ct)];
    }

    // H2 卡被酒店确认/拒绝后回写 H1 询单用(见 HotelService.ClosePendingInquiriesAsync)。
    public Task<List<Inquiry>> ListPendingInquiriesAsync(Guid caseId, CancellationToken ct = default) =>
        db.Inquiries.Where(i => i.CaseId == caseId && i.Status == "pending").ToListAsync(ct);

    public Task<List<Option>> ListSelectedPendingOptionsAsync(CancellationToken ct = default) =>
        db.Options
            .Include(o => o.Case).ThenInclude(c => c!.Disruption)
            .Include(o => o.Case).ThenInclude(c => c!.Booking).ThenInclude(b => b!.Hotel)
            .Include(o => o.Case).ThenInclude(c => c!.Booking).ThenInclude(b => b!.GuestUser)
            // 案件可能已经通过别的方案(比如客人后来改选了别的选项)结案，这条曾经被请求执行、
            // 但从没被酒店确认/拒绝过的选项就成了孤儿——不能再当"待处理"推给酒店，
            // 不然酒店确认/拒绝一个早已结案案件的选项，还会误发一条通知给客人。
            .Where(o => o.ExecutionRequestedAt != null && o.Availability == "pending" &&
                (o.OptionType == "defer" || o.OptionType == "alternate") && o.Case!.Status != "closed" &&
                // defer 的 H2 卡和 H1 询单问的是同一件事(原酒店能不能接这单延期)：H1 还在 pending 时
                // 不再为 defer 出第二张卡，酒店只在 H1 卡上看到"客人已确认"状态(见 InquiryItemDto.GuestCommitted)。
                // alternate 不受影响——候补酒店从来没有 H1，H2 就是它唯一的待办。
                !(o.OptionType == "defer" &&
                  db.Inquiries.Any(i => i.CaseId == o.CaseId && i.Status == "pending" &&
                      i.HotelId == o.Case!.Booking!.HotelId)))
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

    public Task<HotelRefundPolicy?> GetActiveRefundPolicyAsync(Guid hotelId, CancellationToken ct = default) =>
        db.HotelRefundPolicies
            .Where(p => p.HotelId == hotelId && p.IsActive)
            .OrderByDescending(p => p.CreatedAt)
            .FirstOrDefaultAsync(ct);

    public async Task<HotelRefundPolicy> UpsertRefundPolicyAsync(Guid hotelId, UpsertHotelRefundPolicyRequest request, CancellationToken ct = default)
    {
        var now = DateTimeOffset.UtcNow;
        var existing = await db.HotelRefundPolicies
            .Where(p => p.HotelId == hotelId && p.IsActive)
            .ToListAsync(ct);
        foreach (var p in existing)
        {
            p.IsActive = false;
            p.UpdatedAt = now;
        }

        var policy = new HotelRefundPolicy
        {
            Id = Guid.NewGuid(),
            HotelId = hotelId,
            Content = request.Content,
            StructuredRulesJson = request.StructuredRulesJson,
            IsActive = request.IsActive,
            EffectiveFrom = request.EffectiveFrom,
            EffectiveUntil = request.EffectiveUntil,
            CreatedAt = now,
            UpdatedAt = now,
        };
        await db.HotelRefundPolicies.AddAsync(policy, ct);
        await db.SaveChangesAsync(ct);
        return policy;
    }

    public Task SaveChangesAsync(CancellationToken ct = default) => db.SaveChangesAsync(ct);
}
