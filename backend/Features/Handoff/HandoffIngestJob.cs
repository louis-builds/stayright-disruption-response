using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using TravelDisruptionAgent.Api.Features.Disruption;
using TravelDisruptionAgent.Api.Infrastructure.Data;
using DisruptionEntity = TravelDisruptionAgent.Api.Infrastructure.Data.Entities.Disruption;

namespace TravelDisruptionAgent.Api.Features.Handoff;

/// <summary>
/// 监听 detect 那条 Python 管线写的 handoff.jsonl，一有变化就立刻摄入——不再靠固定周期轮询。
/// FileSystemWatcher 在部分部署环境(比如某些 Docker 挂载卷)不保证一定触发，所以还留一道
/// 5 分钟兜底轮询，两条触发路径最终都调同一个 IngestAsync。
///
/// disruption_event 一行落一条 Disruption；disruption_event_id 那些行按 booking_id
/// （detect 现在直接查真实 travel_disruption 库拿到的真 Guid，不是外部系统的占位符）分组，
/// 交给 IDisruptionService.NotifyCandidatesAsync 走一遍跟协调员手动点"Notify guests"完全一样的
/// 建案+指派+通知流程——这就是"探测到受影响客人后自动建案通知"这条集成的最后一段。
/// </summary>
public class HandoffIngestJob(IServiceScopeFactory scopeFactory, ILogger<HandoffIngestJob> logger) : BackgroundService
{
    private static readonly TimeSpan FallbackInterval = TimeSpan.FromMinutes(5);
    private static readonly TimeSpan DebounceDelay = TimeSpan.FromMilliseconds(300);

    private readonly SemaphoreSlim ingestLock = new(1, 1);
    private System.Threading.Timer? debounceTimer;

    private static string ResolvePath() =>
        Environment.GetEnvironmentVariable("HANDOFF_JSONL_PATH") ??
        Path.Combine(Directory.GetCurrentDirectory(), "..", "detect", "output", "handoff.jsonl");

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var path = ResolvePath();
        logger.LogInformation("Handoff ingest watching {Path}", path);

        await RunIngestSafelyAsync(path, stoppingToken);

        using var watcher = TryCreateWatcher(path);

        try
        {
            while (!stoppingToken.IsCancellationRequested)
            {
                await Task.Delay(FallbackInterval, stoppingToken);
                await RunIngestSafelyAsync(path, stoppingToken);
            }
        }
        catch (OperationCanceledException)
        {
            // 正常停机
        }
    }

    private FileSystemWatcher? TryCreateWatcher(string path)
    {
        var dir = Path.GetDirectoryName(Path.GetFullPath(path));
        var fileName = Path.GetFileName(path);
        if (dir is null || !Directory.Exists(dir))
        {
            // detect/output 目录还没出现(比如本地没拉 detect/ 或者管线还没跑过一次)——
            // FileSystemWatcher 建不到一个不存在的目录，靠上面的 5 分钟兜底轮询自己发现文件出现。
            logger.LogInformation("Handoff directory {Dir} doesn't exist yet, relying on fallback poll", dir);
            return null;
        }

        debounceTimer ??= new System.Threading.Timer(_ => _ = RunIngestSafelyAsync(path, CancellationToken.None));

        var watcher = new FileSystemWatcher(dir, fileName)
        {
            NotifyFilter = NotifyFilters.LastWrite | NotifyFilters.Size | NotifyFilters.FileName,
        };
        // detect 那边是逐行 append 写入，一次逻辑上的"写完一条消息"经常会触发好几个 Changed 事件——
        // 用防抖：每次事件把定时器往后推，安静 300ms 之后才真正跑一次摄入，不是事件一响就跑。
        void OnFileEvent(object sender, FileSystemEventArgs e) =>
            debounceTimer?.Change(DebounceDelay, Timeout.InfiniteTimeSpan);
        watcher.Changed += OnFileEvent;
        watcher.Created += OnFileEvent;
        watcher.Renamed += (_, _) => debounceTimer?.Change(DebounceDelay, Timeout.InfiniteTimeSpan);
        watcher.EnableRaisingEvents = true;
        return watcher;
    }

    private async Task RunIngestSafelyAsync(string path, CancellationToken ct)
    {
        if (!await ingestLock.WaitAsync(0, ct)) return; // 上一轮还没跑完就跳过这次触发，不重叠执行
        try
        {
            if (!File.Exists(path)) return;
            using var scope = scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var disruptionService = scope.ServiceProvider.GetRequiredService<IDisruptionService>();
            await IngestAsync(db, disruptionService, path, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogError(ex, "Handoff jsonl ingest failed");
        }
        finally
        {
            ingestLock.Release();
        }
    }

    private static async Task IngestAsync(AppDbContext db, IDisruptionService disruptionService, string path, CancellationToken ct)
    {
        var lines = await File.ReadAllLinesAsync(path, ct);
        var now = DateTimeOffset.UtcNow;
        var severityByDisruption = new Dictionary<Guid, string?>();
        var bookingIdsByDisruption = new Dictionary<Guid, List<Guid>>();

        foreach (var line in lines)
        {
            if (string.IsNullOrWhiteSpace(line)) continue;

            JsonDocument doc;
            try
            {
                doc = JsonDocument.Parse(line);
            }
            catch (JsonException)
            {
                // 文件可能正被追加写入，最后一行有时候是写到一半的——跳过，等下一轮重扫读到完整的再处理。
                continue;
            }
            using var _ = doc;
            var root = doc.RootElement;

            if (root.TryGetProperty("disruption_event", out var evt))
            {
                var id = await UpsertDisruptionAsync(db, evt, now, ct);
                if (id.HasValue)
                    severityByDisruption[id.Value] = evt.TryGetProperty("severity", out var sev) ? sev.GetString() : null;
            }
            else if (root.TryGetProperty("disruption_event_id", out var disruptionIdProp) &&
                     Guid.TryParse(disruptionIdProp.GetString(), out var disruptionId) &&
                     root.TryGetProperty("booking_id", out var bookingIdProp) &&
                     Guid.TryParse(bookingIdProp.GetString(), out var bookingId))
            {
                if (!bookingIdsByDisruption.TryGetValue(disruptionId, out var list))
                    bookingIdsByDisruption[disruptionId] = list = [];
                list.Add(bookingId);
            }
        }

        await db.SaveChangesAsync(ct);

        foreach (var (disruptionId, bookingIds) in bookingIdsByDisruption)
        {
            var priority = severityByDisruption.GetValueOrDefault(disruptionId) == "high" ? "high" : "normal";
            try
            {
                await disruptionService.NotifyCandidatesAsync(
                    disruptionId, new NotifyCandidatesRequest([.. bookingIds.Distinct()], priority), ct);
            }
            catch (DisruptionNotFoundException)
            {
                // 这一行引用的 disruption_event 从没成功落库过(比如那一行本身格式不对被跳过了)——跳过这批。
            }
        }
    }

    private static async Task<Guid?> UpsertDisruptionAsync(AppDbContext db, JsonElement evt, DateTimeOffset now, CancellationToken ct)
    {
        if (!Guid.TryParse(evt.GetProperty("id").GetString(), out var id)) return null;
        if (await db.Disruptions.AnyAsync(d => d.Id == id, ct)) return id;

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
        return id;
    }

    public override void Dispose()
    {
        debounceTimer?.Dispose();
        ingestLock.Dispose();
        base.Dispose();
    }
}
