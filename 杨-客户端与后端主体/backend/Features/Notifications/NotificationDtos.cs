namespace TravelDisruptionAgent.Api.Features.Notifications;

public record NotificationDto(
    Guid Id, string Channel, string Type, string Title, string Body,
    Guid? CaseId, DateTimeOffset SentAt, DateTimeOffset? ReadAt, bool Success,
    string? DisruptionType, string? DisruptionTitle, DateOnly? AffectedCheckIn, string? CaseStatus);

public record UnreadCountDto(int Count);
