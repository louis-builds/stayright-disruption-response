using Microsoft.EntityFrameworkCore;
using TravelDisruptionAgent.Api.Infrastructure.Data;
using TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

namespace TravelDisruptionAgent.Api.Features.Coordinator;

public class SystemSettingsRepository(AppDbContext db) : ISystemSettingsRepository
{
    public Task<SystemSettings> GetAsync(CancellationToken ct = default) =>
        db.SystemSettings.FirstAsync(ct);

    public Task SaveChangesAsync(CancellationToken ct = default) => db.SaveChangesAsync(ct);
}
