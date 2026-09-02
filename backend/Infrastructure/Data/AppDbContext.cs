using Microsoft.EntityFrameworkCore;
using TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

namespace TravelDisruptionAgent.Api.Infrastructure.Data;

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    private bool recordingWorkflowHistory;

    public DbSet<User> Users => Set<User>();
    public DbSet<Hotel> Hotels => Set<Hotel>();
    public DbSet<RoomType> RoomTypes => Set<RoomType>();
    public DbSet<HotelPerk> HotelPerks => Set<HotelPerk>();
    public DbSet<Booking> Bookings => Set<Booking>();
    public DbSet<Disruption> Disruptions => Set<Disruption>();
    public DbSet<Case> Cases => Set<Case>();
    public DbSet<Message> Messages => Set<Message>();
    public DbSet<Inquiry> Inquiries => Set<Inquiry>();
    public DbSet<Option> Options => Set<Option>();
    public DbSet<Notification> Notifications => Set<Notification>();
    public DbSet<RagDocument> RagDocuments => Set<RagDocument>();
    public DbSet<GoldenTest> GoldenTests => Set<GoldenTest>();
    public DbSet<RefundConfirmation> RefundConfirmations => Set<RefundConfirmation>();
    public DbSet<CaseNote> CaseNotes => Set<CaseNote>();
    public DbSet<CaseAssignment> CaseAssignments => Set<CaseAssignment>();
    public DbSet<DisruptionExclusion> DisruptionExclusions => Set<DisruptionExclusion>();
    public DbSet<DisruptionWindowAudit> DisruptionWindowAudits => Set<DisruptionWindowAudit>();
    public DbSet<OptionLockAudit> OptionLockAudits => Set<OptionLockAudit>();
    public DbSet<UserStatusAudit> UserStatusAudits => Set<UserStatusAudit>();
    public DbSet<AlertAcknowledgement> AlertAcknowledgements => Set<AlertAcknowledgement>();
    public DbSet<RagDocumentChunk> RagDocumentChunks => Set<RagDocumentChunk>();
    public DbSet<GoldenTestRun> GoldenTestRuns => Set<GoldenTestRun>();
    public DbSet<GoldenTestRunItem> GoldenTestRunItems => Set<GoldenTestRunItem>();
    public DbSet<UserDocumentVersion> UserDocumentVersions => Set<UserDocumentVersion>();
    public DbSet<SystemSettings> SystemSettings => Set<SystemSettings>();
    public DbSet<FaqQuestion> FaqQuestions => Set<FaqQuestion>();
    public DbSet<CaseWorkflowStateHistory> CaseWorkflowStateHistories => Set<CaseWorkflowStateHistory>();

    public override async Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
    {
        if (recordingWorkflowHistory) return await base.SaveChangesAsync(cancellationToken);

        var affectedCaseIds = ChangeTracker.Entries()
            .Where(entry => entry.State is EntityState.Added or EntityState.Modified or EntityState.Deleted)
            .Select(entry => entry.Entity switch
            {
                Case c => c.Id,
                Inquiry i => i.CaseId,
                Option o => o.CaseId,
                _ => Guid.Empty,
            })
            .Where(id => id != Guid.Empty)
            .Distinct()
            .ToList();

        var changed = await base.SaveChangesAsync(cancellationToken);
        if (affectedCaseIds.Count == 0) return changed;

        recordingWorkflowHistory = true;
        try
        {
            var now = DateTimeOffset.UtcNow;
            foreach (var caseId in affectedCaseIds)
            {
                var state = await DeriveWorkflowStateAsync(caseId, cancellationToken);
                if (state is null) continue;

                var current = await CaseWorkflowStateHistories
                    .Where(x => x.CaseId == caseId && x.EndedAt == null)
                    .OrderByDescending(x => x.StartedAt)
                    .FirstOrDefaultAsync(cancellationToken);
                if (current?.State == state) continue;
                if (current is not null) current.EndedAt = now;
                CaseWorkflowStateHistories.Add(new CaseWorkflowStateHistory
                {
                    Id = Guid.NewGuid(), CaseId = caseId, State = state, StartedAt = now,
                });
            }
            changed += await base.SaveChangesAsync(cancellationToken);
        }
        finally
        {
            recordingWorkflowHistory = false;
        }
        return changed;
    }

    private async Task<string?> DeriveWorkflowStateAsync(Guid caseId, CancellationToken ct)
    {
        var status = await Cases.Where(c => c.Id == caseId).Select(c => c.Status).FirstOrDefaultAsync(ct);
        if (status is null) return null;
        if (status == "closed") return "closed";
        if (await Inquiries.AnyAsync(i => i.CaseId == caseId && i.Status == "pending", ct)) return "awaiting_hotel";
        if (await Options.AnyAsync(o => o.CaseId == caseId && o.Availability != "pending", ct)) return "awaiting_guest";
        return status == "in_progress" ? "in_progress" : "new";
    }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        // 开发规范.md 第3节：表名/字段名走 EFCore.NamingConventions 的 snake_case（见 Program.cs 注册），
        // 这里只补充索引、唯一约束、jsonb 列类型等 Fluent 配置。

        modelBuilder.Entity<User>(e =>
        {
            e.HasIndex(x => x.Email).IsUnique();
            e.HasIndex(x => x.HotelId);
            e.HasOne(x => x.Hotel).WithMany().HasForeignKey(x => x.HotelId).OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<RoomType>(e =>
        {
            e.HasIndex(x => x.HotelId);
            e.HasOne(x => x.Hotel).WithMany(h => h.RoomTypes).HasForeignKey(x => x.HotelId).OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<HotelPerk>(e =>
        {
            e.HasIndex(x => x.HotelId);
            e.HasOne(x => x.Hotel).WithMany().HasForeignKey(x => x.HotelId).OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<Booking>(e =>
        {
            e.HasIndex(x => x.ConfirmationNo).IsUnique();
            e.HasIndex(x => x.GuestUserId);
            e.HasIndex(x => x.HotelId);
            e.HasIndex(x => x.RoomTypeId);
            e.HasOne(x => x.GuestUser).WithMany().HasForeignKey(x => x.GuestUserId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne(x => x.Hotel).WithMany().HasForeignKey(x => x.HotelId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne(x => x.RoomType).WithMany().HasForeignKey(x => x.RoomTypeId).OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<Disruption>(e =>
        {
            e.Property(x => x.RawSignalJson).HasColumnType("jsonb");
        });

        modelBuilder.Entity<Case>(e =>
        {
            e.HasIndex(x => x.BookingId);
            e.HasIndex(x => x.DisruptionId);
            e.HasIndex(x => x.AssigneeCoordinatorId);
            e.HasOne(x => x.Booking).WithMany().HasForeignKey(x => x.BookingId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne(x => x.Disruption).WithMany().HasForeignKey(x => x.DisruptionId).OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<CaseWorkflowStateHistory>(e =>
        {
            e.HasIndex(x => new { x.CaseId, x.StartedAt });
            e.HasIndex(x => new { x.State, x.StartedAt, x.EndedAt });
            e.HasOne(x => x.Case).WithMany().HasForeignKey(x => x.CaseId).OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<Message>(e =>
        {
            e.HasIndex(x => x.CaseId);
            e.HasOne(x => x.Case).WithMany(c => c.Messages).HasForeignKey(x => x.CaseId).OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<Inquiry>(e =>
        {
            e.HasIndex(x => x.CaseId);
            e.HasIndex(x => x.HotelId);
            e.HasOne(x => x.Case).WithMany().HasForeignKey(x => x.CaseId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.Hotel).WithMany().HasForeignKey(x => x.HotelId).OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<Option>(e =>
        {
            e.HasIndex(x => x.CaseId);
            e.Property(x => x.PayloadJson).HasColumnType("jsonb").HasColumnName("payload");
            e.HasOne(x => x.Case).WithMany().HasForeignKey(x => x.CaseId).OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<Notification>(e =>
        {
            e.HasIndex(x => x.UserId);
            e.HasIndex(x => x.CaseId);
            e.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.Case).WithMany().HasForeignKey(x => x.CaseId).OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<RagDocument>(e =>
        {
            e.HasIndex(x => new { x.Name, x.Version }).IsUnique();
        });

        modelBuilder.Entity<RefundConfirmation>(e =>
        {
            e.HasIndex(x => x.CaseId);
            e.HasOne(x => x.Case).WithMany().HasForeignKey(x => x.CaseId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne(x => x.Option).WithMany().HasForeignKey(x => x.OptionId).OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<CaseNote>(e =>
        {
            e.HasIndex(x => x.CaseId);
            e.HasOne(x => x.Case).WithMany().HasForeignKey(x => x.CaseId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.Author).WithMany().HasForeignKey(x => x.AuthorUserId).OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<CaseAssignment>(e =>
        {
            e.HasIndex(x => x.CaseId);
            e.HasOne(x => x.Case).WithMany().HasForeignKey(x => x.CaseId).OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<DisruptionExclusion>(e =>
        {
            e.HasIndex(x => new { x.DisruptionId, x.BookingId }).IsUnique();
        });

        modelBuilder.Entity<DisruptionWindowAudit>(e =>
        {
            e.HasIndex(x => x.DisruptionId);
        });

        modelBuilder.Entity<OptionLockAudit>(e =>
        {
            e.HasIndex(x => x.OptionId);
        });

        modelBuilder.Entity<UserStatusAudit>(e =>
        {
            e.HasIndex(x => x.UserId);
        });

        modelBuilder.Entity<AlertAcknowledgement>(e =>
        {
            e.HasIndex(x => new { x.AlertKey, x.AcknowledgedDate }).IsUnique();
        });

        modelBuilder.Entity<RagDocumentChunk>(e =>
        {
            e.HasIndex(x => x.RagDocumentId);
            e.HasOne(x => x.RagDocument).WithMany(d => d.Chunks).HasForeignKey(x => x.RagDocumentId).OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<GoldenTestRunItem>(e =>
        {
            e.HasIndex(x => x.RunId);
            e.HasOne(x => x.Run).WithMany(r => r.Items).HasForeignKey(x => x.RunId).OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<UserDocumentVersion>(e =>
        {
            e.HasIndex(x => new { x.UserId, x.DocumentName }).IsUnique();
        });
    }
}
