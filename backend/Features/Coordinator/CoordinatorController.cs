using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TravelDisruptionAgent.Api.Features.Cases;
using TravelDisruptionAgent.Api.Features.Disruption;
using TravelDisruptionAgent.Api.Infrastructure;

namespace TravelDisruptionAgent.Api.Features.Coordinator;

[ApiController]
[Route("api/coordinator")]
[Authorize(Roles = "coordinator")]
public class CoordinatorController(ICoordinatorService coordinatorService) : ControllerBase
{
    private Guid CurrentUserId => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    [HttpGet("overview")]
    public async Task<ActionResult<ApiResponse<OverviewDto>>> GetOverview(CancellationToken ct) =>
        Ok(ApiResponse<OverviewDto>.Ok(await coordinatorService.GetOverviewAsync(ct)));

    [HttpGet("queue")]
    public async Task<ActionResult<ApiResponse<List<CaseQueueItemDto>>>> GetQueue([FromQuery] string? filter, CancellationToken ct) =>
        Ok(ApiResponse<List<CaseQueueItemDto>>.Ok(await coordinatorService.GetQueueAsync(filter, ct)));

    [HttpGet("mine")]
    public async Task<ActionResult<ApiResponse<List<CaseQueueItemDto>>>> GetMine([FromQuery] string status, CancellationToken ct) =>
        Ok(ApiResponse<List<CaseQueueItemDto>>.Ok(await coordinatorService.GetMineAsync(CurrentUserId, status, ct)));

    [HttpGet("closed")]
    public async Task<ActionResult<ApiResponse<List<CaseQueueItemDto>>>> GetClosed([FromQuery] int days = 7, CancellationToken ct = default) =>
        Ok(ApiResponse<List<CaseQueueItemDto>>.Ok(await coordinatorService.GetClosedAsync(days, ct)));

    [HttpGet("search")]
    public async Task<ActionResult<ApiResponse<List<CaseQueueItemDto>>>> Search([FromQuery] string? q, CancellationToken ct) =>
        Ok(ApiResponse<List<CaseQueueItemDto>>.Ok(await coordinatorService.SearchAsync(q ?? "", ct)));

    [HttpGet("coordinators")]
    public async Task<ActionResult<ApiResponse<List<CoordinatorOptionDto>>>> ListCoordinators(CancellationToken ct) =>
        Ok(ApiResponse<List<CoordinatorOptionDto>>.Ok(await coordinatorService.ListCoordinatorsAsync(ct)));

    [HttpPost("cases/{id:guid}/transfer")]
    public async Task<ActionResult<ApiResponse<object?>>> Transfer(Guid id, [FromBody] TransferRequest request, CancellationToken ct)
    {
        try
        {
            await coordinatorService.TransferAsync(id, request.ToCoordinatorId, CurrentUserId, ct);
            return Ok(ApiResponse<object?>.Ok(null));
        }
        catch (CaseNotFoundException)
        {
            return NotFound(ApiResponse<object?>.Fail(404, "Case not found"));
        }
    }

    [HttpPost("cases/{id:guid}/close")]
    public async Task<ActionResult<ApiResponse<object?>>> Close(Guid id, [FromBody] CloseCaseRequest request, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.CloseReason) || string.IsNullOrWhiteSpace(request.ResultSummary))
        {
            return BadRequest(ApiResponse<object?>.Fail(400, "Close reason and result summary are required"));
        }
        try
        {
            await coordinatorService.CloseAsync(id, request, CurrentUserId, ct);
            return Ok(ApiResponse<object?>.Ok(null));
        }
        catch (CaseNotFoundException)
        {
            return NotFound(ApiResponse<object?>.Fail(404, "Case not found"));
        }
        catch (RefundNotConfirmedException)
        {
            return Conflict(ApiResponse<object?>.Fail(409, "Confirm the refund amount via /api/cases/{id}/refund/confirm before closing with this reason"));
        }
        catch (CaseAlreadyClosedException)
        {
            return Conflict(ApiResponse<object?>.Fail(409, "This case is already closed"));
        }
    }

    [HttpGet("cases/{id:guid}/notifications")]
    public async Task<ActionResult<ApiResponse<List<CaseNotificationDto>>>> ListNotifications(Guid id, CancellationToken ct) =>
        Ok(ApiResponse<List<CaseNotificationDto>>.Ok(await coordinatorService.ListCaseNotificationsAsync(id, ct)));

    [HttpPost("notifications/{notificationId:guid}/resend")]
    public async Task<ActionResult<ApiResponse<PushOptionsResultDto>>> ResendNotification(Guid notificationId, CancellationToken ct) =>
        Ok(ApiResponse<PushOptionsResultDto>.Ok(await coordinatorService.ResendNotificationAsync(notificationId, ct)));

    [HttpPost("cases/{id:guid}/priority")]
    public async Task<ActionResult<ApiResponse<object?>>> SetPriority(Guid id, [FromBody] SetPriorityRequest request, CancellationToken ct)
    {
        try
        {
            await coordinatorService.SetPriorityAsync(id, request.Priority, ct);
            return Ok(ApiResponse<object?>.Ok(null));
        }
        catch (CaseNotFoundException)
        {
            return NotFound(ApiResponse<object?>.Fail(404, "Case not found"));
        }
    }

    [HttpGet("cases/{id:guid}/notes")]
    public async Task<ActionResult<ApiResponse<List<CaseNoteDto>>>> ListNotes(Guid id, CancellationToken ct) =>
        Ok(ApiResponse<List<CaseNoteDto>>.Ok(await coordinatorService.ListNotesAsync(id, ct)));

    [HttpPost("cases/{id:guid}/notes")]
    public async Task<ActionResult<ApiResponse<object?>>> AddNote(Guid id, [FromBody] AddNoteRequest request, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.Body)) return BadRequest(ApiResponse<object?>.Fail(400, "Note body is required"));
        await coordinatorService.AddNoteAsync(id, CurrentUserId, request.Body, ct);
        return Ok(ApiResponse<object?>.Ok(null));
    }
}
