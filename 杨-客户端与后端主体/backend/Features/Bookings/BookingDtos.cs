namespace TravelDisruptionAgent.Api.Features.Bookings;

/// <summary>我的预订列表项：原预订详情 + （如果有关联案件）改订/取消结果。</summary>
public record BookingSummaryDto(
    Guid Id, string ConfirmationNo, string Status,
    string HotelName, string RoomTypeName, DateOnly CheckIn, DateOnly CheckOut,
    int GuestsCount, decimal TotalAmount, string Currency,
    string ContactName, string ContactPhone,
    Guid? CaseId, string? CaseStatus, string? CaseCloseReason,
    bool RefundConfirmed, decimal? RefundAmount, DateTimeOffset UpdatedAt);
