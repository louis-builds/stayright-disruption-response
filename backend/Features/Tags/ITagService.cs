namespace TravelDisruptionAgent.Api.Features.Tags;

public interface ITagService
{
    Task<GuestTagsDto> GetGuestTagsAsync(Guid guestUserId, Guid currentUserId, string currentUserRole, CancellationToken ct = default);
    Task<Dictionary<Guid, GuestTagsDto>> GetGuestTagsBulkAsync(List<Guid> guestUserIds, Guid currentUserId, string currentUserRole, CancellationToken ct = default);
    Task<List<CustomTagDto>> ListCustomTagsAsync(Guid currentUserId, string currentUserRole, CancellationToken ct = default);
    Task<CustomTagDto> CreateCustomTagAsync(string label, Guid currentUserId, string currentUserRole, CancellationToken ct = default);
    Task DeleteCustomTagAsync(Guid tagId, Guid currentUserId, string currentUserRole, CancellationToken ct = default);
    Task ApplyTagAsync(Guid tagId, Guid guestUserId, Guid currentUserId, string currentUserRole, CancellationToken ct = default);
    Task RemoveTagAsync(Guid tagId, Guid guestUserId, CancellationToken ct = default);
}
