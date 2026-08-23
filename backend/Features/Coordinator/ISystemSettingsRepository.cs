using TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

namespace TravelDisruptionAgent.Api.Features.Coordinator;

public interface ISystemSettingsRepository
{
    /// <summary>表里永远只有一行（迁移里种子插入的那行），直接取第一条。</summary>
    Task<SystemSettings> GetAsync(CancellationToken ct = default);
    Task SaveChangesAsync(CancellationToken ct = default);
}
