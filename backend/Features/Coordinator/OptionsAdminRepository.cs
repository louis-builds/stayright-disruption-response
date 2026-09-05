using Microsoft.EntityFrameworkCore;
using TravelDisruptionAgent.Api.Infrastructure.Data;
using TravelDisruptionAgent.Api.Infrastructure.Data.Entities;
using Microsoft.EntityFrameworkCore.Storage;
using System.Data;

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

    public async Task<List<(Hotel Hotel, RoomType RoomType)>> ListAlternateCandidatesAsync(Guid excludeHotelId, CancellationToken ct = default)
    {
        var roomTypes = await db.RoomTypes
            .Include(r => r.Hotel)
            .Where(r => r.HotelId != excludeHotelId && r.Hotel!.Status == "active")
            .ToListAsync(ct);
        return [.. roomTypes.Select(r => (r.Hotel!, r))];
    }

    public async Task AddLockAuditAsync(OptionLockAudit audit, CancellationToken ct = default) =>
        await db.OptionLockAudits.AddAsync(audit, ct);

    public async Task<HashSet<Guid>> ListOfferedAlternateHotelIdsAsync(Guid caseId, CancellationToken ct = default) =>
        (await db.AlternateOfferAudits.Where(a => a.CaseId == caseId).Select(a => a.HotelId).ToListAsync(ct)).ToHashSet();

    public async Task AddAlternateOfferAsync(Guid caseId, Guid hotelId, CancellationToken ct = default) =>
        await db.AlternateOfferAudits.AddAsync(new AlternateOfferAudit
        {
            Id = Guid.NewGuid(), CaseId = caseId, HotelId = hotelId, CreatedAt = DateTimeOffset.UtcNow,
        }, ct);

    public async Task AddMessageAsync(Message message, CancellationToken ct = default) =>
        await db.Messages.AddAsync(message, ct);

    public async Task AddNotificationAsync(Notification notification, CancellationToken ct = default) =>
        await db.Notifications.AddAsync(notification, ct);

    public Task<Notification?> FindLatestOptionsPushAsync(Guid caseId, bool successfulOnly, CancellationToken ct = default) =>
        db.Notifications
            .Where(n => n.CaseId == caseId && n.Type == "options_pushed" && (!successfulOnly || n.Success))
            .OrderByDescending(n => n.SentAt)
            .FirstOrDefaultAsync(ct);

    public Task<DateTimeOffset?> FindLatestOptionUpdateAsync(Guid caseId, CancellationToken ct = default) =>
        db.Options.Where(o => o.CaseId == caseId).MaxAsync(o => (DateTimeOffset?)o.UpdatedAt, ct);

    public Task<IDbContextTransaction> BeginTransactionAsync(CancellationToken ct = default) =>
        db.Database.BeginTransactionAsync(ct);

    public async Task<bool> LockCaseForUpdateAsync(Guid caseId, CancellationToken ct = default)
    {
        var connection = db.Database.GetDbConnection();
        if (connection.State != ConnectionState.Open) await connection.OpenAsync(ct);
        await using var command = connection.CreateCommand();
        command.Transaction = db.Database.CurrentTransaction?.GetDbTransaction();
        command.CommandText = "SELECT 1 FROM cases WHERE id = @caseId FOR UPDATE";
        var parameter = command.CreateParameter();
        parameter.ParameterName = "caseId";
        parameter.Value = caseId;
        command.Parameters.Add(parameter);
        return await command.ExecuteScalarAsync(ct) is not null;
    }

    public Task SaveChangesAsync(CancellationToken ct = default) => db.SaveChangesAsync(ct);
}
