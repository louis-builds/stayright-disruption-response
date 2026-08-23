namespace TravelDisruptionAgent.Api.Features.Disruption;

public record DisruptionListItemDto(
    Guid Id, string Type, string Title, string Region, DateTimeOffset StartAt, DateTimeOffset? EndAtOrWindow,
    string Status, int AffectedCount, Guid? AssigneeCoordinatorId, string? AssigneeNickname);

public record DisruptionDetailDto(
    Guid Id, string Type, string Title, string Region, DateTimeOffset StartAt, DateTimeOffset? EndAtOrWindow,
    string Status, string RawSignalText, int AffectedCount, Guid? AssigneeCoordinatorId, string? AssigneeNickname);

public record CandidateBookingDto(
    Guid BookingId, string ConfirmationNo, string GuestNickname, string HotelName,
    DateOnly CheckIn, DateOnly CheckOut, bool IsHighValueGuest);

public record AssignDisruptionRequest(Guid ToCoordinatorId);

public record AdjustWindowRequest(DateTimeOffset StartAt, DateTimeOffset? EndAtOrWindow);

public record ExcludeCandidateRequest(Guid BookingId, string Reason);

public record NotifyCandidatesRequest(List<Guid> BookingIds, string Priority);

public record NotifyCandidatesResultDto(int Notified);
