using Microsoft.EntityFrameworkCore;
using TravelDisruptionAgent.Api.Infrastructure.Data;
using TravelDisruptionAgent.Api.Infrastructure.Data.Entities;
using TravelDisruptionAgent.Api.Infrastructure.Paging;

namespace TravelDisruptionAgent.Api.Features.Cases;

public class CaseRepository(AppDbContext db) : ICaseRepository
{
    public Task<Case?> FindWithBookingAsync(Guid caseId, CancellationToken ct = default) =>
        db.Cases
            .Include(c => c.Booking).ThenInclude(b => b!.Hotel)
            .FirstOrDefaultAsync(c => c.Id == caseId, ct);

    public Task<List<Case>> ListForGuestAsync(Guid guestUserId, bool includeClosed, CancellationToken ct = default)
    {
        var query = db.Cases
            .Include(c => c.Disruption)
            .Include(c => c.Booking).ThenInclude(b => b!.Hotel)
            .Include(c => c.Booking).ThenInclude(b => b!.RoomType)
            .Where(c => c.Booking!.GuestUserId == guestUserId);

        if (!includeClosed) query = query.Where(c => c.Status != "closed");

        return query.OrderByDescending(c => c.CreatedAt).ToListAsync(ct);
    }

    public Task<Case?> FindFullAsync(Guid caseId, CancellationToken ct = default) =>
        db.Cases
            .Include(c => c.Disruption)
            .Include(c => c.Booking).ThenInclude(b => b!.Hotel)
            .Include(c => c.Booking).ThenInclude(b => b!.RoomType)
            .FirstOrDefaultAsync(c => c.Id == caseId, ct);

    public Task<bool> IsHotelConfirmedAsync(Guid caseId, CancellationToken ct = default) =>
        db.Inquiries.AnyAsync(i => i.CaseId == caseId && i.Status == "accepted", ct);

    public Task<Message?> FindMessageAsync(Guid messageId, Guid caseId, CancellationToken ct = default) =>
        db.Messages.FirstOrDefaultAsync(m => m.Id == messageId && m.CaseId == caseId, ct);

    private static readonly Dictionary<string, int> OptionTypeOrder = new() { ["defer"] = 0, ["alternate"] = 1, ["cancel"] = 2, ["custom"] = 3 };

    // 已删/不可用的选项不展示给客人（Task 14 协调员端的 unavailable 标记）。
    // BuildDraftOptionsAsync 生成三选项草稿时共用同一个 now 做 CreatedAt，纯按 CreatedAt 排序在
    // 这种全相同值的情况下没有 tie-breaker，Postgres 返回顺序不保证稳定——客人选中一个选项后
    // 那一行被 UPDATE，下次查询顺序就可能跟着变，页面上的卡片跟着跳位置。改成按方案类型的
    // 固定语义顺序排(内存排，选项数量小，性能无所谓)，天然稳定，顺带比原始乱序更符合阅读直觉。
    public async Task<List<Option>> ListOptionsAsync(Guid caseId, CancellationToken ct = default)
    {
        var options = await db.Options.Where(o => o.CaseId == caseId && o.Availability != "unavailable").ToListAsync(ct);
        return [.. options.OrderBy(o => OptionTypeOrder.GetValueOrDefault(o.OptionType, 99)).ThenBy(o => o.CreatedAt)];
    }

    public Task<Option?> FindOptionAsync(Guid optionId, Guid caseId, CancellationToken ct = default) =>
        db.Options.FirstOrDefaultAsync(o => o.Id == optionId && o.CaseId == caseId, ct);

    public async Task UnselectOtherOptionsAsync(Guid caseId, Guid keepOptionId, CancellationToken ct = default)
    {
        var others = await db.Options.Where(o => o.CaseId == caseId && o.Id != keepOptionId && o.Selected).ToListAsync(ct);
        foreach (var o in others)
        {
            o.Selected = false;
            // 跟 SelectOptionAsync 的反悔分支同因：换选另一个方案时，旧方案的执行确认也要撤掉，
            // 不然酒店确认旧方案时会执行一个客人已经放弃的改订。
            o.ExecutionRequestedAt = null;
            o.UpdatedAt = DateTimeOffset.UtcNow;
        }
    }

    public Task<Hotel?> FindHotelByNameAsync(string name, CancellationToken ct = default) =>
        db.Hotels.FirstOrDefaultAsync(h => h.Name == name, ct);

