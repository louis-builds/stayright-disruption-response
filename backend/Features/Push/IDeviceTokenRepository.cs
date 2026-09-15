using TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

namespace TravelDisruptionAgent.Api.Features.Push;

public interface IDeviceTokenRepository
{
    Task RegisterAsync(Guid userId, string expoPushToken, string platform, CancellationToken ct = default);
    Task UnregisterAsync(string expoPushToken, CancellationToken ct = default);
    Task<List<DeviceToken>> GetTokensForUsersAsync(IEnumerable<Guid> userIds, CancellationToken ct = default);
}
