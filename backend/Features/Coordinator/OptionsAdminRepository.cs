using Microsoft.EntityFrameworkCore;
using TravelDisruptionAgent.Api.Infrastructure.Data;
using TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

namespace TravelDisruptionAgent.Api.Features.Coordinator;

public class OptionsAdminRepository(AppDbContext db) : IOptionsAdminRepository
{
    public Task<Case?> FindCaseWithContextAsync(Guid caseId, CancellationToken ct = default) =>
        db.Cases
            .Include(c => c.Disruption)
            .Include(c => c.Booking).ThenInclude(b => b!.Hotel)
            .Include(c => c.Booking).ThenInclude(b => b!.RoomType)
            .Include(c => c.Booking).ThenInclude(b => b!.GuestUser)
            .FirstOrDefaultAsync(c => c.Id == caseId, ct);

    public Task<string?> FindCaseStatusAsync(Guid caseId, CancellationToken ct = default) =>
        db.Cases.Where(c => c.Id == caseId).Select(c => c.Status).FirstOrDefaultAsync(ct);

    public Task<List<Option>> ListOptionsAsync(Guid caseId, CancellationToken ct = default) =>
        db.Options.Where(o => o.CaseId == caseId).OrderBy(o => o.CreatedAt).ToListAsync(ct);

    public Task<Option?> FindOptionAsync(Guid optionId, Guid caseId, CancellationToken ct = default) =>
        db.Options.FirstOrDefaultAsync(o => o.Id == optionId && o.CaseId == caseId, ct);

    public async Task AddOptionAsync(Option option, CancellationToken ct = default) =>
        await db.Options.AddAsync(option, ct);

    public Task RemoveOptionAsync(Option option, CancellationToken ct = default)
    {
        db.Options.Remove(option);
        return Task.CompletedTask;
    }

    public async Task<(Hotel Hotel, RoomType RoomType)?> FindCheapestAlternateAsync(Guid excludeHotelId, CancellationToken ct = default)
    {
        var cheapest = await db.RoomTypes
            .Include(r => r.Hotel)
            .Where(r => r.HotelId != excludeHotelId && r.Hotel!.Status == "active")
            .OrderBy(r => r.PriceAmount)
            .FirstOrDefaultAsync(ct);
        return cheapest is null ? null : (cheapest.Hotel!, cheapest);
    }

    public async Task AddLockAuditAsync(OptionLockAudit audit, CancellationToken ct = default) =>
        await db.OptionLockAudits.AddAsync(audit, ct);

    public async Task AddNotificationAsync(Notification notification, CancellationToken ct = default) =>
        await db.Notifications.AddAsync(notification, ct);

    public Task SaveChangesAsync(CancellationToken ct = default) => db.SaveChangesAsync(ct);
}
