using Microsoft.AspNetCore.Mvc;
using TravelDisruptionAgent.Api.Features.Disruption;
using TravelDisruptionAgent.Api.Infrastructure;
using TravelDisruptionAgent.Api.Infrastructure.Auth;

namespace TravelDisruptionAgent.Api.Features.Ingest;

// 探测器写入新中断事件的入口；建案/通知/运营台展示复用 Features/Disruption
// 现成的下游逻辑，这里只负责建 Disruption 本身。
[ApiController]
[Route("api/ingest/disruptions")]
[TypeFilter(typeof(IngestKeyAuthFilter))]
public class IngestController(IDisruptionService disruptionService) : ControllerBase
{
    [HttpPost]
    public async Task<ActionResult<ApiResponse<CreateDisruptionResultDto>>> Create(
        [FromBody] CreateDisruptionRequest request, CancellationToken ct)
    {
        var id = await disruptionService.IngestAsync(request, ct);
        return Ok(ApiResponse<CreateDisruptionResultDto>.Ok(new CreateDisruptionResultDto(id)));
    }
}
