using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TravelDisruptionAgent.Api.Infrastructure;

namespace TravelDisruptionAgent.Api.Features.Auth;

[ApiController]
[Route("api/auth")]
public class AuthController(IAuthService authService, IConfiguration config) : ControllerBase
{
    private int RememberMeDays =>
        int.TryParse(Environment.GetEnvironmentVariable("REMEMBER_ME_COOKIE_DAYS") ?? config["REMEMBER_ME_COOKIE_DAYS"], out var d) ? d : 30;

    [HttpPost("register")]
    public async Task<ActionResult<ApiResponse<AuthUserDto>>> Register(RegisterRequest request, CancellationToken ct)
    {
        try
        {
            var user = await authService.RegisterAsync(request, ct);
            return Ok(ApiResponse<AuthUserDto>.Ok(user, "Registration successful"));
        }
        catch (AuthValidationException ex)
        {
            return BadRequest(ApiResponse<object?>.Fail(400, ex.Message));
        }
    }

    [HttpPost("login")]
    public async Task<ActionResult<ApiResponse<AuthUserDto>>> Login(LoginRequest request, CancellationToken ct)
    {
        try
        {
            var (user, principal) = await authService.LoginAsync(request, ct);

            var props = new AuthenticationProperties
            {
                IsPersistent = request.RememberMe,
                ExpiresUtc = request.RememberMe ? DateTimeOffset.UtcNow.AddDays(RememberMeDays) : null,
            };
            await HttpContext.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, principal, props);

            return Ok(ApiResponse<AuthUserDto>.Ok(user, "Login successful"));
        }
        catch (AuthValidationException ex)
        {
            return BadRequest(ApiResponse<object?>.Fail(400, ex.Message));
        }
    }

    [HttpPost("logout")]
    [Authorize]
    public async Task<ActionResult<ApiResponse<object?>>> Logout()
    {
        await HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
        return Ok(ApiResponse<object?>.Ok(null, "Logged out"));
    }

    [HttpPost("forgot-password")]
    public async Task<ActionResult<ApiResponse<ForgotPasswordResultDto>>> ForgotPassword(ForgotPasswordRequest request, CancellationToken ct)
    {
        var result = await authService.ForgotPasswordAsync(request, ct);
        return Ok(ApiResponse<ForgotPasswordResultDto>.Ok(result, "Reset link generated"));
    }

    [HttpGet("me")]
    [Authorize]
    public async Task<ActionResult<ApiResponse<AuthUserDto>>> Me(CancellationToken ct)
    {
        var idClaim = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (idClaim is null || !Guid.TryParse(idClaim, out var id))
            return Unauthorized(ApiResponse.Forbidden());

        var user = await authService.GetByIdAsync(id, ct);
        return user is null ? NotFound(ApiResponse<object?>.Fail(404, "User not found")) : Ok(ApiResponse<AuthUserDto>.Ok(user));
    }
}
