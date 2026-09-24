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
