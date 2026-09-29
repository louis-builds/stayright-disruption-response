namespace TravelDisruptionAgent.Api.Features.Calls;

public record InitiateCallRequest(string CalleeType);

public record CallDto(
    Guid Id, Guid CaseId, string CalleeType, Guid ReceiverUserId, string Status,
    DateTimeOffset StartedAt, DateTimeOffset? AnsweredAt, DateTimeOffset? EndedAt,
    string? EndedReason, int? DurationSeconds,
    string? GuestNickname = null, string? HotelName = null, string? ConfirmationNo = null,
    bool SpeakSlowly = false);

public record CallRecordingDto(
    Guid Id, Guid CallId, string FileUrl, int DurationSeconds, string? TranscriptText,
    string? AiSummary, string ProcessingStatus, bool Reviewed, string? CoordinatorNote,
    CallInsightsDto? Insights = null);

public record ReviewRecordingRequest(bool Reviewed, string? Note);

public record SubmitRecordingAuditRequest(int Rating, string? Comment);

public record RecordingAuditListItemDto(
    Guid CallId, Guid RecordingId, Guid CaseId, Guid CoordinatorUserId,
    string CoordinatorNickname, string? GuestNickname, string? ConfirmationNo, string CalleeType,
    DateTimeOffset StartedAt, int DurationSeconds, string ProcessingStatus,
    int? AuditRating, string? AuditComment, DateTimeOffset? AuditedAt, string? AuditedByNickname);

public record RecordingAuditDetailDto(
    Guid CallId, Guid RecordingId, Guid CaseId, Guid CoordinatorUserId,
    string CoordinatorNickname, string? GuestNickname, string? ConfirmationNo, string CalleeType,
    DateTimeOffset StartedAt, int DurationSeconds, string FileUrl,
    string? TranscriptText, string? AiSummary, string ProcessingStatus, string? CoordinatorNote,
    int? AuditRating, string? AuditComment, DateTimeOffset? AuditedAt, string? AuditedByNickname);
