using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TravelDisruptionAgent.Api.Features.Cases;
using TravelDisruptionAgent.Api.Infrastructure;

namespace TravelDisruptionAgent.Api.Features.Coordinator;

[ApiController]
[Route("api/coordinator/bad-cases")]
[Authorize(Roles = "coordinator,admin")]
public class BadCaseController(IBadCaseService badCaseService) : ControllerBase
{
    private Guid CurrentUserId => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

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

    [HttpGet("{messageId:guid}/thread")]
    public async Task<ActionResult<ApiResponse<BadCaseThreadDto>>> Thread(Guid messageId, CancellationToken ct)
    {
        try
        {
            return Ok(ApiResponse<BadCaseThreadDto>.Ok(await badCaseService.GetThreadAsync(messageId, ct)));
        }
        catch (CaseNotFoundException)
        {
            return NotFound(ApiResponse<object?>.Fail(404, "Message not found"));
        }
    }

    [HttpPost("{messageId:guid}/missed-escalation-review")]
    public async Task<ActionResult<ApiResponse<object?>>> ConfirmMissedEscalation(Guid messageId, ConfirmMissedEscalationRequest request, CancellationToken ct)
    {
        try
        {
            await badCaseService.ConfirmMissedEscalationAsync(messageId, request.Confirmed, ct);
            return Ok(ApiResponse<object?>.Ok(null));
        }
        catch (CaseNotFoundException)
        {
            return NotFound(ApiResponse<object?>.Fail(404, "Message not found"));
        }
    }

    [HttpPost("{messageId:guid}/learning")]
    public Task<ActionResult<ApiResponse<BadCaseLearningDto>>> Evaluate(
        Guid messageId, EvaluateBadCaseRequest request, CancellationToken ct) =>
        HandleLearning(() => badCaseService.EvaluateAndDraftAsync(messageId, CurrentUserId, request.EvaluationNote ?? "", ct));

    [HttpPut("{messageId:guid}/learning/draft")]
    public Task<ActionResult<ApiResponse<BadCaseLearningDto>>> SaveDraft(
        Guid messageId, SaveLearningDraftRequest request, CancellationToken ct) =>
        HandleLearning(() => badCaseService.SaveDraftAsync(messageId, request.DraftMarkdown ?? "", ct));

    [HttpPost("{messageId:guid}/learning/approve")]
    public Task<ActionResult<ApiResponse<BadCaseLearningDto>>> Approve(
        Guid messageId, SaveLearningDraftRequest? request, CancellationToken ct) =>
        HandleLearning(() => badCaseService.ApproveAsync(messageId, CurrentUserId, request?.DraftMarkdown, ct));

    [HttpPost("{messageId:guid}/learning/reject")]
    public Task<ActionResult<ApiResponse<BadCaseLearningDto>>> Reject(Guid messageId, CancellationToken ct) =>
        HandleLearning(() => badCaseService.RejectAsync(messageId, CurrentUserId, ct));

    private async Task<ActionResult<ApiResponse<BadCaseLearningDto>>> HandleLearning(Func<Task<BadCaseLearningDto>> action)
    {
        try
        {
            return Ok(ApiResponse<BadCaseLearningDto>.Ok(await action()));
        }
        catch (CaseNotFoundException)
        {
            return NotFound(ApiResponse<object?>.Fail(404, "Message not found"));
        }
        catch (InvalidOperationException ex)
        {
            return Conflict(ApiResponse<object?>.Fail(409, ex.Message));
        }
    }
}
