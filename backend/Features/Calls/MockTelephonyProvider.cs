using TravelDisruptionAgent.Api.Features.Chat;
using TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

namespace TravelDisruptionAgent.Api.Features.Calls;

// ponytail: 没有真实 Twilio 账号，这里自己模拟"打出去"这件事的时间线(几秒后接通、再几秒后挂断)。
// 换真实 Twilio 时新写一个 TwilioTelephonyProvider 实现 ITelephonyProvider，用 Webhook 回调驱动
// 状态变化，删掉这个类，Controller/Service 都不用改。
public class MockTelephonyProvider(IServiceScopeFactory scopeFactory, ILogger<MockTelephonyProvider> logger) : ITelephonyProvider
{
    private static readonly HashSet<string> TerminalStatuses = ["completed", "failed", "no_answer"];

    public Task InitiateCallAsync(Guid callId, string? simulateOutcome, CancellationToken ct = default)
    {
        // 呼叫要跑到比这次 HTTP 请求活得更久——不能用请求自己的 CancellationToken，
        // 请求一返回它就会被取消。用独立的后台 Task + 各自的 DI scope。
        _ = Task.Run(() => SimulateAsync(callId, simulateOutcome));
        return Task.CompletedTask;
    }

    // 协调员提前挂断——跟自己跑的模拟时间线是两条独立触发路径，谁先到终态谁说了算，
    // 后到的那条必须认怂(靠 TerminalStatuses 判断已经结束就不再重复推进/建录音)，
    // 不然会出现同一通电话建了两条 CallRecording 的重复数据。
    public async Task EndCallAsync(Guid callId, CancellationToken ct = default)
    {
        var now = DateTimeOffset.UtcNow;
        Call? ended = null;
        await UpdateCallAsync(callId, call =>
        {
            if (TerminalStatuses.Contains(call.Status)) return;
            call.Status = "completed";
            call.EndedAt = now;
            ended = call;
        });

        if (ended is not null)
        {
            var recordingId = await CreateRecordingAsync(ended);
            _ = Task.Run(() => ProcessRecordingAsync(recordingId));
        }
    }

    private async Task SimulateAsync(Guid callId, string? simulateOutcome)
    {
        try
        {
            await Task.Delay(TimeSpan.FromSeconds(2));
            await UpdateCallAsync(callId, call =>
            {
                if (TerminalStatuses.Contains(call.Status)) return; // 协调员已经提前挂断，别把状态倒退回去
                call.Status = "in_progress";
            });

            await Task.Delay(TimeSpan.FromSeconds(3));
            var outcome = simulateOutcome is "no_answer" or "failed" ? simulateOutcome : "completed";
            var now = DateTimeOffset.UtcNow;

            Call? finished = null;
            await UpdateCallAsync(callId, call =>
            {
                if (TerminalStatuses.Contains(call.Status)) return; // 同上，已经有终态了就不再重复推进
                call.Status = outcome;
                call.EndedAt = now;
                finished = call;
            });

            if (outcome == "completed" && finished is not null)
            {
                var recordingId = await CreateRecordingAsync(finished);
                _ = Task.Run(() => ProcessRecordingAsync(recordingId));
            }
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Mock call simulation failed for call {CallId}", callId);
        }
    }

    private async Task UpdateCallAsync(Guid callId, Action<Call> mutate)
    {
        using var scope = scopeFactory.CreateScope();
        var repo = scope.ServiceProvider.GetRequiredService<ICallRepository>();
        var call = await repo.FindAsync(callId);
        if (call is null) return;
        mutate(call);
        call.UpdatedAt = DateTimeOffset.UtcNow;
        await repo.SaveChangesAsync();
    }

    private async Task<Guid> CreateRecordingAsync(Call call)
    {
        using var scope = scopeFactory.CreateScope();
        var repo = scope.ServiceProvider.GetRequiredService<ICallRepository>();
        var now = DateTimeOffset.UtcNow;
        var recording = new CallRecording
        {
            Id = Guid.NewGuid(),
            CallId = call.Id,
            // 相对路径,不是完整 URL——由客户端拼自己的 API_BASE_URL(跟真实对象存储直链不同域名同理)。
            // 真机上放一个真的能播的 mp3(见 wwwroot/mock-recordings/sample.mp3),不是占位死链接。
            FileUrl = "/mock-recordings/sample.mp3",
            DurationSeconds = Math.Max(1, (int)(now - call.StartedAt).TotalSeconds),
            ProcessingStatus = "pending",
            CreatedAt = now,
            UpdatedAt = now,
        };
        await repo.AddRecordingAsync(recording);
        await repo.SaveChangesAsync();
        return recording.Id;
    }

    private async Task ProcessRecordingAsync(Guid recordingId)
    {
        using var scope = scopeFactory.CreateScope();
        var repo = scope.ServiceProvider.GetRequiredService<ICallRepository>();
        try
        {
            var recording = await repo.FindRecordingAsync(recordingId) ?? throw new InvalidOperationException("recording not found");
            var call = await repo.FindAsync(recording.CallId) ?? throw new InvalidOperationException("call not found");

            recording.ProcessingStatus = "transcribing";
            recording.UpdatedAt = DateTimeOffset.UtcNow;
            await repo.SaveChangesAsync();

            var asr = scope.ServiceProvider.GetRequiredService<IAsrProvider>();
            var transcript = await asr.TranscribeAsync(recording.FileUrl);

            recording.TranscriptText = transcript;
            recording.ProcessingStatus = "summarizing";
            recording.UpdatedAt = DateTimeOffset.UtcNow;
            await repo.SaveChangesAsync();

            var gemini = scope.ServiceProvider.GetRequiredService<GeminiClient>();
            var prompt =
                "You are summarizing a phone call between a hotel-disruption coordinator and a " +
                $"{(call.CalleeType == "hotel" ? "hotel" : "guest")}, for internal case notes.\n" +
                $"Call duration: {recording.DurationSeconds} seconds.\n" +
                $"Transcript:\n{transcript}\n\n" +
                "In 2-4 short bullet points, summarize: the main request/issue, any commitment made, and any follow-up action needed. " +
                "Be concise and factual, do not invent details not in the transcript.";
            var summary = await gemini.GenerateAsync(prompt);

            recording.AiSummary = summary ?? "AI 总结暂时不可用（Gemini 未配置或调用失败），请人工回听录音。";
            recording.ProcessingStatus = "done";
            recording.UpdatedAt = DateTimeOffset.UtcNow;
            await repo.SaveChangesAsync();
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Recording processing failed for {RecordingId}", recordingId);
            var recording = await repo.FindRecordingAsync(recordingId);
            if (recording is not null)
            {
                recording.ProcessingStatus = "failed";
                recording.UpdatedAt = DateTimeOffset.UtcNow;
                await repo.SaveChangesAsync();
            }
        }
    }
}
