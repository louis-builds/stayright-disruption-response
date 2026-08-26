namespace TravelDisruptionAgent.Api.Features.HotelPortal;

// IsReturningGuest: 在这家酒店本身≥2单(HotelRepository)。IsHighValueGuest: 平台口径,近12个月≥2单且
// 累计消费≥NZD 1000(CoordinatorRepository/DisruptionRepository 同一套)。两个概念不同,标签颜色也不同。
// FinalOutcome: 案件结案后，客人最终有没有留在这家酒店("stayed"/"moved")——酒店点了 Accept 之后
// 案子会继续往下走(客人后续可能选了别的方案换到别家)，H1 这条请求本身的 Status 永远停在
// accepted 不会变，不看这个字段的话酒店无从知道自己批的方案最终有没有真被用上。还没结案时是 null。
public record InquiryItemDto(
    Guid Id, Guid CaseId, string ConfirmationNo, string GuestNickname, string DisruptionTitle,
    DateOnly CheckIn, DateOnly CheckOut, string RoomTypeName, string Status, DateTimeOffset RequestedAt, TimeSpan WaitTime, bool Overdue,
    bool IsReturningGuest, bool IsHighValueGuest, DateTimeOffset? RespondedAt, string? RejectReason, string? FinalOutcome);

public record ConfirmInquiryRequest(DateOnly? NewCheckIn, DateOnly? NewCheckOut, string? Note);

public record RejectInquiryRequest(string Reason);

public record SelectedOptionItemDto(
    Guid OptionId, Guid CaseId, string ConfirmationNo, string GuestNickname, string OptionType,
    string PayloadJson, DateTimeOffset SelectedSince, string? CustomTitle, List<string> PerkNames,
    bool IsReturningGuest, bool IsHighValueGuest, string Availability, string? UnavailableReason);

public record HotelWorkbenchItemDto(
    string Kind, Guid CaseId, string ConfirmationNo, string GuestNickname, string DisruptionTitle,
    string Status, DateTimeOffset RequestedAt, TimeSpan WaitTime, bool Overdue);

public record HotelProfileDto(Guid Id, string Name, string Address, double Lat, double Lng, List<RoomTypeDto> RoomTypes, List<HotelPerkDto> Perks);

public record RoomTypeDto(Guid Id, string Name, string Description, List<string> Amenities, int Capacity, decimal PriceAmount, string Currency, List<string> ImageUrls);

public record UpdateHotelProfileRequest(string Name, string Address, double Lat, double Lng);

public record UpsertRoomTypeRequest(string Name, string Description, List<string> Amenities, int Capacity, decimal PriceAmount, string Currency, List<string> ImageUrls);

public record HotelPerkDto(Guid Id, string Name);

public record AddHotelPerkRequest(string Name);

public record SetOptionPerksRequest(List<string> PerkNames);

public record CreateCustomOptionRequest(string Title, List<string> PerkNames);
