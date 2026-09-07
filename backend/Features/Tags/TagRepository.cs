using Microsoft.EntityFrameworkCore;
using TravelDisruptionAgent.Api.Infrastructure.Data;
using TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

namespace TravelDisruptionAgent.Api.Features.Tags;

public class TagRepository(AppDbContext db) : ITagRepository
{
    // 情绪敏感/AI处理难度高/拒绝率高——都是"这个客人历史上有没有至少一次这种转人工原因"，
    // 阈值先定成 1 次，样本量不够谈"占比"；真要调可以按后续实际转人工数据回来改。
    public Task<HashSet<Guid>> GetEmotionallySensitiveGuestIdsAsync(IEnumerable<Guid> guestUserIds, CancellationToken ct = default) =>
        GetGuestIdsWithEscalationReasonAsync(guestUserIds, ["客人情绪激动"], ct);

    public Task<HashSet<Guid>> GetAiDifficultGuestIdsAsync(IEnumerable<Guid> guestUserIds, CancellationToken ct = default) =>
        GetGuestIdsWithEscalationReasonAsync(guestUserIds, ["AI搞不定", "AI没把握"], ct);

    // 只算"客人拒绝全部方案"——"无可用候补或全拒方案"那条是酒店/系统没方案可给，不是客人挑剔，
    // 混进来会把运气不好的客人也标成"难满足"。
    public Task<HashSet<Guid>> GetHighRejectionGuestIdsAsync(IEnumerable<Guid> guestUserIds, CancellationToken ct = default) =>
        GetGuestIdsWithEscalationReasonAsync(guestUserIds, ["客人拒绝全部方案"], ct);

    private async Task<HashSet<Guid>> GetGuestIdsWithEscalationReasonAsync(IEnumerable<Guid> guestUserIds, string[] reasons, CancellationToken ct)
    {
        var ids = guestUserIds.Distinct().ToList();
        if (ids.Count == 0) return [];
        var matches = await db.Cases
            .Where(c => c.EscalationReason != null && reasons.Contains(c.EscalationReason) && ids.Contains(c.Booking!.GuestUserId))
            .Select(c => c.Booking!.GuestUserId)
            .Distinct()
            .ToListAsync(ct);
        return [.. matches];
    }

    // "回复慢"要看协调员发消息后客人隔了多久回——这个没法用一句 LINQ 表达成 SQL(要看"下一条"),
    // 干脆把相关消息一次性拉回来，在内存里按 case 分组配对算间隔。量级上一个客人的协调员对话不会多，
    // 拉全量不是问题。
    public async Task<HashSet<Guid>> GetSlowResponderGuestIdsAsync(IEnumerable<Guid> guestUserIds, CancellationToken ct = default)
    {
        var ids = guestUserIds.Distinct().ToList();
        if (ids.Count == 0) return [];

        var rows = await db.Messages
            .Where(m => m.Thread == "coordinator" && (m.SenderRole == "coordinator" || m.SenderRole == "guest"))
            .Where(m => ids.Contains(m.Case!.Booking!.GuestUserId))
            .Select(m => new { m.CaseId, GuestUserId = m.Case!.Booking!.GuestUserId, m.SenderRole, m.CreatedAt })
            .ToListAsync(ct);

        const double SlowResponseThresholdHours = 6.0;
        const int MinSamples = 2;

        var gapsByGuest = new Dictionary<Guid, List<double>>();
        foreach (var caseGroup in rows.GroupBy(r => r.CaseId))
        {
            var ordered = caseGroup.OrderBy(r => r.CreatedAt).ToList();
            for (var i = 0; i < ordered.Count - 1; i++)
            {
                if (ordered[i].SenderRole != "coordinator" || ordered[i + 1].SenderRole != "guest") continue;
                var gapHours = (ordered[i + 1].CreatedAt - ordered[i].CreatedAt).TotalHours;
                var guestId = ordered[i].GuestUserId;
                if (!gapsByGuest.TryGetValue(guestId, out var list)) gapsByGuest[guestId] = list = [];
                list.Add(gapHours);
            }
        }

        return [.. gapsByGuest.Where(kv => kv.Value.Count >= MinSamples && kv.Value.Average() >= SlowResponseThresholdHours).Select(kv => kv.Key)];
    }

    public Task<bool> IsGuestOfHotelAsync(Guid guestUserId, Guid hotelId, CancellationToken ct = default) =>
        db.Bookings.AnyAsync(b => b.GuestUserId == guestUserId && b.HotelId == hotelId, ct);

    public Task<List<CustomTag>> ListCustomTagsAsync(string ownerRole, Guid? hotelId, CancellationToken ct = default) =>
        db.CustomTags.Where(t => t.OwnerRole == ownerRole && t.HotelId == hotelId).OrderBy(t => t.CreatedAt).ToListAsync(ct);

    public Task<CustomTag?> FindCustomTagAsync(Guid id, CancellationToken ct = default) =>
        db.CustomTags.FirstOrDefaultAsync(t => t.Id == id, ct);

    public async Task<CustomTag> CreateCustomTagAsync(CustomTag tag, CancellationToken ct = default)
    {
        db.CustomTags.Add(tag);
        await db.SaveChangesAsync(ct);
        return tag;
    }

    public async Task DeleteCustomTagAsync(Guid id, CancellationToken ct = default)
    {
        var tag = await db.CustomTags.FirstOrDefaultAsync(t => t.Id == id, ct);
        if (tag is null) return;
        db.CustomTags.Remove(tag);
        await db.SaveChangesAsync(ct);
    }

    public Task<List<CustomTag>> ListGuestCustomTagsAsync(Guid guestUserId, CancellationToken ct = default) =>
        db.GuestCustomTags.Where(g => g.GuestUserId == guestUserId).Include(g => g.CustomTag).Select(g => g.CustomTag!).ToListAsync(ct);

    // 幂等：同一个标签重复打在同一个客人身上不报错，直接当没发生过——这不是用户能感知到的边界情况，
    // 报错只会让前端多写一层错误处理，没有实际价值。
    public async Task ApplyTagAsync(Guid customTagId, Guid guestUserId, Guid appliedByUserId, CancellationToken ct = default)
    {
        var exists = await db.GuestCustomTags.AnyAsync(g => g.CustomTagId == customTagId && g.GuestUserId == guestUserId, ct);
        if (exists) return;
        db.GuestCustomTags.Add(new GuestCustomTag
        {
            CustomTagId = customTagId,
            GuestUserId = guestUserId,
            AppliedByUserId = appliedByUserId,
            AppliedAt = DateTimeOffset.UtcNow,
        });
        await db.SaveChangesAsync(ct);
    }

    public async Task RemoveTagAsync(Guid customTagId, Guid guestUserId, CancellationToken ct = default)
    {
        var row = await db.GuestCustomTags.FirstOrDefaultAsync(g => g.CustomTagId == customTagId && g.GuestUserId == guestUserId, ct);
        if (row is null) return;
        db.GuestCustomTags.Remove(row);
        await db.SaveChangesAsync(ct);
    }
}
