using TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

namespace TravelDisruptionAgent.Api.Features.HotelPortal;

public interface IHotelRepository
{
    Task<Guid?> FindHotelIdForUserAsync(Guid userId, CancellationToken ct = default);
    /// <summary>"高价值客人"：判定口径是有 2 次及以上非取消预订(回头客)——跟协调员端同一套口径(CoordinatorRepository)。</summary>
    Task<HashSet<Guid>> GetHighValueGuestIdsAsync(IEnumerable<Guid> guestUserIds, CancellationToken ct = default);

    Task<List<Inquiry>> ListInquiriesAsync(Guid hotelId, string? status, CancellationToken ct = default);
    Task<Inquiry?> FindInquiryAsync(Guid inquiryId, Guid hotelId, CancellationToken ct = default);

    /// <summary>候选:所有 Selected=true 且 Availability=pending 的选项,连同 Case/Booking/Hotel 一起加载,
    /// 目标酒店由调用方在内存里按 option_type 解析后过滤(alternate 解析 payload.hotel,defer 用原酒店)。</summary>
    Task<List<Option>> ListSelectedPendingOptionsAsync(CancellationToken ct = default);
    Task<List<Option>> ListResolvedOptionsForHotelHistoryAsync(Guid hotelId, CancellationToken ct = default);
    Task<Option?> FindOptionAsync(Guid optionId, CancellationToken ct = default);
    Task<Option?> FindOptionByCaseAndTypeAsync(Guid caseId, string optionType, CancellationToken ct = default);
    Task<TravelDisruptionAgent.Api.Infrastructure.Data.Entities.Hotel?> FindHotelByNameAsync(string name, CancellationToken ct = default);

    Task<TravelDisruptionAgent.Api.Infrastructure.Data.Entities.Hotel?> FindHotelWithRoomTypesAsync(Guid hotelId, CancellationToken ct = default);
    Task AddRoomTypeAsync(RoomType roomType, CancellationToken ct = default);
    Task<RoomType?> FindRoomTypeAsync(Guid roomTypeId, Guid hotelId, CancellationToken ct = default);
    Task RemoveRoomTypeAsync(RoomType roomType, CancellationToken ct = default);

    Task<List<HotelPerk>> ListPerksAsync(Guid hotelId, CancellationToken ct = default);
    Task AddPerkAsync(HotelPerk perk, CancellationToken ct = default);
    Task<HotelPerk?> FindPerkAsync(Guid perkId, Guid hotelId, CancellationToken ct = default);
    Task RemovePerkAsync(HotelPerk perk, CancellationToken ct = default);

    /// <summary>酒店自定义方案(custom option)的归属校验用——案件绑定的订单当前在这家酒店才允许加。</summary>
    Task<Case?> FindCaseWithBookingAsync(Guid caseId, CancellationToken ct = default);
    /// <summary>自定义方案归属校验的补充查询:订单原属酒店之外,案件上如果有 alternate 方案指向本酒店
    /// (客人被安排改住到这家酒店),这家酒店也该有权给这个案件加自定义方案——不能只认订单原属酒店。</summary>
    Task<List<Option>> ListOptionsForCaseAsync(Guid caseId, CancellationToken ct = default);
    Task AddOptionAsync(Option option, CancellationToken ct = default);

    Task SaveChangesAsync(CancellationToken ct = default);
}
