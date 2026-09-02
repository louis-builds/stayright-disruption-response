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
    /// <summary>候补方案的候选池:除原酒店外所有在营酒店的房型(含所属酒店)。排序/打分交给调用方，
    /// 这里只管把候选取全，避免把"怎么选"的业务判断混进数据访问层。</summary>
    Task<List<(Hotel Hotel, RoomType RoomType)>> ListAlternateCandidatesAsync(Guid excludeHotelId, CancellationToken ct = default);
    Task AddLockAuditAsync(OptionLockAudit audit, CancellationToken ct = default);
    /// <summary>这个案件历史上给客人推荐过的所有备用酒店(跨多次 Regenerate)，打分选新候选时要排除。</summary>
    Task<HashSet<Guid>> ListOfferedAlternateHotelIdsAsync(Guid caseId, CancellationToken ct = default);
    Task AddAlternateOfferAsync(Guid caseId, Guid hotelId, CancellationToken ct = default);
    Task AddNotificationAsync(Notification notification, CancellationToken ct = default);
    Task SaveChangesAsync(CancellationToken ct = default);
}
