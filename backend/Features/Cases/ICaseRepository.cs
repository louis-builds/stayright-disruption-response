using TravelDisruptionAgent.Api.Infrastructure.Data.Entities;
using TravelDisruptionAgent.Api.Infrastructure.Paging;

namespace TravelDisruptionAgent.Api.Features.Cases;

public interface ICaseRepository
{
    /// <summary>带 Booking 一起加载，用来做"这个案件是不是这个客人的"权限判断。</summary>
    Task<Case?> FindWithBookingAsync(Guid caseId, CancellationToken ct = default);
    /// <summary>客人首页"我的待办"：带 Disruption/Booking/Hotel 一起加载，够渲染列表不用二次查询。</summary>
    Task<List<Case>> ListForGuestAsync(Guid guestUserId, bool includeClosed, CancellationToken ct = default);
    /// <summary>P4 对话页用：带 Disruption + Booking.Hotel 一起加载，够拼 AI 提示词和开场白。</summary>
    Task<Case?> FindFullAsync(Guid caseId, CancellationToken ct = default);
    Task<bool> IsHotelConfirmedAsync(Guid caseId, CancellationToken ct = default);
    Task<Message?> FindMessageAsync(Guid messageId, Guid caseId, CancellationToken ct = default);
    Task<List<Option>> ListOptionsAsync(Guid caseId, CancellationToken ct = default);
    Task<Option?> FindOptionAsync(Guid optionId, Guid caseId, CancellationToken ct = default);
    Task UnselectOtherOptionsAsync(Guid caseId, Guid keepOptionId, CancellationToken ct = default);
    Task<Hotel?> FindHotelByNameAsync(string name, CancellationToken ct = default);
    Task<Guid?> FindHotelAccountUserIdAsync(Guid hotelId, CancellationToken ct = default);
    Task<string?> FindHotelAccountEmailAsync(Guid hotelId, CancellationToken ct = default);
    Task<PagedResult<Message>> ListMessagesAsync(Guid caseId, string thread, int page, int pageSize, CancellationToken ct = default);
    Task AddMessageAsync(Message message, CancellationToken ct = default);
    Task AddNotificationAsync(Notification notification, CancellationToken ct = default);
    /// <summary>去重用：这个案件对这家酒店是不是已经有一条待处理的询单了，避免重复打扰酒店。</summary>
    Task<bool> HasPendingInquiryAsync(Guid caseId, Guid hotelId, CancellationToken ct = default);
    Task AddInquiryAsync(Inquiry inquiry, CancellationToken ct = default);
    Task<Inquiry?> FindDeferInquiryAsync(Guid caseId, CancellationToken ct = default);
    /// <summary>改订生效或 H2 卡被酒店处理时，把同一案件还停在 pending 的 H1 询单一并闭环（保底联动）。</summary>
    Task<List<Inquiry>> ListPendingInquiriesAsync(Guid caseId, CancellationToken ct = default);
    /// <summary>打开对话：把这个案件下发给当前用户的未读通知（铃铛）清零，不碰消息已读——消息已读走 MarkMessageReadAsync。</summary>
    Task MarkThreadReadAsync(Guid caseId, string thread, string readerRole, Guid readerUserId, CancellationToken ct = default);
    /// <summary>单条消息已读：客人在这条消息上停留满3秒后才调用。</summary>
    Task MarkMessageReadAsync(Guid messageId, string readerRole, CancellationToken ct = default);
    /// <summary>页签未读徽章用——过滤条件跟 MarkMessageReadAsync 一致，这里只数数不标记。</summary>
    Task<int> CountUnreadInThreadAsync(Guid caseId, string thread, string readerRole, CancellationToken ct = default);
    Task<bool> HasRefundConfirmationAsync(Guid caseId, CancellationToken ct = default);
    Task AddRefundConfirmationAsync(RefundConfirmation confirmation, CancellationToken ct = default);
    Task<RefundConfirmation?> FindRefundConfirmationAsync(Guid caseId, CancellationToken ct = default);
    Task SaveChangesAsync(CancellationToken ct = default);
}
