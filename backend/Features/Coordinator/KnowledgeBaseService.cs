using Pgvector;
using TravelDisruptionAgent.Api.Features.Cases;
using TravelDisruptionAgent.Api.Features.Chat;
using TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

namespace TravelDisruptionAgent.Api.Features.Coordinator;

public class KnowledgeBaseService(
    IKnowledgeBaseRepository repo, ICaseRepository caseRepository, IChatService chatService, GeminiClient gemini)
    : IKnowledgeBaseService
{
    // ponytail: 固定考题需要一个"真实案件"上下文才能跑完整对话链路(第4条考题依赖第3条的上下文记忆)，
    // 借用种子里 Alice 的案件做沙盒，只在内存里模拟消息、不落库，不会污染她的真实对话记录。
    private static readonly Guid SandboxCaseId = Guid.Parse("88888888-8888-8888-8888-000000000001");

    private static RagDocumentDto ToDto(RagDocument d) =>
        new(d.Id, d.Name, d.Version, d.IsDefaultVersion, d.SourceType, d.EffectiveFrom, d.EffectiveUntil, d.Chunks.Count, d.CreatedAt);

    public async Task<List<RagDocumentDto>> ListDocumentsAsync(CancellationToken ct = default) =>
        [.. (await repo.ListDocumentsAsync(ct)).Select(ToDto)];

    public async Task<UploadResultDto> UploadDocumentAsync(UploadDocumentRequest request, CancellationToken ct = default)
    {
        var version = await repo.GetNextVersionAsync(request.Name, ct);
        var now = DateTimeOffset.UtcNow;
        var doc = new RagDocument
        {
            Id = Guid.NewGuid(), Name = request.Name, Version = version, Content = request.Content,
            SourceType = request.SourceType, EffectiveFrom = request.EffectiveFrom, EffectiveUntil = request.EffectiveUntil,
            IsDefaultVersion = false, CreatedAt = now, UpdatedAt = now,
        };
        await repo.AddDocumentAsync(doc, ct);

        var sections = request.Content.Split("\n## ", StringSplitOptions.RemoveEmptyEntries)
            .Select(s => s.Trim()).Where(s => s.Length > 0).ToList();
        var chunks = new List<RagDocumentChunk>();
        for (var i = 0; i < sections.Count; i++)
        {
            var embedding = await gemini.EmbedAsync(sections[i], ct);
            chunks.Add(new RagDocumentChunk
            {
                Id = Guid.NewGuid(), RagDocumentId = doc.Id, ChunkIndex = i, Content = sections[i],
                Embedding = embedding is { Length: > 0 } ? new Vector(embedding) : null, CreatedAt = now,
            });
        }
        await repo.AddChunksAsync(chunks, ct);
        await repo.SaveChangesAsync(ct);
        doc.Chunks = chunks;

        var testRun = await RunGoldenTestsAsync(request.Name, version, ct);

        // 固定考题全过才自动上线为默认版本；有失败就先留着旧版本当默认，等人工复核。
        var setAsDefault = testRun.FailCount == 0;
        if (setAsDefault)
        {
            await repo.ClearDefaultAsync(request.Name, ct);
            doc.IsDefaultVersion = true;
            await repo.SaveChangesAsync(ct);
        }

        return new UploadResultDto(ToDto(doc), testRun, setAsDefault);
    }

    public async Task SetDefaultVersionAsync(string name, int version, CancellationToken ct = default)
    {
        var doc = await repo.FindDocumentByNameAndVersionAsync(name, version, ct) ?? throw new CaseNotFoundException();
        await repo.ClearDefaultAsync(name, ct);
        doc.IsDefaultVersion = true;
        await repo.SaveChangesAsync(ct);
    }

    public async Task SetUserDocumentVersionAsync(Guid userId, string documentName, int version, CancellationToken ct = default)
    {
        await repo.SetUserDocumentVersionAsync(userId, documentName, version, ct);
        await repo.SaveChangesAsync(ct);
    }

    public async Task<List<GoldenTestDto>> ListGoldenTestsAsync(CancellationToken ct = default) =>
        [.. (await repo.ListGoldenTestsAsync(ct)).Select(t => new GoldenTestDto(t.Id, t.Input, t.Expect, t.Note))];

    public async Task AddGoldenTestAsync(AddGoldenTestRequest request, CancellationToken ct = default)
    {
        var now = DateTimeOffset.UtcNow;
        await repo.AddGoldenTestAsync(new GoldenTest
        {
            Id = Guid.NewGuid(), Input = request.Input, Expect = request.Expect, Note = request.Note,
            CreatedAt = now, UpdatedAt = now,
        }, ct);
        await repo.SaveChangesAsync(ct);
    }

    public async Task<GoldenTestRunDto> RunGoldenTestsAsync(string? triggerDocName, int? triggerVersion, CancellationToken ct = default)
    {
        var tests = await repo.ListGoldenTestsAsync(ct);
        var sandboxCase = await caseRepository.FindFullAsync(SandboxCaseId, ct);
        var now = DateTimeOffset.UtcNow;

        var run = new GoldenTestRun
        {
            Id = Guid.NewGuid(), TriggerDocumentName = triggerDocName, TriggerVersion = triggerVersion, CreatedAt = now,
        };

        var history = new List<Message>();
        foreach (var test in tests)
        {
            string actual;
            bool passed;

            if (sandboxCase is null)
            {
                actual = "(sandbox case unavailable — cannot exercise live chat pipeline)";
                passed = false;
            }
            else
            {
                var reply = await chatService.GenerateReplyAsync(sandboxCase, history, test.Input, "en", ct: ct);
                actual = reply.Content;
                passed = test.Expect == "refuse_template" ? reply.IsTemplate : !reply.IsTemplate && !reply.Escalate && !string.IsNullOrWhiteSpace(reply.Content);

                history.Add(new Message { SenderRole = "guest", Content = test.Input, CreatedAt = now, UpdatedAt = now });
                history.Add(new Message { SenderRole = "ai", Content = actual, CreatedAt = now, UpdatedAt = now });
            }

            run.Items.Add(new GoldenTestRunItem
            {
                Id = Guid.NewGuid(), RunId = run.Id, GoldenTestId = test.Id,
                Input = test.Input, Expect = test.Expect, Actual = actual, Passed = passed,
            });
        }

        run.PassCount = run.Items.Count(i => i.Passed);
        run.FailCount = run.Items.Count(i => !i.Passed);

        await repo.AddGoldenTestRunAsync(run, ct);
        await repo.SaveChangesAsync(ct);

        return ToRunDto(run);
    }

    public async Task<GoldenTestRunDto?> GetLatestRunAsync(CancellationToken ct = default)
    {
        var run = await repo.FindLatestRunAsync(ct);
        return run is null ? null : ToRunDto(run);
    }

    private static GoldenTestRunDto ToRunDto(GoldenTestRun run) => new(
        run.Id, run.TriggerDocumentName, run.TriggerVersion, run.PassCount, run.FailCount, run.CreatedAt,
        [.. run.Items.Select(i => new GoldenTestRunItemDto(i.Input, i.Expect, i.Actual, i.Passed))]);

    public async Task<KnowledgeDashboardDto> GetDashboardAsync(CancellationToken ct = default)
    {
        var totalAi = await repo.CountAiMessagesAsync(ct);
        var liked = await repo.CountVotedAsync("like", ct);
        var disliked = await repo.CountVotedAsync("dislike", ct);
        var escalated = await repo.CountEscalatedAsync(ct);

        double Rate(int n) => totalAi == 0 ? 0 : Math.Round(n * 100.0 / totalAi, 1);

        var runs = await repo.ListRunsWithItemsAsync(ct);
        var versionRates = runs
            .Where(r => r.TriggerDocumentName is not null)
            .GroupBy(r => (r.TriggerDocumentName, r.TriggerVersion))
            .Select(g => g.OrderByDescending(r => r.CreatedAt).First())
            .Select(r => new GoldenTestVersionPassRateDto(
                r.TriggerDocumentName!, r.TriggerVersion ?? 0,
                r.Items.Count == 0 ? 0 : Math.Round(r.PassCount * 100.0 / r.Items.Count, 1),
                r.FailCount, r.CreatedAt))
            .OrderBy(v => v.DocumentName).ThenBy(v => v.Version)
            .ToList();

        return new KnowledgeDashboardDto(Rate(liked), Rate(disliked), Rate(escalated), totalAi, liked, disliked, escalated, versionRates);
    }
}
