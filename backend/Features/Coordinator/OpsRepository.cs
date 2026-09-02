using Microsoft.EntityFrameworkCore;
using TravelDisruptionAgent.Api.Infrastructure.Data;
using TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

namespace TravelDisruptionAgent.Api.Features.Coordinator;

public class OpsRepository(AppDbContext db) : IOpsRepository
{
    public Task<DateTimeOffset?> FindLastDisruptionAtAsync(string type, CancellationToken ct = default) =>
        db.Disruptions.Where(d => d.Type == type).OrderByDescending(d => d.CreatedAt)
            .Select(d => (DateTimeOffset?)d.CreatedAt).FirstOrDefaultAsync(ct);

    public Task<int> CountFailedNotificationsAsync(CancellationToken ct = default) =>
        db.Notifications.CountAsync(n => !n.Success, ct);

    public Task<int> CountOverdueInquiriesAsync(TimeSpan threshold, CancellationToken ct = default)
    {
        var cutoff = DateTimeOffset.UtcNow - threshold;
        return db.Inquiries.CountAsync(i => i.Status == "pending" && i.RequestedAt < cutoff, ct);
    }

    public Task<int> CountEscalationBacklogAsync(CancellationToken ct = default) =>
        db.Cases.CountAsync(c => c.Status != "closed" && c.EscalationReason != null, ct);

    public async Task<double> NotificationSuccessRateAsync(string channel, CancellationToken ct = default)
    {
        var total = await db.Notifications.CountAsync(n => n.Channel == channel, ct);
        if (total == 0) return 100;
        var success = await db.Notifications.CountAsync(n => n.Channel == channel && n.Success, ct);
        return Math.Round(success * 100.0 / total, 1);
    }

    public async Task<bool> PingDatabaseAsync(CancellationToken ct = default)
    {
        try
        {
            return await db.Database.CanConnectAsync(ct);
        }
        catch
        {
            return false;
        }
    }

    public Task<bool> IsAcknowledgedTodayAsync(string alertKey, CancellationToken ct = default)
    {
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        return db.AlertAcknowledgements.AnyAsync(a => a.AlertKey == alertKey && a.AcknowledgedDate == today, ct);
    }

    public async Task AddAcknowledgementAsync(AlertAcknowledgement ack, CancellationToken ct = default) =>
        await db.AlertAcknowledgements.AddAsync(ack, ct);

    public Task<List<Case>> ListCasesForKpiAsync(DateOnly? day, Guid? disruptionId, CancellationToken ct = default)
    {
        var query = db.Cases.AsQueryable();
        if (day.HasValue)
        {
            var start = new DateTimeOffset(day.Value.ToDateTime(TimeOnly.MinValue), TimeSpan.Zero);
            var end = start.AddDays(1);
            query = query.Where(c => c.CreatedAt >= start && c.CreatedAt < end);
        }
        if (disruptionId.HasValue) query = query.Where(c => c.DisruptionId == disruptionId.Value);
        return query.ToListAsync(ct);
    }

    public Task<List<Notification>> ListFirstNotificationsForCasesAsync(List<Guid> caseIds, CancellationToken ct = default) =>
        db.Notifications
            .Where(n => n.CaseId != null && caseIds.Contains(n.CaseId.Value))
            .GroupBy(n => n.CaseId!.Value)
            .Select(g => g.OrderBy(n => n.SentAt).First())
            .ToListAsync(ct);

    public Task<int> CountInProgressAsync(CancellationToken ct = default) =>
        db.Cases.CountAsync(c => c.Status == "in_progress", ct);

    public Task<List<CaseWorkflowStateHistory>> ListWorkflowHistoryAsync(DateTimeOffset start, DateTimeOffset end, CancellationToken ct = default) =>
        db.CaseWorkflowStateHistories
            .Where(h => h.StartedAt < end && (h.EndedAt == null || h.EndedAt > start))
            .AsNoTracking()
            .ToListAsync(ct);

    public Task<List<Case>> ListCasesCreatedOrClosedSinceAsync(DateTimeOffset start, CancellationToken ct = default) =>
        db.Cases
            .Where(c => c.CreatedAt >= start || (c.ClosedAt != null && c.ClosedAt >= start))
            .AsNoTracking()
            .ToListAsync(ct);

    public Task SaveChangesAsync(CancellationToken ct = default) => db.SaveChangesAsync(ct);
}
