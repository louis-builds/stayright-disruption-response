using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using TravelDisruptionAgent.Api.Infrastructure.Data;
using DisruptionEntity = TravelDisruptionAgent.Api.Infrastructure.Data.Entities.Disruption;
using HandoffAffectedCustomer = TravelDisruptionAgent.Api.Infrastructure.Data.Entities.HandoffAffectedCustomer;

namespace TravelDisruptionAgent.Api.Features.Handoff;

/// <summary>
/// 每分钟扫一次 detect 那条 Python 管线写的 handoff.jsonl（disruption_event 一行 + 每个受影响客人一行）。
/// 全量重读整份文件、按主键 upsert-if-absent，不维护读取偏移量——文件是 demo 规模，重扫成本可忽略，
/// 换来的是逻辑简单、重启/文件轮替都不用另外处理。guest_id/booking_id 是外部系统的字符串 id，
/// 跟这边的 Guid 对不上，先落进 handoff_affected_customers 留痕，真实匹配以后再做。
/// </summary>
public class HandoffIngestJob(IServiceScopeFactory scopeFactory, ILogger<HandoffIngestJob> logger) : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromMinutes(1);

    private static string ResolvePath() =>
        Environment.GetEnvironmentVariable("HANDOFF_JSONL_PATH") ??
        Path.Combine(Directory.GetCurrentDirectory(), "..", "detect", "output", "handoff.jsonl");

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var path = ResolvePath();
        logger.LogInformation("Handoff ingest watching {Path}", path);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                if (File.Exists(path))
                {
                    using var scope = scopeFactory.CreateScope();
                    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                    await IngestAsync(db, path, stoppingToken);
                }
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogError(ex, "Handoff jsonl ingest failed");
            }

            try
            {
                await Task.Delay(Interval, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }

    private static async Task IngestAsync(AppDbContext db, string path, CancellationToken ct)
    {
        var lines = await File.ReadAllLinesAsync(path, ct);
        var now = DateTimeOffset.UtcNow;

        foreach (var line in lines)
        {
            if (string.IsNullOrWhiteSpace(line)) continue;

            using var doc = JsonDocument.Parse(line);
            var root = doc.RootElement;

            if (root.TryGetProperty("disruption_event", out var evt))
            {
                await UpsertDisruptionAsync(db, evt, now, ct);
            }
            else if (root.TryGetProperty("disruption_event_id", out var disruptionIdProp))
            {
                await UpsertAffectedCustomerAsync(db, root, disruptionIdProp, now, ct);
            }
        }

        await db.SaveChangesAsync(ct);
    }

    private static async Task UpsertDisruptionAsync(AppDbContext db, JsonElement evt, DateTimeOffset now, CancellationToken ct)
    {
        var id = Guid.Parse(evt.GetProperty("id").GetString()!);
        if (await db.Disruptions.AnyAsync(d => d.Id == id, ct)) return;

        var type = evt.GetProperty("type").GetString() ?? "weather";
        var subtype = evt.TryGetProperty("event_subtype", out var st) ? st.GetString() : null;
        var geo = evt.TryGetProperty("geo", out var g) && g.ValueKind == JsonValueKind.Object ? g : (JsonElement?)null;
        var window = evt.TryGetProperty("affects_window", out var w) && w.ValueKind == JsonValueKind.Object ? w : (JsonElement?)null;
        var rawSignal = evt.TryGetProperty("raw_signal", out var rs) && rs.ValueKind == JsonValueKind.Object ? rs : (JsonElement?)null;

        db.Disruptions.Add(new DisruptionEntity
        {
            Id = id,
            Type = type,
            EventSubtype = subtype,
            Title = $"{type}/{subtype} disruption",
            Region = "",
            Severity = evt.TryGetProperty("severity", out var sev) ? sev.GetString() : null,
            Lat = geo?.TryGetProperty("lat", out var lat) == true ? lat.GetDouble() : null,
            Lng = geo?.TryGetProperty("lng", out var lng) == true ? lng.GetDouble() : null,
            RadiusKm = geo?.TryGetProperty("radius_km", out var rad) == true ? rad.GetDouble() : null,
            StartAt = window?.TryGetProperty("start", out var s) == true ? s.GetDateTimeOffset() : now,
            EndAtOrWindow = window?.TryGetProperty("end", out var e) == true ? e.GetDateTimeOffset() : null,
            Status = "active",
            RawSignalText = evt.TryGetProperty("detected_at", out var da) ? $"Detected at {da.GetString()}" : "",
            RawSignalJson = rawSignal?.GetRawText(),
            CreatedAt = now,
            UpdatedAt = now,
        });
    }

    private static async Task UpsertAffectedCustomerAsync(
        AppDbContext db, JsonElement root, JsonElement disruptionIdProp, DateTimeOffset now, CancellationToken ct)
    {
        var disruptionId = Guid.Parse(disruptionIdProp.GetString()!);
        var guestId = root.GetProperty("guest_id").GetString() ?? "";
        var bookingId = root.GetProperty("booking_id").GetString() ?? "";

        var exists = await db.HandoffAffectedCustomers.AnyAsync(
            x => x.DisruptionId == disruptionId && x.ExternalBookingId == bookingId, ct);
        if (exists) return;

        db.HandoffAffectedCustomers.Add(new HandoffAffectedCustomer
        {
            Id = Guid.NewGuid(), DisruptionId = disruptionId,
            ExternalGuestId = guestId, ExternalBookingId = bookingId, ReceivedAt = now,
        });
    }
}
