using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TravelDisruptionAgent.Api.Infrastructure;
using TravelDisruptionAgent.Api.Infrastructure.Paging;

namespace TravelDisruptionAgent.Api.Features.Cases;

[ApiController]
[Route("api/cases")]
[Authorize]
public class CasesController(ICaseService caseService) : ControllerBase
{
    private Guid CurrentUserId => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);
    private string CurrentUserRole => User.FindFirstValue(ClaimTypes.Role)!;

    // 客人首页"我的待办"：不因通知已读而消失，只按 includeClosed 过滤，默认只看未结案的。
    [HttpGet("mine")]
    [Authorize(Roles = "guest")]
    public async Task<ActionResult<ApiResponse<List<CaseSummaryDto>>>> GetMine([FromQuery] bool includeClosed, CancellationToken ct)
    {
        var list = await caseService.GetMyCasesAsync(CurrentUserId, includeClosed, ct);
        return Ok(ApiResponse<List<CaseSummaryDto>>.Ok(list));
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<ApiResponse<CaseSummaryDto>>> GetOne(Guid id, CancellationToken ct)
    {
        try
        {
            var summary = await caseService.GetCaseAsync(id, CurrentUserId, CurrentUserRole, ct);
            return Ok(ApiResponse<CaseSummaryDto>.Ok(summary));
        }
        catch (CaseNotFoundException)
        {
            return NotFound(ApiResponse<object?>.Fail(404, "Case not found"));
        }
        catch (CaseAccessDeniedException)
        {
            return StatusCode(403, ApiResponse.Forbidden());
        }
    }

    [HttpPost("{id:guid}/escalation-review")]
    [Authorize(Roles = "coordinator")]
    public async Task<ActionResult<ApiResponse<object?>>> ReviewEscalation(Guid id, ReviewEscalationRequest request, CancellationToken ct)
    {
        if (!request.Reasonable && string.IsNullOrWhiteSpace(request.Note))
            return BadRequest(ApiResponse<object?>.Fail(400, "Explain why this escalation wasn't reasonable"));
        try
        {
            await caseService.ReviewEscalationAsync(id, CurrentUserId, request.Reasonable, request.Note, ct);
            return Ok(ApiResponse<object?>.Ok(null));
        }
        catch (CaseNotFoundException)
        {
            return NotFound(ApiResponse<object?>.Fail(404, "Case not found"));
        }
        catch (EscalationNotFoundException)
        {
            return Conflict(ApiResponse<object?>.Fail(409, "This case was never escalated to a coordinator"));
        }
    }

    [HttpGet("{id:guid}/messages")]
    public async Task<ActionResult<ApiResponse<PagedResult<MessageDto>>>> GetMessages(
        Guid id, [FromQuery] PagedRequest query, [FromQuery] string thread, CancellationToken ct)
    {
        if (thread is not ("ai" or "coordinator")) return BadRequest(ApiResponse<object?>.Fail(400, "thread must be 'ai' or 'coordinator'"));
        try
        {
            var result = await caseService.GetMessagesAsync(id, CurrentUserId, CurrentUserRole, thread, query.Page, query.PageSize, ct);
            return Ok(ApiResponse<PagedResult<MessageDto>>.Ok(result));
        }
        catch (CaseNotFoundException)
        {
            return NotFound(ApiResponse<object?>.Fail(404, "Case not found"));
        }
        catch (CaseAccessDeniedException)
        {
            return StatusCode(403, ApiResponse.Forbidden());
        }
    }

    [HttpGet("{id:guid}/workflow-progress")]
    public async Task<ActionResult<ApiResponse<List<CaseWorkflowProgressDto>>>> GetWorkflowProgress(Guid id, CancellationToken ct)
    {
        try
        {
            var result = await caseService.GetWorkflowProgressAsync(id, CurrentUserId, CurrentUserRole, ct);
            return Ok(ApiResponse<List<CaseWorkflowProgressDto>>.Ok(result));
        }
        catch (CaseNotFoundException)
        {
            return NotFound(ApiResponse<object?>.Fail(404, "Case not found"));
        }
        catch (CaseAccessDeniedException)
        {
            return StatusCode(403, ApiResponse.Forbidden());
        }
    }

    [HttpPost("{id:guid}/messages")]
    public async Task<ActionResult<ApiResponse<MessageDto>>> PostMessage(Guid id, PostMessageRequest request, CancellationToken ct)
    {
        try
        {
            var message = await caseService.PostMessageAsync(id, CurrentUserId, CurrentUserRole, request.Content, request.Thread, ct);
            return Ok(ApiResponse<MessageDto>.Ok(message));
        }
        catch (CaseNotFoundException)
        {
            return NotFound(ApiResponse<object?>.Fail(404, "Case not found"));
        }
        catch (CaseAccessDeniedException)
        {
            return StatusCode(403, ApiResponse.Forbidden());
        }
    }

    // P4 对话页：guest 发一条消息，同步生成并落库 AI 回复（含拒答/转人工判断），一次性把两条消息都返回。
    [HttpPost("{id:guid}/chat")]
    [Authorize(Roles = "guest")]
    public async Task<ActionResult<ApiResponse<List<MessageDto>>>> PostChatMessage(Guid id, PostChatMessageRequest request, CancellationToken ct)
    {
        try
        {
            var messages = await caseService.PostChatMessageAsync(id, CurrentUserId, request.Content, ct);
            return Ok(ApiResponse<List<MessageDto>>.Ok(messages));
        }
        catch (CaseNotFoundException)
        {
            return NotFound(ApiResponse<object?>.Fail(404, "Case not found"));
        }
        catch (CaseAccessDeniedException)
        {
            return StatusCode(403, ApiResponse.Forbidden());
        }
    }

    [HttpPost("{id:guid}/messages/{messageId:guid}/vote")]
    public async Task<ActionResult<ApiResponse<object?>>> VoteMessage(Guid id, Guid messageId, VoteMessageRequest request, CancellationToken ct)
    {
        try
        {
            await caseService.VoteMessageAsync(id, messageId, CurrentUserId, CurrentUserRole, request.Vote, ct);
            return Ok(ApiResponse<object?>.Ok(null, "Vote recorded"));
        }
        catch (CaseNotFoundException)
        {
            return NotFound(ApiResponse<object?>.Fail(404, "Message not found"));
        }
        catch (CaseAccessDeniedException)
        {
            return StatusCode(403, ApiResponse.Forbidden());
        }
    }

    [HttpPost("{id:guid}/messages/read")]
    public async Task<ActionResult<ApiResponse<object?>>> MarkThreadRead(Guid id, [FromQuery] string thread, CancellationToken ct)
    {
        if (thread is not ("ai" or "coordinator")) return BadRequest(ApiResponse<object?>.Fail(400, "thread must be 'ai' or 'coordinator'"));
        try
        {
            await caseService.MarkThreadReadAsync(id, CurrentUserId, CurrentUserRole, thread, ct);
            return Ok(ApiResponse<object?>.Ok(null, "Marked as read"));
        }
        catch (CaseNotFoundException)
        {
            return NotFound(ApiResponse<object?>.Fail(404, "Case not found"));
        }
        catch (CaseAccessDeniedException)
        {
            return StatusCode(403, ApiResponse.Forbidden());
        }
    }

    [HttpPost("{id:guid}/messages/{messageId:guid}/read")]
    public async Task<ActionResult<ApiResponse<object?>>> MarkMessageRead(Guid id, Guid messageId, CancellationToken ct)
    {
        try
        {
            await caseService.MarkMessageReadAsync(id, messageId, CurrentUserId, CurrentUserRole, ct);
            return Ok(ApiResponse<object?>.Ok(null, "Marked as read"));
        }
        catch (CaseNotFoundException)
        {
            return NotFound(ApiResponse<object?>.Fail(404, "Message not found"));
        }
        catch (CaseAccessDeniedException)
        {
            return StatusCode(403, ApiResponse.Forbidden());
        }
    }

    [HttpGet("{id:guid}/options")]
    public async Task<ActionResult<ApiResponse<List<OptionDto>>>> GetOptions(Guid id, CancellationToken ct)
    {
        try
        {
            var options = await caseService.GetOptionsAsync(id, CurrentUserId, CurrentUserRole, ct);
            return Ok(ApiResponse<List<OptionDto>>.Ok(options));
        }
        catch (CaseNotFoundException)
        {
            return NotFound(ApiResponse<object?>.Fail(404, "Case not found"));
        }
        catch (CaseAccessDeniedException)
        {
            return StatusCode(403, ApiResponse.Forbidden());
        }
    }

    [HttpPost("{id:guid}/options/{optionId:guid}/select")]
    [Authorize(Roles = "guest")]
    public async Task<ActionResult<ApiResponse<object?>>> SelectOption(Guid id, Guid optionId, CancellationToken ct)
    {
        try
        {
            await caseService.SelectOptionAsync(id, optionId, CurrentUserId, CurrentUserRole, ct);
            return Ok(ApiResponse<object?>.Ok(null, "Option selected"));
        }
        catch (CaseNotFoundException)
        {
            return NotFound(ApiResponse<object?>.Fail(404, "Option not found"));
        }
        catch (CaseAccessDeniedException)
        {
            return StatusCode(403, ApiResponse.Forbidden());
        }
    }

    [HttpPost("{id:guid}/options/{optionId:guid}/propose-dates")]
    [Authorize(Roles = "guest")]
    public async Task<ActionResult<ApiResponse<ProposeDeferDatesResultDto>>> ProposeDeferDates(
        Guid id, Guid optionId, ProposeDeferDatesRequest request, CancellationToken ct)
    {
        try
        {
            var result = await caseService.ProposeDeferDatesAsync(id, optionId, request.NewCheckIn, request.NewCheckOut, CurrentUserId, CurrentUserRole, ct);
            return Ok(ApiResponse<ProposeDeferDatesResultDto>.Ok(result));
        }
        catch (CaseNotFoundException)
        {
            return NotFound(ApiResponse<object?>.Fail(404, "Option not found"));
        }
        catch (CaseAccessDeniedException)
        {
            return StatusCode(403, ApiResponse.Forbidden());
        }
    }

    [HttpPost("{id:guid}/options/{optionId:guid}/confirm-execution")]
    [Authorize(Roles = "guest")]
    public async Task<ActionResult<ApiResponse<ConfirmExecutionResultDto>>> ConfirmExecution(Guid id, Guid optionId, CancellationToken ct)
    {
        try
        {
            var result = await caseService.ConfirmExecutionAsync(id, optionId, CurrentUserId, CurrentUserRole, ct);
            return Ok(ApiResponse<ConfirmExecutionResultDto>.Ok(result));
        }
        catch (CaseNotFoundException)
        {
            return NotFound(ApiResponse<object?>.Fail(404, "Option not found"));
        }
        catch (CaseAccessDeniedException)
        {
            return StatusCode(403, ApiResponse.Forbidden());
        }
    }

    [HttpGet("{id:guid}/options/{optionId:guid}/policy")]
    public async Task<ActionResult<ApiResponse<PolicySummaryDto>>> GetPolicy(Guid id, Guid optionId, CancellationToken ct)
    {
        try
        {
            var summary = await caseService.GetPolicySummaryAsync(id, optionId, CurrentUserId, CurrentUserRole, ct);
            return Ok(ApiResponse<PolicySummaryDto>.Ok(summary));
        }
        catch (CaseNotFoundException)
        {
            return NotFound(ApiResponse<object?>.Fail(404, "Option not found"));
        }
        catch (CaseAccessDeniedException)
        {
            return StatusCode(403, ApiResponse.Forbidden());
        }
    }

    [HttpGet("{id:guid}/refund")]
    public async Task<ActionResult<ApiResponse<RefundStatusDto>>> GetRefundStatus(Guid id, CancellationToken ct)
    {
        var status = await caseService.GetRefundStatusAsync(id, ct);
        return Ok(ApiResponse<RefundStatusDto>.Ok(status));
    }

    // 退款强制规则：唯一能让退款生效的入口，且只有协调员能调用。没有任何接口能绕过这里直接把退款标记为完成。
    [HttpPost("{id:guid}/refund/confirm")]
    [Authorize(Roles = "coordinator")]
    public async Task<ActionResult<ApiResponse<object?>>> ConfirmRefund(Guid id, ConfirmRefundRequest request, CancellationToken ct)
    {
        try
        {
            await caseService.ConfirmRefundAsync(id, CurrentUserId, request.Amount, request.Reason, request.OptionId, ct);
            return Ok(ApiResponse<object?>.Ok(null, "Refund confirmed"));
        }
        catch (CaseNotFoundException)
        {
            return NotFound(ApiResponse<object?>.Fail(404, "Case not found"));
        }
    }
}
