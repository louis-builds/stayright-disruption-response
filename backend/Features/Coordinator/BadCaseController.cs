using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TravelDisruptionAgent.Api.Features.Cases;
using TravelDisruptionAgent.Api.Infrastructure;

namespace TravelDisruptionAgent.Api.Features.Coordinator;

[ApiController]
[Route("api/coordinator/bad-cases")]
[Authorize(Roles = "coordinator")]
public class BadCaseController(IBadCaseService badCaseService) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<ApiResponse<List<BadCaseListItemDto>>>> List(CancellationToken ct) =>
        Ok(ApiResponse<List<BadCaseListItemDto>>.Ok(await badCaseService.ListAsync(ct)));

    [HttpGet("{messageId:guid}/replay")]
    public async Task<ActionResult<ApiResponse<BadCaseReplayDto>>> Replay(Guid messageId, CancellationToken ct)
    {
        try
        {
            return Ok(ApiResponse<BadCaseReplayDto>.Ok(await badCaseService.ReplayAsync(messageId, ct)));
        }
        catch (CaseNotFoundException)
        {
            return NotFound(ApiResponse<object?>.Fail(404, "Message not found"));
        }
    }
}
