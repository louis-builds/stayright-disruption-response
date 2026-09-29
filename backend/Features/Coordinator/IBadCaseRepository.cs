using TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

namespace TravelDisruptionAgent.Api.Features.Coordinator;

public interface IBadCaseRepository
{
    Task<List<Message>> ListDislikedAsync(CancellationToken ct = default);
    Task<Message?> FindMessageAsync(Guid messageId, CancellationToken ct = default);
    Task<Message?> FindPrecedingGuestMessageAsync(Guid caseId, DateTimeOffset beforeCreatedAt, CancellationToken ct = default);
    Task<List<Message>> ListAiThreadAsync(Guid caseId, CancellationToken ct = default);
    Task<bool> SetMissedEscalationConfirmedAsync(Guid messageId, bool confirmed, CancellationToken ct = default);
    Task<Dictionary<Guid, BadCaseLearning>> ListLearningsByMessageIdsAsync(IEnumerable<Guid> messageIds, CancellationToken ct = default);
    Task<BadCaseLearning?> FindLearningByMessageIdAsync(Guid messageId, CancellationToken ct = default);
    Task AddLearningAsync(BadCaseLearning learning, CancellationToken ct = default);
    Task SaveChangesAsync(CancellationToken ct = default);
}
