using System.Text.Json;
using TravelDisruptionAgent.Api.Features.Chat;

namespace TravelDisruptionAgent.Api.Features.Calls;

public class CallRecordingProcessor(ICallRepository repo, IAsrProvider asr, GeminiClient gemini, ILogger<CallRecordingProcessor> logger)
{
    private static readonly JsonSerializerOptions InsightsJson = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    public async Task ProcessAsync(Guid recordingId, CancellationToken ct = default)
    {
        try
        {
            var recording = await repo.FindRecordingAsync(recordingId, ct) ?? throw new InvalidOperationException("recording not found");
            var call = await repo.FindAsync(recording.CallId, ct) ?? throw new InvalidOperationException("call not found");

            recording.ProcessingStatus = "transcribing";
            recording.UpdatedAt = DateTimeOffset.UtcNow;
            await repo.SaveChangesAsync(ct);

            var transcript = await asr.TranscribeAsync(recording.FileUrl, ct);

            recording.TranscriptText = transcript;
            recording.ProcessingStatus = "summarizing";
            recording.UpdatedAt = DateTimeOffset.UtcNow;
            await repo.SaveChangesAsync(ct);

            var prompt =
                "You are summarizing a phone call between a hotel-disruption coordinator and a " +
                $"{(call.CalleeType == "hotel" ? "hotel" : "guest")}, for internal case notes.\n" +
                $"Call duration: {recording.DurationSeconds} seconds.\n" +
                $"Transcript:\n{transcript}\n\n" +
                "In 2-4 short bullet points, summarize: the main request/issue, any commitment made, and any follow-up action needed. " +
                "Be concise and factual, do not invent details not in the transcript.";
            var summary = await gemini.GenerateAsync(prompt, ct);

            recording.AiSummary = summary ?? "AI 总结暂时不可用（Gemini 未配置或调用失败），请人工回听录音。";
            var extracted = await gemini.ExtractCallInsightsAsync(transcript, ct);
            if (extracted is not null)
            {
                recording.InsightsJson = JsonSerializer.Serialize(new CallInsightsPayload
                {
                    KeepMessagesSimple = new(extracted.KeepMessagesSimple, extracted.KeepMessagesSimpleQuote),
                    SpeakSlowly = new(extracted.SpeakSlowly, extracted.SpeakSlowlyQuote),
                    StayPreference = new(extracted.StayPreference, extracted.StayPreferenceQuote),
                }, InsightsJson);
            }
            recording.ProcessingStatus = "done";
            recording.UpdatedAt = DateTimeOffset.UtcNow;
            await repo.SaveChangesAsync(ct);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Recording processing failed for {RecordingId}", recordingId);
            var recording = await repo.FindRecordingAsync(recordingId, ct);
            if (recording is not null)
            {
                recording.ProcessingStatus = "failed";
                recording.UpdatedAt = DateTimeOffset.UtcNow;
                await repo.SaveChangesAsync(ct);
            }
        }
    }
}
