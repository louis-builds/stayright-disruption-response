using System.Security.Cryptography;
using TravelDisruptionAgent.Api.Features.Cases;
using TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

namespace TravelDisruptionAgent.Api.Features.Coordinator;

public class SystemAdminService(ISystemAdminRepository repo, ISystemSettingsRepository settingsRepo) : ISystemAdminService
{
    public async Task<List<AdminUserDto>> ListUsersAsync(CancellationToken ct = default) =>
        [.. (await repo.ListUsersAsync(ct)).Select(u => new AdminUserDto(
            u.Id, u.Nickname, u.Email, u.Role, u.Status, u.MustChangePassword,
            u.Phone, u.Gender, u.Language, u.CreatedAt, u.Hotel?.Name))];

    public async Task SetStatusAsync(Guid userId, string status, string reason, Guid actorUserId, CancellationToken ct = default)
    {
        var user = await repo.FindByIdAsync(userId, ct) ?? throw new CaseNotFoundException();
        user.Status = status;
        user.UpdatedAt = DateTimeOffset.UtcNow;
        await repo.AddAuditAsync(new UserStatusAudit
        {
            Id = Guid.NewGuid(), UserId = userId, ActorUserId = actorUserId,
            Action = status == "active" ? "enable" : "disable", Reason = reason, CreatedAt = DateTimeOffset.UtcNow,
        }, ct);
        await repo.SaveChangesAsync(ct);
        // 停用后已有会话立即失效由 Program.cs 的 Cookie OnValidatePrincipal 每请求反查账号状态实现，这里不需要额外撤销令牌。
    }

    public async Task<ResetPasswordResultDto> ResetPasswordAsync(Guid userId, Guid actorUserId, CancellationToken ct = default)
    {
        var user = await repo.FindByIdAsync(userId, ct) ?? throw new CaseNotFoundException();
        var tempPassword = GenerateTempPassword();
        user.PasswordHash = BCrypt.Net.BCrypt.HashPassword(tempPassword);
        user.MustChangePassword = true;
        user.UpdatedAt = DateTimeOffset.UtcNow;
        await repo.AddAuditAsync(new UserStatusAudit
        {
            Id = Guid.NewGuid(), UserId = userId, ActorUserId = actorUserId,
            Action = "reset_password", Reason = null, CreatedAt = DateTimeOffset.UtcNow,
        }, ct);
        await repo.SaveChangesAsync(ct);
        return new ResetPasswordResultDto(tempPassword);
    }

    public async Task<SystemSettingsDto> GetSettingsAsync(CancellationToken ct = default)
    {
        var s = await settingsRepo.GetAsync(ct);
        return new SystemSettingsDto(s.UnresolvedTurnThreshold, s.LowConfidenceEscalationEnabled);
    }

    public async Task<SystemSettingsDto> UpdateSettingsAsync(SystemSettingsDto request, CancellationToken ct = default)
    {
        var s = await settingsRepo.GetAsync(ct);
        s.UnresolvedTurnThreshold = request.UnresolvedTurnThreshold;
        s.LowConfidenceEscalationEnabled = request.LowConfidenceEscalationEnabled;
        s.UpdatedAt = DateTimeOffset.UtcNow;
        await settingsRepo.SaveChangesAsync(ct);
        return new SystemSettingsDto(s.UnresolvedTurnThreshold, s.LowConfidenceEscalationEnabled);
    }

    private static string GenerateTempPassword()
    {
        const string alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
        var bytes = RandomNumberGenerator.GetBytes(12);
        return new string([.. bytes.Select(b => alphabet[b % alphabet.Length])]);
    }
}
