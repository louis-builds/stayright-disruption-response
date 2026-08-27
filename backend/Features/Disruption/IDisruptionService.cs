namespace TravelDisruptionAgent.Api.Features.Disruption;

public interface IDisruptionService
{
    Task<List<DisruptionListItemDto>> ListAsync(string? type, string? region, CancellationToken ct = default);
    Task<Guid> IngestAsync(CreateDisruptionRequest request, CancellationToken ct = default);
    Task<DisruptionDetailDto> GetAsync(Guid id, CancellationToken ct = default);
    Task AssignAsync(Guid id, Guid toCoordinatorId, CancellationToken ct = default);
    Task AdjustWindowAsync(Guid id, AdjustWindowRequest request, Guid actorUserId, CancellationToken ct = default);
    Task ResolveAsync(Guid id, CancellationToken ct = default);
    Task<List<CandidateBookingDto>> GetCandidatesAsync(Guid id, CancellationToken ct = default);
    Task ExcludeCandidateAsync(Guid id, ExcludeCandidateRequest request, CancellationToken ct = default);
    Task<NotifyCandidatesResultDto> NotifyCandidatesAsync(Guid id, NotifyCandidatesRequest request, CancellationToken ct = default);
}
