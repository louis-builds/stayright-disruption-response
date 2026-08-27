using TravelDisruptionAgent.Api.Infrastructure.Data.Entities;
using DisruptionEntity = TravelDisruptionAgent.Api.Infrastructure.Data.Entities.Disruption;

namespace TravelDisruptionAgent.Api.Features.Disruption;

public interface IDisruptionRepository
{
    Task<List<DisruptionEntity>> ListAsync(string? type, string? region, CancellationToken ct = default);
    Task<DisruptionEntity?> FindByIdAsync(Guid id, CancellationToken ct = default);
    Task<int> CountAffectedAsync(Guid disruptionId, CancellationToken ct = default);
    /// <summary>候选预订：酒店地址落在中断影响区域内、离店日期不早于中断开始、入住日期不晚于恢复窗口，
    /// 且还没针对这次中断建过案、也没被人工复核剔除过。</summary>
    Task<List<Booking>> ListCandidateBookingsAsync(DisruptionEntity disruption, CancellationToken ct = default);
    Task AddExclusionAsync(DisruptionExclusion exclusion, CancellationToken ct = default);
    Task AddWindowAuditAsync(DisruptionWindowAudit audit, CancellationToken ct = default);
    Task AddCaseAsync(Case caseEntity, CancellationToken ct = default);
    Task AddInquiryAsync(Inquiry inquiry, CancellationToken ct = default);
    Task AddMessageAsync(Message message, CancellationToken ct = default);
    Task AddNotificationAsync(Notification notification, CancellationToken ct = default);
    Task<Guid?> FindHotelAccountUserIdAsync(Guid hotelId, CancellationToken ct = default);
    Task<string?> FindHotelAccountEmailAsync(Guid hotelId, CancellationToken ct = default);
    /// <summary>"高价值客人"：2 次及以上非取消预订(回头客)，跟协调员队列用的同一套口径。</summary>
    Task<HashSet<Guid>> GetHighValueGuestIdsAsync(IEnumerable<Guid> guestUserIds, CancellationToken ct = default);
    Task SaveChangesAsync(CancellationToken ct = default);
}
