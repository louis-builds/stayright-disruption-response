namespace TravelDisruptionAgent.Api.Features.Coordinator;

public interface IKnowledgeBaseService
{
    Task<List<RagDocumentDto>> ListDocumentsAsync(CancellationToken ct = default);
    Task<UploadResultDto> UploadDocumentAsync(UploadDocumentRequest request, CancellationToken ct = default);
    Task SetDefaultVersionAsync(string name, int version, CancellationToken ct = default);
    Task SetUserDocumentVersionAsync(Guid userId, string documentName, int version, CancellationToken ct = default);

    Task<List<GoldenTestDto>> ListGoldenTestsAsync(CancellationToken ct = default);
    Task AddGoldenTestAsync(AddGoldenTestRequest request, CancellationToken ct = default);
    Task<GoldenTestRunDto> RunGoldenTestsAsync(string? triggerDocName, int? triggerVersion, CancellationToken ct = default);
    Task<GoldenTestRunDto?> GetLatestRunAsync(CancellationToken ct = default);

    Task<KnowledgeDashboardDto> GetDashboardAsync(CancellationToken ct = default);
}
