using TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

namespace TravelDisruptionAgent.Api.Features.Coordinator;

public interface IOptionsAdminRepository
{
    Task<Case?> FindCaseWithContextAsync(Guid caseId, CancellationToken ct = default);
    Task<string?> FindCaseStatusAsync(Guid caseId, CancellationToken ct = default);
    Task<List<Option>> ListOptionsAsync(Guid caseId, CancellationToken ct = default);
    Task<Option?> FindOptionAsync(Guid optionId, Guid caseId, CancellationToken ct = default);
    Task AddOptionAsync(Option option, CancellationToken ct = default);
    Task RemoveOptionAsync(Option option, CancellationToken ct = default);
    /// <summary>差价计算用:同城/同区域里除原酒店外最便宜的一个房型(含所属酒店)。</summary>
    Task<(Hotel Hotel, RoomType RoomType)?> FindCheapestAlternateAsync(Guid excludeHotelId, CancellationToken ct = default);
    Task AddLockAuditAsync(OptionLockAudit audit, CancellationToken ct = default);
    Task AddNotificationAsync(Notification notification, CancellationToken ct = default);
    Task SaveChangesAsync(CancellationToken ct = default);
}
