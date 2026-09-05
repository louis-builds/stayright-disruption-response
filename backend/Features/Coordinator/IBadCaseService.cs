namespace TravelDisruptionAgent.Api.Features.Coordinator;

public interface IBadCaseService
{
    Task<List<BadCaseListItemDto>> ListAsync(CancellationToken ct = default);
    Task<BadCaseReplayDto> ReplayAsync(Guid messageId, CancellationToken ct = default);
    Task ConfirmMissedEscalationAsync(Guid messageId, bool confirmed, CancellationToken ct = default);
}
