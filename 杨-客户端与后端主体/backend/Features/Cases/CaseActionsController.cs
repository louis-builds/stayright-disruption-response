using Microsoft.AspNetCore.Mvc;
using TravelDisruptionAgent.Api.Infrastructure;
using TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

namespace TravelDisruptionAgent.Api.Features.Cases;

public record CaseActionPreviewDto(string HotelName, string OptionTitle, DateOnly? CheckIn, DateOnly? CheckOut);
public class CaseActionExecuteRequest { public string Token { get; set; } = ""; }

/// <summary>邮件"一键确认"按钮走的公开(免登录)端点——token 本身就是身份凭证，不加 [Authorize]。
/// verify 只读，扫描器预抓取邮件链接不会产生副作用；execute 才真正落地，前端落地页二次确认后才调。</summary>
[ApiController]
[Route("api/case-actions")]
public class CaseActionsController(CaseActionTokenService tokens, ICaseRepository cases, ICaseService caseService) : ControllerBase
{
    private static string OptionTitle(Option o) => o.OptionType switch
    {
        "defer" => "Defer & keep original hotel",
        "alternate" => "Move to an alternative stay",
        "cancel" => "Cancel & refund",
        "custom" => o.CustomTitle ?? "Special offer",
        _ => "Rebooking option",
    };

    [HttpGet("verify")]
    public async Task<ActionResult<ApiResponse<CaseActionPreviewDto>>> Verify([FromQuery] string token, CancellationToken ct)
    {
        var payload = tokens.TryRead(token);
        if (payload is null) return BadRequest(ApiResponse<object?>.Fail(400, "This link has expired or is no longer valid."));

        var full = await cases.FindFullAsync(payload.CaseId, ct);
        var option = await cases.FindOptionAsync(payload.OptionId, payload.CaseId, ct);
        if (full?.Booking is null || option is null || option.Availability == "unavailable")
            return BadRequest(ApiResponse<object?>.Fail(400, "This option is no longer available."));

        return Ok(ApiResponse<CaseActionPreviewDto>.Ok(new CaseActionPreviewDto(
            full.Booking.Hotel?.Name ?? "the hotel", OptionTitle(option), full.Booking.CheckIn, full.Booking.CheckOut)));
    }

    [HttpPost("execute")]
    public async Task<ActionResult<ApiResponse<object?>>> Execute(CaseActionExecuteRequest request, CancellationToken ct)
    {
        var payload = tokens.TryRead(request.Token);
        if (payload is null) return BadRequest(ApiResponse<object?>.Fail(400, "This link has expired or is no longer valid."));

        try
        {
            await caseService.SelectOptionAsync(payload.CaseId, payload.OptionId, payload.GuestUserId, "guest", ct);
            return Ok(ApiResponse<object?>.Ok(new { caseId = payload.CaseId }));
        }
        catch (CaseNotFoundException)
        {
            return BadRequest(ApiResponse<object?>.Fail(400, "This option is no longer available."));
        }
    }
}
