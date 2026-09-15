using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TravelDisruptionAgent.Api.Features.HotelPortal;
using TravelDisruptionAgent.Api.Infrastructure;

namespace TravelDisruptionAgent.Api.Features.Tags;

[ApiController]
[Route("api/tags")]
[Authorize(Roles = "coordinator,hotel")]
public class TagsController(ITagService tagService) : ControllerBase
{
    private Guid CurrentUserId => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);
    private string CurrentUserRole => User.FindFirstValue(ClaimTypes.Role)!;

    private async Task<ActionResult<ApiResponse<T>>> HandleAsync<T>(Func<Task<T>> action)
    {
        try
        {
            return new OkObjectResult(ApiResponse<T>.Ok(await action()));
        }
        catch (HotelNotFoundException)
        {
            return NotFound(ApiResponse<object?>.Fail(404, "No hotel is linked to this account"));
        }
        catch (TagNotFoundException)
        {
            return NotFound(ApiResponse<object?>.Fail(404, "Tag not found"));
        }
        catch (TagAccessDeniedException)
        {
            return StatusCode(403, ApiResponse.Forbidden());
        }
    }

    [HttpGet("guest/{guestUserId:guid}")]
    public Task<ActionResult<ApiResponse<GuestTagsDto>>> GetGuestTags(Guid guestUserId, CancellationToken ct) =>
        HandleAsync(() => tagService.GetGuestTagsAsync(guestUserId, CurrentUserId, CurrentUserRole, ct));

    [HttpPost("query")]
    public Task<ActionResult<ApiResponse<Dictionary<Guid, GuestTagsDto>>>> QueryGuestTags([FromBody] GuestTagsQueryRequest req, CancellationToken ct) =>
        HandleAsync(() => tagService.GetGuestTagsBulkAsync(req.GuestUserIds.Distinct().Take(200).ToList(), CurrentUserId, CurrentUserRole, ct));

    [HttpGet("custom")]
    public Task<ActionResult<ApiResponse<List<CustomTagDto>>>> ListCustomTags(CancellationToken ct) =>
        HandleAsync(() => tagService.ListCustomTagsAsync(CurrentUserId, CurrentUserRole, ct));

    [HttpPost("custom")]
    public Task<ActionResult<ApiResponse<CustomTagDto>>> CreateCustomTag([FromBody] CreateCustomTagRequest req, CancellationToken ct) =>
        HandleAsync(() => tagService.CreateCustomTagAsync(req.Label, CurrentUserId, CurrentUserRole, ct));

    [HttpDelete("custom/{id:guid}")]
    public Task<ActionResult<ApiResponse<object?>>> DeleteCustomTag(Guid id, CancellationToken ct) =>
        HandleAsync<object?>(async () =>
        {
            await tagService.DeleteCustomTagAsync(id, CurrentUserId, CurrentUserRole, ct);
            return null;
        });

    [HttpPost("custom/{id:guid}/guests/{guestUserId:guid}")]
    public Task<ActionResult<ApiResponse<object?>>> ApplyTag(Guid id, Guid guestUserId, CancellationToken ct) =>
        HandleAsync<object?>(async () =>
        {
            await tagService.ApplyTagAsync(id, guestUserId, CurrentUserId, CurrentUserRole, ct);
            return null;
        });

    [HttpDelete("custom/{id:guid}/guests/{guestUserId:guid}")]
    public Task<ActionResult<ApiResponse<object?>>> RemoveTag(Guid id, Guid guestUserId, CancellationToken ct) =>
        HandleAsync<object?>(async () =>
        {
            await tagService.RemoveTagAsync(id, guestUserId, ct);
            return null;
        });
}
