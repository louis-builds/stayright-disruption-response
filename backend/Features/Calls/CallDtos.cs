namespace TravelDisruptionAgent.Api.Features.Calls;

/// <summary>simulateOutcome 只对 MockTelephonyProvider 有意义(真实 Twilio 接入后忽略这个字段,
/// 结果由电话网络本身决定)——留给测试/演示时确定性地触发"未接通"分支用,不传就是默认成功接通。</summary>
public record InitiateCallRequest(string CalleeType, string? SimulateOutcome = null);

public record CallDto(
    Guid Id, Guid CaseId, string CalleeType, string Status,
    DateTimeOffset StartedAt, DateTimeOffset? EndedAt, int? DurationSeconds,
    string? GuestNickname = null, string? HotelName = null, string? ConfirmationNo = null);

public record CallRecordingDto(
    Guid Id, Guid CallId, string FileUrl, int DurationSeconds, string? TranscriptText,
    string? AiSummary, string ProcessingStatus, bool Reviewed, string? CoordinatorNote);

public record ReviewRecordingRequest(bool Reviewed, string? Note);
