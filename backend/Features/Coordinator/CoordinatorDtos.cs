namespace TravelDisruptionAgent.Api.Features.Coordinator;

public record OverviewDto(
    int ActiveWeatherCount, int ActiveFlightCount, int ActiveRoadCount,
    int NewAffectedBookingsToday, int PendingCount, int InProgressCount, int ClosedTodayCount,
    Guid? BiggestImpactDisruptionId, string? BiggestImpactDisruptionTitle, int BiggestImpactAffectedCount,
    int OverdueInProgressCount);

public record CaseQueueItemDto(
    Guid CaseId, string ConfirmationNo, string GuestNickname, string DisruptionTitle,
    string? EscalationReason, TimeSpan WaitTime, string Priority, string Status,
    Guid? AssigneeCoordinatorId, string? AssigneeNickname, bool Overdue, bool IsHighValueGuest);

public record CoordinatorOptionDto(Guid Id, string Nickname);

public record CaseNoteDto(Guid Id, string AuthorNickname, string Body, DateTimeOffset CreatedAt);

public record TransferRequest(Guid ToCoordinatorId);

public record CloseCaseRequest(string CloseReason, string ResultSummary);

public record AddNoteRequest(string Body);

public record CaseNotificationDto(Guid Id, string Channel, string Type, string Title, string Body, bool Success, DateTimeOffset SentAt);
