using TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

namespace TravelDisruptionAgent.Api.Features.Coordinator;

public interface ISystemAdminRepository
{
    Task<List<User>> ListUsersAsync(CancellationToken ct = default);
    Task<User?> FindByIdAsync(Guid id, CancellationToken ct = default);
    Task AddAuditAsync(UserStatusAudit audit, CancellationToken ct = default);
    Task SaveChangesAsync(CancellationToken ct = default);
}
