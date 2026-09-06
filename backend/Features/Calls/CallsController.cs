using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TravelDisruptionAgent.Api.Infrastructure;
using TravelDisruptionAgent.Api.Infrastructure.Paging;

namespace TravelDisruptionAgent.Api.Features.Calls;

[ApiController]
[Route("api/calls")]
[Authorize(Roles = "coordinator")]
public class CallsController(ICallService callService) : ControllerBase
{
    private Guid CurrentUserId => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    [HttpGet("mine")]
    public async Task<ActionResult<ApiResponse<PagedResult<CallDto>>>> Mine(
        [FromQuery] PagedRequest query, [FromQuery] Guid? caseId, [FromQuery] string? calleeType,
        [FromQuery] string? status, [FromQuery] DateTimeOffset? from, [FromQuery] DateTimeOffset? to, CancellationToken ct)
    {
        var result = await callService.ListMineAsync(
            CurrentUserId, caseId, calleeType, status, from, to, query.Page, query.PageSize, ct);
        return Ok(ApiResponse<PagedResult<CallDto>>.Ok(result));
    }

    [HttpPost("{id:guid}/end")]
    public async Task<ActionResult<ApiResponse<object?>>> EndCall(Guid id, CancellationToken ct)
    {
        try
        {
            await callService.EndCallAsync(id, CurrentUserId, ct);
            return Ok(ApiResponse<object?>.Ok(null));
        }
        catch (CallNotFoundException)
        {
            return NotFound(ApiResponse<object?>.Fail(404, "Call not found"));
        }
    }

    [HttpGet("{id:guid}/recording")]
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
}
