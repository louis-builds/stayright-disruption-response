namespace TravelDisruptionAgent.Api.Features.Coordinator;

public record BadCaseListItemDto(
    Guid MessageId, Guid CaseId, string GuestNickname, string DisruptionTitle, string AiReplyExcerpt, DateTimeOffset CreatedAt,
    bool Escalated, bool? MissedEscalationConfirmed, string? LearningStatus);

public record BadCaseLearningDto(
    string Status, string EvaluationNote, string? DraftMarkdown, DateTimeOffset? ApprovedAt, int? LearnedRepliesVersion);

public record BadCaseThreadMessageDto(
    Guid Id, string SenderRole, string Content, string? Vote, DateTimeOffset CreatedAt, BadCaseLearningDto? Learning);

public record BadCaseThreadDto(
    Guid CaseId, Guid FocusMessageId, string GuestNickname, string DisruptionTitle,
    List<BadCaseThreadMessageDto> Messages);

public record BadCaseReplayDto(
    Guid MessageId, Guid CaseId, string? PrecedingGuestQuestion, string AiReply, string Analysis,
    BadCaseLearningDto? Learning);

public record ConfirmMissedEscalationRequest(bool Confirmed);

public record EvaluateBadCaseRequest(string? EvaluationNote);

public record SaveLearningDraftRequest(string? DraftMarkdown);
