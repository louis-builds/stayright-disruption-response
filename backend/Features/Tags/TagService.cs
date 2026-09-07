using TravelDisruptionAgent.Api.Features.HotelPortal;
using TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

namespace TravelDisruptionAgent.Api.Features.Tags;

public class TagService(ITagRepository tags, IHotelRepository hotels) : ITagService
{
    // 逐个 await,不能用 Task.WhenAll 并发跑——这几个查询共用同一个 request-scoped DbContext,
    // EF Core 不允许同一个 DbContext 实例被并发操作(会抛 ConcurrencyDetector 异常)。
    public async Task<GuestTagsDto> GetGuestTagsAsync(Guid guestUserId, Guid currentUserId, string currentUserRole, CancellationToken ct = default)
    {
        var ids = new[] { guestUserId };
        var isHighValue = (await hotels.GetPlatformHighValueGuestIdsAsync(ids, ct)).Contains(guestUserId);
        var isEmotional = (await tags.GetEmotionallySensitiveGuestIdsAsync(ids, ct)).Contains(guestUserId);
        var isAiDifficult = (await tags.GetAiDifficultGuestIdsAsync(ids, ct)).Contains(guestUserId);
        var isHighRejection = (await tags.GetHighRejectionGuestIdsAsync(ids, ct)).Contains(guestUserId);
        var isSlowResponder = (await tags.GetSlowResponderGuestIdsAsync(ids, ct)).Contains(guestUserId);
        var customTags = await tags.ListGuestCustomTagsAsync(guestUserId, ct);

        var isReturning = false;
        if (currentUserRole == "hotel")
        {
            var hotelId = await hotels.FindHotelIdForUserAsync(currentUserId, ct) ?? throw new HotelNotFoundException();
            isReturning = (await hotels.GetReturningGuestIdsAsync(ids, hotelId, ct)).Contains(guestUserId);
        }

        return new GuestTagsDto(
            IsHighValueGuest: isHighValue,
            IsReturningGuest: isReturning,
            EmotionallySensitive: isEmotional,
            AiDifficult: isAiDifficult,
            HighRejectionRate: isHighRejection,
            SlowResponder: isSlowResponder,
            CustomTags: [.. customTags.Select(ToDto)]);
    }

    public async Task<List<CustomTagDto>> ListCustomTagsAsync(Guid currentUserId, string currentUserRole, CancellationToken ct = default)
    {
        var hotelId = currentUserRole == "hotel" ? await hotels.FindHotelIdForUserAsync(currentUserId, ct) ?? throw new HotelNotFoundException() : (Guid?)null;
        var list = await tags.ListCustomTagsAsync(currentUserRole, hotelId, ct);
        return [.. list.Select(ToDto)];
    }

    public async Task<CustomTagDto> CreateCustomTagAsync(string label, Guid currentUserId, string currentUserRole, CancellationToken ct = default)
    {
        var hotelId = currentUserRole == "hotel" ? await hotels.FindHotelIdForUserAsync(currentUserId, ct) ?? throw new HotelNotFoundException() : (Guid?)null;
        var tag = await tags.CreateCustomTagAsync(new CustomTag
        {
            Label = label.Trim(),
            OwnerRole = currentUserRole,
            HotelId = hotelId,
            CreatedByUserId = currentUserId,
            CreatedAt = DateTimeOffset.UtcNow,
        }, ct);
        return ToDto(tag);
    }

    public async Task DeleteCustomTagAsync(Guid tagId, Guid currentUserId, string currentUserRole, CancellationToken ct = default)
    {
        await AuthorizeTagOwnerAsync(tagId, currentUserId, currentUserRole, ct);
        await tags.DeleteCustomTagAsync(tagId, ct);
    }

    public async Task ApplyTagAsync(Guid tagId, Guid guestUserId, Guid currentUserId, string currentUserRole, CancellationToken ct = default)
    {
        var tag = await AuthorizeTagOwnerAsync(tagId, currentUserId, currentUserRole, ct);
        if (currentUserRole == "hotel" && !await tags.IsGuestOfHotelAsync(guestUserId, tag.HotelId!.Value, ct))
            throw new TagAccessDeniedException();
        await tags.ApplyTagAsync(tagId, guestUserId, currentUserId, ct);
    }

    public Task RemoveTagAsync(Guid tagId, Guid guestUserId, CancellationToken ct = default) =>
        tags.RemoveTagAsync(tagId, guestUserId, ct);

    // 协调员的标签是团队共用的：谁都能管，不分创建人。酒店的标签只归那一家酒店，跨酒店互相
    // 看不到也管不到——这条边界比"谁创建的"更重要，不用细到按创建人再收紧。
    private async Task<CustomTag> AuthorizeTagOwnerAsync(Guid tagId, Guid currentUserId, string currentUserRole, CancellationToken ct)
    {
        var tag = await tags.FindCustomTagAsync(tagId, ct) ?? throw new TagNotFoundException();
        if (tag.OwnerRole != currentUserRole) throw new TagAccessDeniedException();
        if (currentUserRole == "hotel")
        {
            var hotelId = await hotels.FindHotelIdForUserAsync(currentUserId, ct) ?? throw new HotelNotFoundException();
            if (tag.HotelId != hotelId) throw new TagAccessDeniedException();
        }
        return tag;
    }

    private static CustomTagDto ToDto(CustomTag tag) => new(tag.Id, tag.Label, tag.OwnerRole);
}
