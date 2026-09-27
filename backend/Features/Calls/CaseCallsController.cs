using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TravelDisruptionAgent.Api.Features.Cases;
using TravelDisruptionAgent.Api.Infrastructure;

namespace TravelDisruptionAgent.Api.Features.Calls;

[ApiController]
[Route("api/cases/{caseId:guid}/calls")]
[Authorize(Roles = "coordinator")]
public class CaseCallsController(ICallService callService) : ControllerBase
{
    private Guid CurrentUserId => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    [HttpPost]
    public async Task<ActionResult<ApiResponse<CallDto>>> Initiate(Guid caseId, InitiateCallRequest request, CancellationToken ct)
    {
        try
        {
            var call = await callService.InitiateCallAsync(caseId, CurrentUserId, request, ct);
            return Ok(ApiResponse<CallDto>.Ok(call));
        }
        catch (CaseNotFoundException)
        {
            return NotFound(ApiResponse<object?>.Fail(404, "Case not found"));
        }
        catch (CallValidationException ex)
        {
            return BadRequest(ApiResponse<object?>.Fail(400, ex.Message));
        }
    }

    [HttpGet]
    public async Task<ActionResult<ApiResponse<List<CallDto>>>> ListForCase(Guid caseId, CancellationToken ct) =>
        Ok(ApiResponse<List<CallDto>>.Ok(await callService.ListForCaseAsync(caseId, ct)));
}
