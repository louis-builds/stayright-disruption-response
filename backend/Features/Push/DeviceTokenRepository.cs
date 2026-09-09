using Microsoft.EntityFrameworkCore;
using TravelDisruptionAgent.Api.Infrastructure.Data;
using TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

namespace TravelDisruptionAgent.Api.Features.Push;

public class DeviceTokenRepository(AppDbContext db) : IDeviceTokenRepository
{
    public async Task RegisterAsync(Guid userId, string expoPushToken, string platform, CancellationToken ct = default)
    {
        var existing = await db.DeviceTokens.FirstOrDefaultAsync(t => t.ExpoPushToken == expoPushToken, ct);
        var now = DateTimeOffset.UtcNow;
        if (existing is null)
        {
            db.DeviceTokens.Add(new DeviceToken
            {
                Id = Guid.NewGuid(), UserId = userId, ExpoPushToken = expoPushToken, Platform = platform,
                CreatedAt = now, UpdatedAt = now,
            });
        }
        else
        {
            existing.UserId = userId;
            existing.Platform = platform;
            existing.UpdatedAt = now;
        }
        await db.SaveChangesAsync(ct);
    }

    public async Task UnregisterAsync(string expoPushToken, CancellationToken ct = default)
    {
        await db.DeviceTokens.Where(t => t.ExpoPushToken == expoPushToken).ExecuteDeleteAsync(ct);
    }

    public async Task<List<DeviceToken>> GetTokensForUsersAsync(IEnumerable<Guid> userIds, CancellationToken ct = default)
    {
        var ids = userIds.Distinct().ToList();
        return await db.DeviceTokens.Where(t => ids.Contains(t.UserId)).ToListAsync(ct);
    }
}
