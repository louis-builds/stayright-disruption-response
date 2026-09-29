using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TravelDisruptionAgent.Api.Infrastructure;
using TravelDisruptionAgent.Api.Infrastructure.Paging;

namespace TravelDisruptionAgent.Api.Features.Calls;

[ApiController]
[Route("api/admin/recordings")]
[Authorize(Roles = "admin")]
public class AdminRecordingsController(ICallService callService) : ControllerBase
{
    private Guid CurrentUserId => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    [HttpGet]
    public async Task<ActionResult<ApiResponse<PagedResult<RecordingAuditListItemDto>>>> List(
        [FromQuery] PagedRequest query, [FromQuery] string? q, [FromQuery] Guid? coordinatorId,
        [FromQuery] DateTimeOffset? from, [FromQuery] DateTimeOffset? to, [FromQuery] string? auditStatus,
        CancellationToken ct) =>
        Ok(ApiResponse<PagedResult<RecordingAuditListItemDto>>.Ok(await callService.ListForAuditAsync(
            q, coordinatorId, from, to, auditStatus, query.Page, query.PageSize, ct)));

    [HttpGet("{callId:guid}")]
    public async Task<ActionResult<ApiResponse<RecordingAuditDetailDto>>> Get(Guid callId, CancellationToken ct)
    {
        try
        {
            return Ok(ApiResponse<RecordingAuditDetailDto>.Ok(await callService.GetForAuditAsync(callId, ct)));
        }
        catch (CallNotFoundException)
        {
            return NotFound(ApiResponse<object?>.Fail(404, "Recording not found"));
        }
    }

    [HttpPost("{callId:guid}/audit")]
    public async Task<ActionResult<ApiResponse<RecordingAuditDetailDto>>> Audit(
        Guid callId, SubmitRecordingAuditRequest request, CancellationToken ct)
    {
        try
        {
            return Ok(ApiResponse<RecordingAuditDetailDto>.Ok(
                await callService.SubmitAuditAsync(callId, CurrentUserId, request, ct)));
        }
        catch (CallNotFoundException)
        {
            return NotFound(ApiResponse<object?>.Fail(404, "Recording not found"));
        }
        catch (CallValidationException ex)
        {
            return BadRequest(ApiResponse<object?>.Fail(400, ex.Message));
        }
    }
}
