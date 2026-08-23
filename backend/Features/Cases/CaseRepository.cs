using Microsoft.EntityFrameworkCore;
using TravelDisruptionAgent.Api.Infrastructure.Data;
using TravelDisruptionAgent.Api.Infrastructure.Data.Entities;
using TravelDisruptionAgent.Api.Infrastructure.Paging;

namespace TravelDisruptionAgent.Api.Features.Cases;

public class CaseRepository(AppDbContext db) : ICaseRepository
{
    public Task<Case?> FindWithBookingAsync(Guid caseId, CancellationToken ct = default) =>
        db.Cases.Include(c => c.Booking).FirstOrDefaultAsync(c => c.Id == caseId, ct);

    public Task<List<Case>> ListForGuestAsync(Guid guestUserId, bool includeClosed, CancellationToken ct = default)
    {
        var query = db.Cases
            .Include(c => c.Disruption)
            .Include(c => c.Booking).ThenInclude(b => b!.Hotel)
            .Where(c => c.Booking!.GuestUserId == guestUserId);

        if (!includeClosed) query = query.Where(c => c.Status != "closed");

        return query.OrderByDescending(c => c.CreatedAt).ToListAsync(ct);
    }

    public Task<Case?> FindFullAsync(Guid caseId, CancellationToken ct = default) =>
        db.Cases
            .Include(c => c.Disruption)
            .Include(c => c.Booking).ThenInclude(b => b!.Hotel)
            .FirstOrDefaultAsync(c => c.Id == caseId, ct);

    public Task<bool> IsHotelConfirmedAsync(Guid caseId, CancellationToken ct = default) =>
        db.Inquiries.AnyAsync(i => i.CaseId == caseId && i.Status == "accepted", ct);

    public Task<Message?> FindMessageAsync(Guid messageId, Guid caseId, CancellationToken ct = default) =>
        db.Messages.FirstOrDefaultAsync(m => m.Id == messageId && m.CaseId == caseId, ct);

    // 已删/不可用的选项不展示给客人（Task 14 协调员端的 unavailable 标记）。
    public Task<List<Option>> ListOptionsAsync(Guid caseId, CancellationToken ct = default) =>
        db.Options.Where(o => o.CaseId == caseId && o.Availability != "unavailable").OrderBy(o => o.CreatedAt).ToListAsync(ct);

    public Task<Option?> FindOptionAsync(Guid optionId, Guid caseId, CancellationToken ct = default) =>
        db.Options.FirstOrDefaultAsync(o => o.Id == optionId && o.CaseId == caseId, ct);

    public async Task UnselectOtherOptionsAsync(Guid caseId, Guid keepOptionId, CancellationToken ct = default)
    {
        var others = await db.Options.Where(o => o.CaseId == caseId && o.Id != keepOptionId && o.Selected).ToListAsync(ct);
        foreach (var o in others)
        {
            o.Selected = false;
            o.UpdatedAt = DateTimeOffset.UtcNow;
        }
    }

    public Task<Hotel?> FindHotelByNameAsync(string name, CancellationToken ct = default) =>
        db.Hotels.FirstOrDefaultAsync(h => h.Name == name, ct);

    public Task<Guid?> FindHotelAccountUserIdAsync(Guid hotelId, CancellationToken ct = default) =>
        db.Users.Where(u => u.Role == "hotel" && u.HotelId == hotelId).Select(u => (Guid?)u.Id).FirstOrDefaultAsync(ct);

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
