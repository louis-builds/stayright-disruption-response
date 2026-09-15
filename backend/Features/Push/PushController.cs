using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TravelDisruptionAgent.Api.Infrastructure;

namespace TravelDisruptionAgent.Api.Features.Push;

[ApiController]
[Route("api/push")]
[Authorize]
public class PushController(IDeviceTokenRepository tokens) : ControllerBase
{
    private Guid CurrentUserId => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    [HttpPost("register")]
    public async Task<ActionResult<ApiResponse<object?>>> Register([FromBody] RegisterDeviceTokenRequest req, CancellationToken ct)
    {
        await tokens.RegisterAsync(CurrentUserId, req.ExpoPushToken, req.Platform, ct);
        return Ok(ApiResponse<object?>.Ok(null));
    }

    [HttpDelete("register")]
    public async Task<ActionResult<ApiResponse<object?>>> Unregister([FromQuery] string expoPushToken, CancellationToken ct)
    {
        await tokens.UnregisterAsync(expoPushToken, ct);
        return Ok(ApiResponse<object?>.Ok(null));
    }
}
