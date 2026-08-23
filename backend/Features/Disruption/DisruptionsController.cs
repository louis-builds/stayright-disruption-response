using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TravelDisruptionAgent.Api.Features.Coordinator;
using TravelDisruptionAgent.Api.Infrastructure;

namespace TravelDisruptionAgent.Api.Features.Disruption;

[ApiController]
[Route("api/coordinator/disruptions")]
[Authorize(Roles = "coordinator")]
public class DisruptionsController(IDisruptionService disruptionService, ICoordinatorService coordinatorService) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<ApiResponse<List<DisruptionListItemDto>>>> List([FromQuery] string? type, [FromQuery] string? region, CancellationToken ct) =>
        Ok(ApiResponse<List<DisruptionListItemDto>>.Ok(await disruptionService.ListAsync(type, region, ct)));

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<ApiResponse<DisruptionDetailDto>>> Get(Guid id, CancellationToken ct)
    {
        try
        {
            return Ok(ApiResponse<DisruptionDetailDto>.Ok(await disruptionService.GetAsync(id, ct)));
        }
        catch (DisruptionNotFoundException)
        {
            return NotFound(ApiResponse<object?>.Fail(404, "Disruption not found"));
        }
    }

    [HttpGet("{id:guid}/cases")]
    public async Task<ActionResult<ApiResponse<List<CaseQueueItemDto>>>> GetCases(Guid id, CancellationToken ct) =>
        Ok(ApiResponse<List<CaseQueueItemDto>>.Ok(await coordinatorService.GetByDisruptionAsync(id, ct)));

    [HttpPost("{id:guid}/assign")]
    public async Task<ActionResult<ApiResponse<object?>>> Assign(Guid id, [FromBody] AssignDisruptionRequest request, CancellationToken ct)
    {
        try
        {
            await disruptionService.AssignAsync(id, request.ToCoordinatorId, ct);
            return Ok(ApiResponse<object?>.Ok(null));
        }
        catch (DisruptionNotFoundException)
        {
            return NotFound(ApiResponse<object?>.Fail(404, "Disruption not found"));
        }
    }

    [HttpPut("{id:guid}/window")]
    public async Task<ActionResult<ApiResponse<object?>>> AdjustWindow(Guid id, [FromBody] AdjustWindowRequest request, CancellationToken ct)
    {
        var actorUserId = Guid.Parse(User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)!.Value);
        try
        {
            await disruptionService.AdjustWindowAsync(id, request, actorUserId, ct);
            return Ok(ApiResponse<object?>.Ok(null));
        }
        catch (DisruptionNotFoundException)
        {
            return NotFound(ApiResponse<object?>.Fail(404, "Disruption not found"));
        }
    }

    [HttpPost("{id:guid}/resolve")]
    public async Task<ActionResult<ApiResponse<object?>>> Resolve(Guid id, CancellationToken ct)
    {
        try
        {
            await disruptionService.ResolveAsync(id, ct);
            return Ok(ApiResponse<object?>.Ok(null));
        }
        catch (DisruptionNotFoundException)
        {
            return NotFound(ApiResponse<object?>.Fail(404, "Disruption not found"));
        }
    }

    [HttpGet("{id:guid}/candidates")]
    public async Task<ActionResult<ApiResponse<List<CandidateBookingDto>>>> GetCandidates(Guid id, CancellationToken ct)
    {
        try
        {
            return Ok(ApiResponse<List<CandidateBookingDto>>.Ok(await disruptionService.GetCandidatesAsync(id, ct)));
        }
        catch (DisruptionNotFoundException)
        {
            return NotFound(ApiResponse<object?>.Fail(404, "Disruption not found"));
        }
    }

    [HttpPost("{id:guid}/candidates/exclude")]
    public async Task<ActionResult<ApiResponse<object?>>> ExcludeCandidate(Guid id, [FromBody] ExcludeCandidateRequest request, CancellationToken ct)
    {
        await disruptionService.ExcludeCandidateAsync(id, request, ct);
        return Ok(ApiResponse<object?>.Ok(null));
    }

    [HttpPost("{id:guid}/candidates/notify")]
    public async Task<ActionResult<ApiResponse<NotifyCandidatesResultDto>>> NotifyCandidates(Guid id, [FromBody] NotifyCandidatesRequest request, CancellationToken ct)
    {
        try
        {
            return Ok(ApiResponse<NotifyCandidatesResultDto>.Ok(await disruptionService.NotifyCandidatesAsync(id, request, ct)));
        }
        catch (DisruptionNotFoundException)
        {
            return NotFound(ApiResponse<object?>.Fail(404, "Disruption not found"));
        }
    }
}
