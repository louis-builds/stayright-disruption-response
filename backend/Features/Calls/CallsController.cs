using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TravelDisruptionAgent.Api.Infrastructure;
using TravelDisruptionAgent.Api.Infrastructure.Paging;

namespace TravelDisruptionAgent.Api.Features.Calls;

[ApiController]
[Route("api/calls")]
[Authorize(Roles = "coordinator,guest")]
public class CallsController(ICallService callService) : ControllerBase
{
    private Guid CurrentUserId => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);
    private string CurrentUserRole => User.FindFirstValue(ClaimTypes.Role)!;

    [HttpGet("audits/mine")]
    [Authorize(Roles = "coordinator")]
    public async Task<ActionResult<ApiResponse<PagedResult<RecordingAuditListItemDto>>>> MineAudits(
        [FromQuery] PagedRequest query, CancellationToken ct) =>
        Ok(ApiResponse<PagedResult<RecordingAuditListItemDto>>.Ok(
            await callService.ListMineAuditsAsync(CurrentUserId, query.Page, query.PageSize, ct)));

    [HttpGet("mine")]
    [Authorize(Roles = "coordinator")]
    public async Task<ActionResult<ApiResponse<PagedResult<CallDto>>>> Mine(
        [FromQuery] PagedRequest query, [FromQuery] Guid? caseId, [FromQuery] string? calleeType,
        [FromQuery] string? status, [FromQuery] DateTimeOffset? from, [FromQuery] DateTimeOffset? to, CancellationToken ct)
    {
        var result = await callService.ListMineAsync(
            CurrentUserId, caseId, calleeType, status, from, to, query.Page, query.PageSize, ct);
        return Ok(ApiResponse<PagedResult<CallDto>>.Ok(result));
    }

    [HttpGet("incoming")]
    [Authorize(Roles = "guest")]
    public async Task<ActionResult<ApiResponse<List<CallDto>>>> Incoming(CancellationToken ct) =>
        Ok(ApiResponse<List<CallDto>>.Ok(await callService.ListIncomingAsync(CurrentUserId, ct)));

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<ApiResponse<CallDto>>> Get(Guid id, CancellationToken ct)
    {
        try
        {
            return Ok(ApiResponse<CallDto>.Ok(await callService.GetAsync(id, CurrentUserId, CurrentUserRole, ct)));
        }
        catch (CallNotFoundException)
        {
            return NotFound(ApiResponse<object?>.Fail(404, "Call not found"));
        }
        catch (CallAccessDeniedException)
        {
            return StatusCode(403, ApiResponse.Forbidden());
        }
    }

    [HttpPost("{id:guid}/accept")]
    [Authorize(Roles = "guest")]
    public async Task<ActionResult<ApiResponse<CallDto>>> Accept(Guid id, CancellationToken ct) =>
        await RunTransition(() => callService.AcceptAsync(id, CurrentUserId, ct));

    [HttpPost("{id:guid}/reject")]
    [Authorize(Roles = "guest")]
    public async Task<ActionResult<ApiResponse<CallDto>>> Reject(Guid id, CancellationToken ct) =>
        await RunTransition(() => callService.RejectAsync(id, CurrentUserId, ct));

    [HttpPost("{id:guid}/end")]
    public async Task<ActionResult<ApiResponse<CallDto>>> EndCall(Guid id, CancellationToken ct) =>
        await RunTransition(() => callService.EndCallAsync(id, CurrentUserId, CurrentUserRole, ct));

    [HttpPost("{id:guid}/recording")]
    [Authorize(Roles = "coordinator")]
    [RequestSizeLimit(40_000_000)]
    [RequestFormLimits(MultipartBodyLengthLimit = 40_000_000)]
    public async Task<ActionResult<ApiResponse<CallRecordingDto>>> UploadRecording(
        Guid id, IFormFile file, [FromForm] int? durationSeconds, CancellationToken ct)
    {
        if (file is null || file.Length <= 0)
            return BadRequest(ApiResponse<object?>.Fail(400, "Recording file is required"));
        if (file.Length > 40_000_000)
            return BadRequest(ApiResponse<object?>.Fail(400, "Recording file is too large"));
        try
        {
            await using var stream = file.OpenReadStream();
            return Ok(ApiResponse<CallRecordingDto>.Ok(await callService.UploadRecordingAsync(
                id, CurrentUserId, stream, file.FileName, file.ContentType, durationSeconds, ct)));
        }
        catch (CallNotFoundException)
        {
            return NotFound(ApiResponse<object?>.Fail(404, "Call not found"));
        }
        catch (CallAccessDeniedException)
        {
            return StatusCode(403, ApiResponse.Forbidden());
        }
        catch (CallStateConflictException ex)
        {
            return Conflict(ApiResponse<object?>.Fail(409, ex.Message));
        }
        catch (CallValidationException ex)
        {
            return BadRequest(ApiResponse<object?>.Fail(400, ex.Message));
        }
    }

    [HttpPost("{id:guid}/recording/insights")]
    [Authorize(Roles = "coordinator")]
    public async Task<ActionResult<ApiResponse<CallRecordingDto>>> ConfirmInsights(
        Guid id, ConfirmCallInsightsRequest request, CancellationToken ct)
    {
        try
        {
            return Ok(ApiResponse<CallRecordingDto>.Ok(await callService.ConfirmInsightsAsync(id, CurrentUserId, request, ct)));
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

    [HttpGet("{id:guid}/recording")]
    [Authorize(Roles = "coordinator")]
    public async Task<ActionResult<ApiResponse<CallRecordingDto>>> Recording(Guid id, CancellationToken ct)
    {
        try
        {
            return Ok(ApiResponse<CallRecordingDto>.Ok(await callService.GetRecordingAsync(id, CurrentUserId, ct)));
        }
        catch (CallNotFoundException)
        {
            return NotFound(ApiResponse<object?>.Fail(404, "Recording not found"));
        }
    }

    [HttpPost("{id:guid}/recording/review")]
    [Authorize(Roles = "coordinator")]
    public async Task<ActionResult<ApiResponse<object?>>> ReviewRecording(Guid id, ReviewRecordingRequest request, CancellationToken ct)
    {
        try
        {
            await callService.ReviewRecordingAsync(id, CurrentUserId, request, ct);
            return Ok(ApiResponse<object?>.Ok(null));
        }
        catch (CallNotFoundException)
        {
            return NotFound(ApiResponse<object?>.Fail(404, "Recording not found"));
        }
    }

    private async Task<ActionResult<ApiResponse<CallDto>>> RunTransition(Func<Task<CallDto>> transition)
    {
        try
        {
            return Ok(ApiResponse<CallDto>.Ok(await transition()));
        }
        catch (CallNotFoundException)
        {
            return NotFound(ApiResponse<object?>.Fail(404, "Call not found"));
        }
        catch (CallAccessDeniedException)
        {
            return StatusCode(403, ApiResponse.Forbidden());
        }
        catch (CallStateConflictException ex)
        {
            return Conflict(ApiResponse<object?>.Fail(409, ex.Message));
        }
    }
}
