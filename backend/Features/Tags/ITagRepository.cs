using TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

namespace TravelDisruptionAgent.Api.Features.Tags;

public interface ITagRepository
{
    Task<HashSet<Guid>> GetEmotionallySensitiveGuestIdsAsync(IEnumerable<Guid> guestUserIds, CancellationToken ct = default);
    Task<HashSet<Guid>> GetAiDifficultGuestIdsAsync(IEnumerable<Guid> guestUserIds, CancellationToken ct = default);
    Task<HashSet<Guid>> GetHighRejectionGuestIdsAsync(IEnumerable<Guid> guestUserIds, CancellationToken ct = default);
    Task<HashSet<Guid>> GetSlowResponderGuestIdsAsync(IEnumerable<Guid> guestUserIds, CancellationToken ct = default);

    Task<bool> IsGuestOfHotelAsync(Guid guestUserId, Guid hotelId, CancellationToken ct = default);

    Task<List<CustomTag>> ListCustomTagsAsync(string ownerRole, Guid? hotelId, CancellationToken ct = default);
    Task<CustomTag?> FindCustomTagAsync(Guid id, CancellationToken ct = default);
    Task<CustomTag> CreateCustomTagAsync(CustomTag tag, CancellationToken ct = default);
    Task DeleteCustomTagAsync(Guid id, CancellationToken ct = default);

    Task<List<CustomTag>> ListGuestCustomTagsAsync(Guid guestUserId, CancellationToken ct = default);
    Task ApplyTagAsync(Guid customTagId, Guid guestUserId, Guid appliedByUserId, CancellationToken ct = default);
    Task RemoveTagAsync(Guid customTagId, Guid guestUserId, CancellationToken ct = default);
}
