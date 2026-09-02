using Microsoft.AspNetCore.Http;

namespace TravelDisruptionAgent.Api.Features.HotelPortal;

public interface IHotelService
{
    Task<List<InquiryItemDto>> ListInquiriesAsync(Guid hotelUserId, string? status, CancellationToken ct = default);
    Task ConfirmInquiryAsync(Guid hotelUserId, Guid inquiryId, ConfirmInquiryRequest request, CancellationToken ct = default);
    Task RejectInquiryAsync(Guid hotelUserId, Guid inquiryId, RejectInquiryRequest request, CancellationToken ct = default);

    Task<List<SelectedOptionItemDto>> ListSelectedOptionsAsync(Guid hotelUserId, CancellationToken ct = default);
    Task<List<SelectedOptionItemDto>> ListResolvedOptionsHistoryAsync(Guid hotelUserId, CancellationToken ct = default);
    Task ConfirmOptionAsync(Guid hotelUserId, Guid optionId, CancellationToken ct = default);
    Task RejectOptionAsync(Guid hotelUserId, Guid optionId, RejectInquiryRequest request, CancellationToken ct = default);

    Task<HotelProfileDto> GetProfileAsync(Guid hotelUserId, CancellationToken ct = default);
    Task UpdateProfileAsync(Guid hotelUserId, UpdateHotelProfileRequest request, CancellationToken ct = default);
    Task<RoomTypeDto> AddRoomTypeAsync(Guid hotelUserId, UpsertRoomTypeRequest request, CancellationToken ct = default);
    Task UpdateRoomTypeAsync(Guid hotelUserId, Guid roomTypeId, UpsertRoomTypeRequest request, CancellationToken ct = default);
    Task DeleteRoomTypeAsync(Guid hotelUserId, Guid roomTypeId, CancellationToken ct = default);

    Task<HotelPerkDto> AddPerkAsync(Guid hotelUserId, AddHotelPerkRequest request, CancellationToken ct = default);
    Task DeletePerkAsync(Guid hotelUserId, Guid perkId, CancellationToken ct = default);

    Task<HotelRefundPolicyDto?> GetRefundPolicyAsync(Guid hotelUserId, CancellationToken ct = default);
    Task<HotelRefundPolicyDto> UpsertRefundPolicyAsync(Guid hotelUserId, UpsertHotelRefundPolicyRequest request, CancellationToken ct = default);
    Task<HotelRefundPolicyDto> UploadRefundPolicyFileAsync(Guid hotelUserId, IFormFile file, UploadRefundPolicyFileRequest request, CancellationToken ct = default);

    /// <summary>给这家酒店自己名下的方案(defer 或目标是自己的 alternate)附加/替换权益快照。</summary>
    Task SetOptionPerksAsync(Guid hotelUserId, Guid optionId, SetOptionPerksRequest request, CancellationToken ct = default);
    /// <summary>酒店给某个案件新开一个自定义方案(不是标准三类型)，立即可选。</summary>
    Task<SelectedOptionItemDto> CreateCustomOptionAsync(Guid hotelUserId, Guid caseId, CreateCustomOptionRequest request, CancellationToken ct = default);
}
