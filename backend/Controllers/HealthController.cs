using Microsoft.AspNetCore.Mvc;
using TravelDisruptionAgent.Api.Infrastructure;
using TravelDisruptionAgent.Api.Infrastructure.Data;

namespace TravelDisruptionAgent.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class HealthController(AppDbContext db) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<ApiResponse<object>>> Get(CancellationToken ct)
    {
        var dbOk = await db.Database.CanConnectAsync(ct);
        return Ok(ApiResponse<object>.Ok(new { status = "ok", database = dbOk ? "connected" : "unreachable" }));
    }
}
