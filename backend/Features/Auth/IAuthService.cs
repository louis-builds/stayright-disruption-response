using System.Security.Claims;

namespace TravelDisruptionAgent.Api.Features.Auth;

public interface IAuthService
{
    Task<AuthUserDto> RegisterAsync(RegisterRequest request, CancellationToken ct = default);
    Task<(AuthUserDto User, ClaimsPrincipal Principal)> LoginAsync(LoginRequest request, CancellationToken ct = default);
    Task<ForgotPasswordResultDto> ForgotPasswordAsync(ForgotPasswordRequest request, CancellationToken ct = default);
    Task<AuthUserDto?> GetByIdAsync(Guid id, CancellationToken ct = default);
}
