using TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

namespace TravelDisruptionAgent.Api.Features.Coordinator;

public interface IOptionsAdminService
{
    Task<List<AdminOptionDto>> GetOptionsAsync(Guid caseId, CancellationToken ct = default);
    Task SetGuestVisibilityAsync(Guid caseId, Guid optionId, bool? visible, CancellationToken ct = default);
    Task UpdatePayloadAsync(Guid caseId, Guid optionId, Dictionary<string, object> payload, CancellationToken ct = default);
    Task MarkUnavailableAsync(Guid caseId, Guid optionId, string reason, CancellationToken ct = default);
    Task LockAsync(Guid caseId, Guid optionId, Guid actorUserId, CancellationToken ct = default);
    Task UnlockAsync(Guid caseId, Guid optionId, Guid actorUserId, string reason, CancellationToken ct = default);
    Task RegenerateAsync(Guid caseId, CancellationToken ct = default);
    Task<Option?> RegenerateAlternateAsync(Guid caseId, string? preference, CancellationToken ct = default);
    Task<AlternateCandidatePreviewDto?> PreviewAlternateAsync(Guid caseId, string? preference, CancellationToken ct = default);
    Task<PushOptionsStatusDto> GetPushStatusAsync(Guid caseId, CancellationToken ct = default);
    Task<PushOptionsResultDto> PushAsync(Guid caseId, CancellationToken ct = default);
}