    public Task<Guid?> FindHotelAccountUserIdAsync(Guid hotelId, CancellationToken ct = default) =>
        db.Users.Where(u => u.Role == "hotel" && u.HotelId == hotelId).Select(u => (Guid?)u.Id).FirstOrDefaultAsync(ct);

    public Task<string?> FindHotelAccountEmailAsync(Guid hotelId, CancellationToken ct = default) =>
        db.Users.Where(u => u.Role == "hotel" && u.HotelId == hotelId).Select(u => u.Email).FirstOrDefaultAsync(ct);

    public Task<PagedResult<Message>> ListMessagesAsync(Guid caseId, string thread, int page, int pageSize, CancellationToken ct = default) =>
        db.Messages.Where(m => m.CaseId == caseId && m.Thread == thread).OrderBy(m => m.CreatedAt).ToPagedResultAsync(page, pageSize, ct);

    public async Task AddMessageAsync(Message message, CancellationToken ct = default) =>
        await db.Messages.AddAsync(message, ct);

    public async Task AddNotificationAsync(Notification notification, CancellationToken ct = default) =>
        await db.Notifications.AddAsync(notification, ct);

    public Task<bool> HasPendingInquiryAsync(Guid caseId, Guid hotelId, CancellationToken ct = default) =>
        db.Inquiries.AnyAsync(i => i.CaseId == caseId && i.HotelId == hotelId && i.Status == "pending", ct);

    public async Task AddInquiryAsync(Inquiry inquiry, CancellationToken ct = default) =>
        await db.Inquiries.AddAsync(inquiry, ct);

    public Task<Inquiry?> FindDeferInquiryAsync(Guid caseId, CancellationToken ct = default) =>
        db.Inquiries.FirstOrDefaultAsync(i => i.CaseId == caseId && i.Type == "defer", ct);

    public Task<List<Inquiry>> ListPendingInquiriesAsync(Guid caseId, CancellationToken ct = default) =>
        db.Inquiries.Where(i => i.CaseId == caseId && i.Status == "pending").ToListAsync(ct);

    // 只负责清铃铛(站内通知)——消息本身的已读现在按单条来(MarkMessageReadAsync)，靠客人真的
    // 停留在那条消息上3秒才算读过，不是打开线程就瞬间全部已读，这两件事故意拆开。
    public async Task MarkThreadReadAsync(Guid caseId, string thread, string readerRole, Guid readerUserId, CancellationToken ct = default)
    {
        var now = DateTimeOffset.UtcNow;

        var unreadNotifications = await db.Notifications
            .Where(n => n.CaseId == caseId && n.UserId == readerUserId && n.ReadAt == null)
            .ToListAsync(ct);
        foreach (var n in unreadNotifications)
        {
            n.ReadAt = now;
            n.UpdatedAt = now;
        }
    }

    public async Task MarkMessageReadAsync(Guid messageId, string readerRole, CancellationToken ct = default)
    {
        var message = await db.Messages.FirstOrDefaultAsync(m => m.Id == messageId, ct);
        if (message is null || message.SenderRole == readerRole || message.ReadAt is not null) return;
        var now = DateTimeOffset.UtcNow;
        message.ReadAt = now;
        message.UpdatedAt = now;
    }

    public Task<int> CountUnreadInThreadAsync(Guid caseId, string thread, string readerRole, CancellationToken ct = default) =>
        db.Messages.CountAsync(m => m.CaseId == caseId && m.Thread == thread && m.SenderRole != readerRole && m.ReadAt == null, ct);

    public Task<bool> HasRefundConfirmationAsync(Guid caseId, CancellationToken ct = default) =>
        db.RefundConfirmations.AnyAsync(r => r.CaseId == caseId, ct);

    public async Task AddRefundConfirmationAsync(RefundConfirmation confirmation, CancellationToken ct = default) =>
        await db.RefundConfirmations.AddAsync(confirmation, ct);

    public Task<RefundConfirmation?> FindRefundConfirmationAsync(Guid caseId, CancellationToken ct = default) =>
        db.RefundConfirmations.FirstOrDefaultAsync(r => r.CaseId == caseId, ct);

    public Task SaveChangesAsync(CancellationToken ct = default) => db.SaveChangesAsync(ct);
}
