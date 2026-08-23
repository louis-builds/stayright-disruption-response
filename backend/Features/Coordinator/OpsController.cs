using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TravelDisruptionAgent.Api.Infrastructure;

namespace TravelDisruptionAgent.Api.Features.Coordinator;

[ApiController]
[Route("api/coordinator/ops")]
[Authorize(Roles = "coordinator")]
public class OpsController(IOpsService opsService) : ControllerBase
{
    private Guid CurrentUserId => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    [HttpGet("overview")]
    public async Task<ActionResult<ApiResponse<OpsOverviewDto>>> GetOverview(CancellationToken ct) =>
        Ok(ApiResponse<OpsOverviewDto>.Ok(await opsService.GetOverviewAsync(ct)));

    [HttpGet("kpi")]
    public async Task<ActionResult<ApiResponse<KpiMetricsDto>>> GetKpi([FromQuery] DateOnly? day, [FromQuery] Guid? disruptionId, CancellationToken ct) =>
        Ok(ApiResponse<KpiMetricsDto>.Ok(await opsService.GetKpiAsync(day, disruptionId, ct)));

    [HttpPost("alerts/acknowledge")]
    public async Task<ActionResult<ApiResponse<object?>>> Acknowledge([FromBody] AcknowledgeAlertRequest request, CancellationToken ct)
    {
        await opsService.AcknowledgeAlertAsync(request.AlertKey, CurrentUserId, ct);
        return Ok(ApiResponse<object?>.Ok(null));
    }
}
