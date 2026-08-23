using Microsoft.EntityFrameworkCore;
using TravelDisruptionAgent.Api.Infrastructure.Data;
using TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

namespace TravelDisruptionAgent.Api.Features.Coordinator;

public class KnowledgeBaseRepository(AppDbContext db) : IKnowledgeBaseRepository
{
    public Task<List<RagDocument>> ListDocumentsAsync(CancellationToken ct = default) =>
        db.RagDocuments.Include(d => d.Chunks).OrderBy(d => d.Name).ThenByDescending(d => d.Version).ToListAsync(ct);

    public Task<RagDocument?> FindDocumentByNameAndVersionAsync(string name, int version, CancellationToken ct = default) =>
        db.RagDocuments.Include(d => d.Chunks).FirstOrDefaultAsync(d => d.Name == name && d.Version == version, ct);

    public async Task<int> GetNextVersionAsync(string name, CancellationToken ct = default)
    {
        var max = await db.RagDocuments.Where(d => d.Name == name).Select(d => (int?)d.Version).MaxAsync(ct);
        return (max ?? 0) + 1;
    }

    public async Task AddDocumentAsync(RagDocument doc, CancellationToken ct = default) =>
        await db.RagDocuments.AddAsync(doc, ct);

    public async Task AddChunksAsync(IEnumerable<RagDocumentChunk> chunks, CancellationToken ct = default) =>
        await db.RagDocumentChunks.AddRangeAsync(chunks, ct);

    public async Task ClearDefaultAsync(string name, CancellationToken ct = default)
    {
        var current = await db.RagDocuments.Where(d => d.Name == name && d.IsDefaultVersion).ToListAsync(ct);
        foreach (var d in current) d.IsDefaultVersion = false;
    }

    public Task<List<GoldenTest>> ListGoldenTestsAsync(CancellationToken ct = default) =>
        db.GoldenTests.ToListAsync(ct);

    public async Task AddGoldenTestAsync(GoldenTest test, CancellationToken ct = default) =>
        await db.GoldenTests.AddAsync(test, ct);

    public async Task AddGoldenTestRunAsync(GoldenTestRun run, CancellationToken ct = default) =>
        await db.GoldenTestRuns.AddAsync(run, ct);

    public Task<GoldenTestRun?> FindLatestRunAsync(CancellationToken ct = default) =>
        db.GoldenTestRuns.Include(r => r.Items).OrderByDescending(r => r.CreatedAt).FirstOrDefaultAsync(ct);

    public Task<List<GoldenTestRun>> ListRunsWithItemsAsync(CancellationToken ct = default) =>
        db.GoldenTestRuns.Include(r => r.Items).OrderByDescending(r => r.CreatedAt).ToListAsync(ct);

    public async Task SetUserDocumentVersionAsync(Guid userId, string documentName, int version, CancellationToken ct = default)
    {
        var existing = await db.UserDocumentVersions.FirstOrDefaultAsync(o => o.UserId == userId && o.DocumentName == documentName, ct);
        if (existing is not null)
        {
            existing.Version = version;
        }
        else
        {
            await db.UserDocumentVersions.AddAsync(new UserDocumentVersion
            {
                Id = Guid.NewGuid(), UserId = userId, DocumentName = documentName, Version = version,
            }, ct);
        }
    }

    public Task<int> CountAiMessagesAsync(CancellationToken ct = default) =>
        db.Messages.CountAsync(m => m.SenderRole == "ai", ct);

    public Task<int> CountVotedAsync(string vote, CancellationToken ct = default) =>
        db.Messages.CountAsync(m => m.SenderRole == "ai" && m.Vote == vote, ct);

    public Task<int> CountEscalatedAsync(CancellationToken ct = default) =>
        db.Messages.CountAsync(m => m.SenderRole == "ai" && m.Escalated, ct);

    public Task SaveChangesAsync(CancellationToken ct = default) => db.SaveChangesAsync(ct);
}
