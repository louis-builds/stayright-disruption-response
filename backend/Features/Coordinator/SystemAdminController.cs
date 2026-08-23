using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TravelDisruptionAgent.Api.Features.Cases;
using TravelDisruptionAgent.Api.Infrastructure;

namespace TravelDisruptionAgent.Api.Features.Coordinator;

[ApiController]
[Route("api/coordinator/users")]
[Authorize(Roles = "coordinator")]
public class SystemAdminController(ISystemAdminService adminService) : ControllerBase
{
    private Guid CurrentUserId => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    [HttpGet]
    public async Task<ActionResult<ApiResponse<List<AdminUserDto>>>> List(CancellationToken ct) =>
        Ok(ApiResponse<List<AdminUserDto>>.Ok(await adminService.ListUsersAsync(ct)));

    [HttpPost("{id:guid}/disable")]
    public async Task<ActionResult<ApiResponse<object?>>> Disable(Guid id, [FromBody] DisableUserRequest request, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.Reason)) return BadRequest(ApiResponse<object?>.Fail(400, "Reason is required"));
        try
        {
            await adminService.SetStatusAsync(id, "disabled", request.Reason, CurrentUserId, ct);
            return Ok(ApiResponse<object?>.Ok(null));
        }
        catch (CaseNotFoundException)
        {
            return NotFound(ApiResponse<object?>.Fail(404, "User not found"));
        }
    }

    [HttpPost("{id:guid}/enable")]
    public async Task<ActionResult<ApiResponse<object?>>> Enable(Guid id, CancellationToken ct)
    {
        try
        {
            await adminService.SetStatusAsync(id, "active", "Re-enabled by coordinator", CurrentUserId, ct);
            return Ok(ApiResponse<object?>.Ok(null));
        }
        catch (CaseNotFoundException)
        {
            return NotFound(ApiResponse<object?>.Fail(404, "User not found"));
        }
    }

    [HttpGet("settings")]
    public async Task<ActionResult<ApiResponse<SystemSettingsDto>>> GetSettings(CancellationToken ct) =>
        Ok(ApiResponse<SystemSettingsDto>.Ok(await adminService.GetSettingsAsync(ct)));

    [HttpPut("settings")]
    public async Task<ActionResult<ApiResponse<SystemSettingsDto>>> UpdateSettings(SystemSettingsDto request, CancellationToken ct) =>
        Ok(ApiResponse<SystemSettingsDto>.Ok(await adminService.UpdateSettingsAsync(request, ct)));

    [HttpPost("{id:guid}/reset-password")]
    public async Task<ActionResult<ApiResponse<ResetPasswordResultDto>>> ResetPassword(Guid id, CancellationToken ct)
    {
        try
        {
            return Ok(ApiResponse<ResetPasswordResultDto>.Ok(await adminService.ResetPasswordAsync(id, CurrentUserId, ct)));
        }
        catch (CaseNotFoundException)
        {
            return NotFound(ApiResponse<object?>.Fail(404, "User not found"));
        }
    }
}
