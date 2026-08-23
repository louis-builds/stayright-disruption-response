using TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

namespace TravelDisruptionAgent.Api.Features.Coordinator;

public interface IKnowledgeBaseRepository
{
    Task<List<RagDocument>> ListDocumentsAsync(CancellationToken ct = default);
    Task<RagDocument?> FindDocumentByNameAndVersionAsync(string name, int version, CancellationToken ct = default);
    Task<int> GetNextVersionAsync(string name, CancellationToken ct = default);
    Task AddDocumentAsync(RagDocument doc, CancellationToken ct = default);
    Task AddChunksAsync(IEnumerable<RagDocumentChunk> chunks, CancellationToken ct = default);
    Task ClearDefaultAsync(string name, CancellationToken ct = default);

    Task<List<GoldenTest>> ListGoldenTestsAsync(CancellationToken ct = default);
    Task AddGoldenTestAsync(GoldenTest test, CancellationToken ct = default);
    Task AddGoldenTestRunAsync(GoldenTestRun run, CancellationToken ct = default);
    Task<GoldenTestRun?> FindLatestRunAsync(CancellationToken ct = default);
    Task<List<GoldenTestRun>> ListRunsWithItemsAsync(CancellationToken ct = default);

    Task SetUserDocumentVersionAsync(Guid userId, string documentName, int version, CancellationToken ct = default);

    Task<int> CountAiMessagesAsync(CancellationToken ct = default);
    Task<int> CountVotedAsync(string vote, CancellationToken ct = default);
    Task<int> CountEscalatedAsync(CancellationToken ct = default);

    Task SaveChangesAsync(CancellationToken ct = default);
}
