namespace TravelDisruptionAgent.Api.Features.Coordinator;

public record BadCaseListItemDto(
    Guid MessageId, Guid CaseId, string GuestNickname, string DisruptionTitle, string AiReplyExcerpt, DateTimeOffset CreatedAt,
    bool Escalated, bool? MissedEscalationConfirmed);

public record BadCaseReplayDto(
    Guid MessageId, Guid CaseId, string? PrecedingGuestQuestion, string AiReply, string Analysis);

public record ConfirmMissedEscalationRequest(bool Confirmed);
