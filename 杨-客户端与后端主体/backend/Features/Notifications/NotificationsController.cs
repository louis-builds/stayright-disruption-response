using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TravelDisruptionAgent.Api.Infrastructure;
using TravelDisruptionAgent.Api.Infrastructure.Paging;

namespace TravelDisruptionAgent.Api.Features.Notifications;

[ApiController]
[Route("api/notifications")]
[Authorize]
public class NotificationsController(INotificationRepository notifications) : ControllerBase
{
    private Guid CurrentUserId => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    [HttpGet]
    public async Task<ActionResult<ApiResponse<PagedResult<NotificationDto>>>> List(
        [FromQuery] PagedRequest query, CancellationToken ct)
    {
        var page = await notifications.ListForUserAsync(CurrentUserId, query.Page, query.PageSize, ct);
        var dtoList = page.List.Select(n => new NotificationDto(
            n.Id, n.Channel, n.Type, n.Title, n.Body, n.CaseId, n.SentAt, n.ReadAt, n.Success,
            n.Case?.Disruption?.Type, n.Case?.Disruption?.Title, n.Case?.Booking?.CheckIn, n.Case?.Status)).ToList();
        var result = PagedResult<NotificationDto>.Create(dtoList, page.Total, page.Page, page.PageSize);
        return Ok(ApiResponse<PagedResult<NotificationDto>>.Ok(result));
    }

    [HttpGet("unread-count")]
    public async Task<ActionResult<ApiResponse<UnreadCountDto>>> UnreadCount(CancellationToken ct)
    {
        var count = await notifications.CountUnreadAsync(CurrentUserId, ct);
        return Ok(ApiResponse<UnreadCountDto>.Ok(new UnreadCountDto(count)));
    }

    [HttpPost("{id:guid}/read")]
    public async Task<ActionResult<ApiResponse<object?>>> MarkRead(Guid id, CancellationToken ct)
    {
        var notification = await notifications.FindAsync(id, CurrentUserId, ct);
        if (notification is null) return NotFound(ApiResponse<object?>.Fail(404, "Notification not found"));

        notification.ReadAt ??= DateTimeOffset.UtcNow;
        notification.UpdatedAt = DateTimeOffset.UtcNow;
        await notifications.SaveChangesAsync(ct);
        return Ok(ApiResponse<object?>.Ok(null, "Marked as read"));
    }
}
