using Microsoft.EntityFrameworkCore;
using TravelDisruptionAgent.Api.Infrastructure.Data;
using TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

namespace TravelDisruptionAgent.Api.Features.Coordinator;

public class SystemAdminRepository(AppDbContext db) : ISystemAdminRepository
{
    public Task<List<User>> ListUsersAsync(CancellationToken ct = default) =>
        db.Users.Include(u => u.Hotel).OrderBy(u => u.Role).ThenBy(u => u.Nickname).ToListAsync(ct);

    public Task<User?> FindByIdAsync(Guid id, CancellationToken ct = default) =>
        db.Users.FirstOrDefaultAsync(u => u.Id == id, ct);

    public async Task AddAuditAsync(UserStatusAudit audit, CancellationToken ct = default) =>
        await db.UserStatusAudits.AddAsync(audit, ct);

    public Task SaveChangesAsync(CancellationToken ct = default) => db.SaveChangesAsync(ct);
}
