namespace TravelDisruptionAgent.Api.Features.Calls;

public record InitiateCallRequest(string CalleeType);

public record CallDto(
    Guid Id, Guid CaseId, string CalleeType, Guid ReceiverUserId, string Status,
    DateTimeOffset StartedAt, DateTimeOffset? AnsweredAt, DateTimeOffset? EndedAt,
    string? EndedReason, int? DurationSeconds,
    string? GuestNickname = null, string? HotelName = null, string? ConfirmationNo = null);

public record CallRecordingDto(
    Guid Id, Guid CallId, string FileUrl, int DurationSeconds, string? TranscriptText,
    string? AiSummary, string ProcessingStatus, bool Reviewed, string? CoordinatorNote);

public record ReviewRecordingRequest(bool Reviewed, string? Note);
