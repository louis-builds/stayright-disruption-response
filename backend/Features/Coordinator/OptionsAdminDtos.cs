namespace TravelDisruptionAgent.Api.Features.Coordinator;

public record AdminOptionDto(
    Guid Id, string OptionType, string Availability, bool Selected, bool Locked, string? UnavailableReason,
    string PayloadJson, DateTimeOffset CreatedAt, string? CustomTitle, List<string> PerkNames,
    bool? CoordinatorVisibilityOverride, DateTimeOffset? ExecutionRequestedAt);

public record UpdateOptionPayloadRequest(Dictionary<string, object> Payload);

public record MarkUnavailableRequest(string Reason);

public record UnlockOptionRequest(string Reason);

public record SetVisibilityRequest(bool? Visible);

public record PushOptionsResultDto(bool Success, DateTimeOffset SentAt);

public record PushOptionsStatusDto(bool CanPush, string State, DateTimeOffset? LastAttemptAt);

public record AlternateCandidatePreviewDto(
    string Hotel, string RoomType, string RoomDescription, List<string> RoomAmenities, List<string> RoomImageUrls,
    decimal FeeDiff, string Currency, double? DistanceKm, string Reason);
