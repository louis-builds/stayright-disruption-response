using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TravelDisruptionAgent.Api.Features.Cases;
using TravelDisruptionAgent.Api.Infrastructure;

namespace TravelDisruptionAgent.Api.Features.Coordinator;

[ApiController]
[Route("api/coordinator/cases/{caseId:guid}/options")]
[Authorize(Roles = "coordinator")]
public class OptionsAdminController(IOptionsAdminService optionsAdmin) : ControllerBase
{
    private Guid CurrentUserId => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    [HttpGet]
    public async Task<ActionResult<ApiResponse<List<AdminOptionDto>>>> List(Guid caseId, CancellationToken ct)
    {
        try
        {
            return Ok(ApiResponse<List<AdminOptionDto>>.Ok(await optionsAdmin.GetOptionsAsync(caseId, ct)));
        }
        catch (CaseNotFoundException)
        {
            return NotFound(ApiResponse<object?>.Fail(404, "Case not found"));
        }
    }

    [HttpPut("{optionId:guid}")]
    public async Task<ActionResult<ApiResponse<object?>>> UpdatePayload(Guid caseId, Guid optionId, [FromBody] UpdateOptionPayloadRequest request, CancellationToken ct)
    {
        try
        {
            await optionsAdmin.UpdatePayloadAsync(caseId, optionId, request.Payload, ct);
            return Ok(ApiResponse<object?>.Ok(null));
        }
        catch (OptionNotFoundException)
        {
            return NotFound(ApiResponse<object?>.Fail(404, "Option not found"));
        }
        catch (OptionLockedException)
        {
            return Conflict(ApiResponse<object?>.Fail(409, "Option is locked; unlock it first"));
        }
        catch (CaseClosedException)
        {
            return Conflict(ApiResponse<object?>.Fail(409, "Case is closed; options can no longer be changed"));
        }
    }

    [HttpPost("{optionId:guid}/unavailable")]
    public async Task<ActionResult<ApiResponse<object?>>> MarkUnavailable(Guid caseId, Guid optionId, [FromBody] MarkUnavailableRequest request, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.Reason)) return BadRequest(ApiResponse<object?>.Fail(400, "Reason is required"));
        try
        {
            await optionsAdmin.MarkUnavailableAsync(caseId, optionId, request.Reason, ct);
            return Ok(ApiResponse<object?>.Ok(null));
        }
        catch (OptionNotFoundException)
        {
            return NotFound(ApiResponse<object?>.Fail(404, "Option not found"));
        }
        catch (CaseClosedException)
        {
            return Conflict(ApiResponse<object?>.Fail(409, "Case is closed; options can no longer be changed"));
        }
    }

    [HttpPut("{optionId:guid}/visibility")]
    public async Task<ActionResult<ApiResponse<object?>>> SetVisibility(Guid caseId, Guid optionId, [FromBody] SetVisibilityRequest request, CancellationToken ct)
    {
        try
        {
            await optionsAdmin.SetGuestVisibilityAsync(caseId, optionId, request.Visible, ct);
            return Ok(ApiResponse<object?>.Ok(null));
        }
        catch (OptionNotFoundException)
        {
            return NotFound(ApiResponse<object?>.Fail(404, "Option not found"));
        }
    }

    [HttpPost("{optionId:guid}/lock")]
    public async Task<ActionResult<ApiResponse<object?>>> Lock(Guid caseId, Guid optionId, CancellationToken ct)
    {
        try
        {
            await optionsAdmin.LockAsync(caseId, optionId, CurrentUserId, ct);
            return Ok(ApiResponse<object?>.Ok(null));
        }
        catch (OptionNotFoundException)
        {
            return NotFound(ApiResponse<object?>.Fail(404, "Option not found"));
        }
        catch (CaseClosedException)
        {
            return Conflict(ApiResponse<object?>.Fail(409, "Case is closed; options can no longer be changed"));
        }
    }

    [HttpPost("{optionId:guid}/unlock")]
    public async Task<ActionResult<ApiResponse<object?>>> Unlock(Guid caseId, Guid optionId, [FromBody] UnlockOptionRequest request, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.Reason)) return BadRequest(ApiResponse<object?>.Fail(400, "Reason is required"));
        try
        {
            await optionsAdmin.UnlockAsync(caseId, optionId, CurrentUserId, request.Reason, ct);
            return Ok(ApiResponse<object?>.Ok(null));
        }
        catch (OptionNotFoundException)
        {
            return NotFound(ApiResponse<object?>.Fail(404, "Option not found"));
        }
        catch (CaseClosedException)
        {
            return Conflict(ApiResponse<object?>.Fail(409, "Case is closed; options can no longer be changed"));
        }
    }

    [HttpPost("regenerate")]
    public async Task<ActionResult<ApiResponse<object?>>> Regenerate(Guid caseId, CancellationToken ct)
    {
        try
        {
            await optionsAdmin.RegenerateAsync(caseId, ct);
            return Ok(ApiResponse<object?>.Ok(null));
        }
        catch (CaseNotFoundException)
        {
            return NotFound(ApiResponse<object?>.Fail(404, "Case not found"));
        }
        catch (CaseClosedException)
        {
            return Conflict(ApiResponse<object?>.Fail(409, "Case is closed; options can no longer be changed"));
        }
    }

    [HttpPost("push")]
    public async Task<ActionResult<ApiResponse<PushOptionsResultDto>>> Push(Guid caseId, CancellationToken ct)
    {
        try
        {
            return Ok(ApiResponse<PushOptionsResultDto>.Ok(await optionsAdmin.PushAsync(caseId, ct)));
        }
        catch (CaseNotFoundException)
        {
            return NotFound(ApiResponse<object?>.Fail(404, "Case not found"));
        }
        catch (CaseClosedException)
        {
            return Conflict(ApiResponse<object?>.Fail(409, "Case is closed; options can no longer be changed"));
        }
        catch (OptionsAlreadyPushedException)
        {
            return Conflict(ApiResponse<object?>.Fail(409, "This version of the options has already been sent"));
        }
        catch (NoOptionsToPushException)
        {
            return Conflict(ApiResponse<object?>.Fail(409, "There are no options to send"));
        }
        catch (GuestSelectionSubmittedException)
        {
            return Conflict(ApiResponse<object?>.Fail(409, "The guest has already submitted a final choice"));
        }
    }

    [HttpGet("push-status")]
    public async Task<ActionResult<ApiResponse<PushOptionsStatusDto>>> PushStatus(Guid caseId, CancellationToken ct)
    {
        try
        {
            return Ok(ApiResponse<PushOptionsStatusDto>.Ok(await optionsAdmin.GetPushStatusAsync(caseId, ct)));
        }
        catch (CaseNotFoundException)
        {
            return NotFound(ApiResponse<object?>.Fail(404, "Case not found"));
        }
    }
}
