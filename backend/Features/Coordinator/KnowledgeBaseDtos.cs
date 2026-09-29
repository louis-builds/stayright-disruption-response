namespace TravelDisruptionAgent.Api.Features.Coordinator;

public record RagDocumentDto(
    Guid Id, string Name, int Version, bool IsDefaultVersion, string SourceType,
    DateTimeOffset? EffectiveFrom, DateTimeOffset? EffectiveUntil, int ChunkCount, DateTimeOffset CreatedAt);

public record UploadDocumentRequest(string Name, string Content, string SourceType, DateTimeOffset? EffectiveFrom, DateTimeOffset? EffectiveUntil);

public record GoldenTestDto(Guid Id, string Input, string Expect, string Note);

public record AddGoldenTestRequest(string Input, string Expect, string Note);

public record GoldenTestRunItemDto(
    string Input, string Expect, string Actual, bool Passed,
    string Kind,
    string ExpectedSummary,
    string ActualSummary,
    string? ExpectedChunkHeading,
    string? ExpectedChunkExcerpt,
    string? RetrievedDocName,
    string? RetrievedHeading,
    string? RetrievedExcerpt,
    double? RetrievedScore,
    string? Reason);

public record GoldenTestRunDto(
    Guid Id, string? TriggerDocumentName, int? TriggerVersion, int PassCount, int FailCount,
    DateTimeOffset CreatedAt, List<GoldenTestRunItemDto> Items);

public record SetDefaultVersionRequest(int Version);

public record SetUserDocumentVersionRequest(Guid UserId, int Version);

public record UploadResultDto(RagDocumentDto Document, GoldenTestRunDto TestRun, bool SetAsDefault);

public record KnowledgeDashboardDto(
    double LikeRatePercent, double DislikeRatePercent, double EscalationRatePercent,
    int TotalAiReplies, int LikedCount, int DislikedCount, int EscalatedCount,
    List<GoldenTestVersionPassRateDto> GoldenTestPassRateByVersion);

public record GoldenTestVersionPassRateDto(string DocumentName, int Version, double PassRatePercent, int FailCount, DateTimeOffset RunAt);

/// <summary>ragas 评测用：不做阈值截断的原始 top-k 检索结果。</summary>
public record RagSearchResultDto(Guid ChunkId, string DocName, int Version, int ChunkIndex, string Content, double Score);
