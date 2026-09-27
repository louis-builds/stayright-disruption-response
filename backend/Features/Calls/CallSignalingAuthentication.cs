using System.Security.Claims;
using System.Text.Encodings.Web;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using TravelDisruptionAgent.Api.Infrastructure;
using TravelDisruptionAgent.Api.Infrastructure.Data;

namespace TravelDisruptionAgent.Api.Features.Calls;

public class CallSignalingTokens(IDataProtectionProvider protection)
{
    private readonly IDataProtector protector = protection.CreateProtector("StayRight.CallSignaling.v1");
    public record Ticket(Guid UserId, DateTimeOffset ExpiresAt);
    public string Issue(Guid userId) =>
        protector.Protect(JsonSerializer.Serialize(new Ticket(userId, DateTimeOffset.UtcNow.AddHours(1))));
    public Ticket? Read(string token)
    {
        try { return JsonSerializer.Deserialize<Ticket>(protector.Unprotect(token)); }
        catch (System.Security.Cryptography.CryptographicException) { return null; }
        catch (JsonException) { return null; }
    }
}

public class CallSignalingAuthentication(
    IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder,
    CallSignalingTokens tokens, AppDbContext db) : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    public const string SchemeName = "CallSignaling";
    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        if (!Request.Path.StartsWithSegments("/api/hubs/calls")) return AuthenticateResult.NoResult();
        var header = Request.Headers.Authorization.ToString();
        var token = header.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)
            ? header[7..] : Request.Query["access_token"].ToString();
        if (string.IsNullOrWhiteSpace(token)) return AuthenticateResult.NoResult();
        var ticket = tokens.Read(token);
        if (ticket is null || ticket.ExpiresAt <= DateTimeOffset.UtcNow)
            return AuthenticateResult.Fail("Call signaling token expired or invalid");
        var user = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == ticket.UserId, Context.RequestAborted);
        if (user is null || user.Status != "active" || user.Role is not ("coordinator" or "guest"))
            return AuthenticateResult.Fail("Account unavailable");
        var identity = new ClaimsIdentity([
            new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
            new Claim(ClaimTypes.Role, user.Role)
        ], SchemeName);
        return AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(identity),
            new AuthenticationProperties { ExpiresUtc = ticket.ExpiresAt }, SchemeName));
    }
}

[ApiController]
[Route("api/calls")]
[Authorize(Roles = "coordinator,guest")]
public class CallConnectionController(CallSignalingTokens tokens, IConfiguration configuration) : ControllerBase
{
    [HttpPost("signaling-token")]
    public ActionResult<ApiResponse<object>> Token() =>
        Ok(ApiResponse<object>.Ok(new {
            token = tokens.Issue(Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!))
        }));

    [HttpGet("ice-servers")]
    public ActionResult<ApiResponse<object>> IceServers()
    {
        // Local testing can use host candidates. Internet calls need a team-approved STUN/TURN service.
        var urls = (configuration["WEBRTC_STUN_URLS"] ?? "")
            .Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);
        if (urls.Any(url => !url.StartsWith("stun:", StringComparison.OrdinalIgnoreCase)))
            return StatusCode(503, ApiResponse<object>.Fail(503, "Invalid STUN configuration"));
        object[] servers = urls.Length == 0 ? [] : [new { urls }];
        return Ok(ApiResponse<object>.Ok(servers));
    }
}
