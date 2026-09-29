using TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

namespace TravelDisruptionAgent.Api.Features.Coordinator;

public interface IBadCaseService
{
    Task<List<BadCaseListItemDto>> ListAsync(CancellationToken ct = default);
    Task<BadCaseReplayDto> ReplayAsync(Guid messageId, CancellationToken ct = default);
    Task<BadCaseThreadDto> GetThreadAsync(Guid messageId, CancellationToken ct = default);
    Task ConfirmMissedEscalationAsync(Guid messageId, bool confirmed, CancellationToken ct = default);
    Task<BadCaseLearningDto> EvaluateAndDraftAsync(Guid messageId, Guid evaluatorUserId, string evaluationNote, CancellationToken ct = default);
    Task<BadCaseLearningDto> SaveDraftAsync(Guid messageId, string draftMarkdown, CancellationToken ct = default);
    Task<BadCaseLearningDto> ApproveAsync(Guid messageId, Guid approverUserId, string? draftMarkdown, CancellationToken ct = default);
    Task<BadCaseLearningDto> RejectAsync(Guid messageId, Guid evaluatorUserId, CancellationToken ct = default);
}