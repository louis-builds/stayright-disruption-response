namespace TravelDisruptionAgent.Api.Features.Coordinator;

public interface ISystemAdminService
{
    Task<List<AdminUserDto>> ListUsersAsync(CancellationToken ct = default);
    Task SetStatusAsync(Guid userId, string status, string reason, Guid actorUserId, CancellationToken ct = default);
    Task<ResetPasswordResultDto> ResetPasswordAsync(Guid userId, Guid actorUserId, CancellationToken ct = default);
    Task<SystemSettingsDto> GetSettingsAsync(CancellationToken ct = default);
    Task<SystemSettingsDto> UpdateSettingsAsync(SystemSettingsDto request, CancellationToken ct = default);
}
