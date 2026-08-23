namespace TravelDisruptionAgent.Api.Features.HotelPortal;

public record InquiryItemDto(
    Guid Id, Guid CaseId, string ConfirmationNo, string GuestNickname, string DisruptionTitle,
    DateOnly CheckIn, DateOnly CheckOut, string RoomTypeName, string Status, DateTimeOffset RequestedAt, TimeSpan WaitTime, bool Overdue,
    bool IsHighValueGuest, DateTimeOffset? RespondedAt, string? RejectReason);

public record ConfirmInquiryRequest(DateOnly? NewCheckIn, DateOnly? NewCheckOut, string? Note);

public record RejectInquiryRequest(string Reason);

public record SelectedOptionItemDto(
    Guid OptionId, Guid CaseId, string ConfirmationNo, string GuestNickname, string OptionType,
    string PayloadJson, DateTimeOffset SelectedSince, string? CustomTitle, List<string> PerkNames, bool IsHighValueGuest,
    string Availability, string? UnavailableReason);

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
