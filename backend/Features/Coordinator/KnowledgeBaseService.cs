using System.Text.Json;
using Pgvector;
using TravelDisruptionAgent.Api.Features.Cases;
using TravelDisruptionAgent.Api.Features.Chat;
using TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

namespace TravelDisruptionAgent.Api.Features.Coordinator;

public class KnowledgeBaseService(
    IKnowledgeBaseRepository repo, ICaseRepository caseRepository, IChatService chatService, GeminiClient gemini,
    IRagRepository ragRepository)
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

    public const string LearnedRepliesDocumentName = "Learned replies";

    public async Task<RagDocumentDto> AppendLearnedReplyAsync(string sectionMarkdown, CancellationToken ct = default)
    {
        var section = NormalizeLearnedSection(sectionMarkdown);
        if (section.Length == 0) throw new InvalidOperationException("Draft is empty");

        var existing = await repo.FindLatestDocumentByNameAsync(LearnedRepliesDocumentName, ct);
        var body = string.IsNullOrWhiteSpace(existing?.Content)
            ? "# Learned replies\n\nLessons from disliked AI replies. Follow these when they apply to the guest's question.\n"
            : existing.Content.TrimEnd();
        var content = body + "\n\n" + section + "\n";

        var version = await repo.GetNextVersionAsync(LearnedRepliesDocumentName, ct);
        var now = DateTimeOffset.UtcNow;
        var doc = new RagDocument
        {
            Id = Guid.NewGuid(), Name = LearnedRepliesDocumentName, Version = version, Content = content,
            SourceType = "md", IsDefaultVersion = false, CreatedAt = now, UpdatedAt = now,
        };
        await repo.AddDocumentAsync(doc, ct);

        var sections = content.Split("\n## ", StringSplitOptions.RemoveEmptyEntries)
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
        await repo.ClearDefaultAsync(LearnedRepliesDocumentName, ct);
        doc.IsDefaultVersion = true;
        doc.Chunks = chunks;
        await repo.SaveChangesAsync(ct);
        return ToDto(doc);
    }

    private static string NormalizeLearnedSection(string markdown)
    {
        var text = markdown.Trim();
        if (text.StartsWith("```", StringComparison.Ordinal))
        {
            var newline = text.IndexOf('\n');
            if (newline >= 0) text = text[(newline + 1)..];
            if (text.EndsWith("```", StringComparison.Ordinal)) text = text[..^3];
            text = text.Trim();
        }
        if (text.Length == 0) return "";
        if (!text.StartsWith("## ", StringComparison.Ordinal))
            text = "## Learned reply\n" + text;
        return text;
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
        var platformChunks = await ragRepository.GetSearchableChunksAsync(null, ct);
        var templates = ChatTemplates.Load();

        var run = new GoldenTestRun
        {
            Id = Guid.NewGuid(), TriggerDocumentName = triggerDocName, TriggerVersion = triggerVersion, CreatedAt = now,
        };

        var history = new List<Message>();
        foreach (var test in tests)
        {
            // 上传新文档只跑对话拒答/正常答这 4 条闸门，不把检索题送进 Gemini。
            if (triggerDocName is not null && IsRetrievalExpect(test.Expect))
                continue;

            bool passed;
            GoldenRunDetail detail;

            if (IsRetrievalExpect(test.Expect))
            {
                (passed, detail) = await ScoreRetrievalTestAsync(test, platformChunks, ct);
            }
            else if (sandboxCase is null)
            {
                passed = false;
                detail = new GoldenRunDetail
                {
                    Kind = "chat",
                    ExpectedSummary = ExpectedChatSummary(test, templates),
                    ActualSummary = "(sandbox case unavailable — cannot exercise live chat pipeline)",
                    Reason = "The sandbox booking used to run chat tests is missing.",
                };
            }
            else
            {
                var reply = await chatService.GenerateReplyAsync(sandboxCase, history, test.Input, "en", ct: ct);
                passed = test.Expect == "refuse_template"
                    ? reply.IsTemplate
                    : !reply.IsTemplate && !reply.Escalate && !string.IsNullOrWhiteSpace(reply.Content);
                detail = await BuildChatDetailAsync(test, reply, passed, templates, ct);

                history.Add(new Message { SenderRole = "guest", Content = test.Input, CreatedAt = now, UpdatedAt = now });
                history.Add(new Message { SenderRole = "ai", Content = reply.Content, CreatedAt = now, UpdatedAt = now });
            }

            run.Items.Add(new GoldenTestRunItem
            {
                Id = Guid.NewGuid(), RunId = run.Id, GoldenTestId = test.Id,
                Input = test.Input, Expect = test.Expect, Actual = SerializeDetail(detail), Passed = passed,
            });
        }

        run.PassCount = run.Items.Count(i => i.Passed);
        run.FailCount = run.Items.Count(i => !i.Passed);

        await repo.AddGoldenTestRunAsync(run, ct);
        await repo.SaveChangesAsync(ct);

        return ToRunDto(run);
    }

    private static bool IsRetrievalExpect(string expect) =>
        expect is "retrieval_hit" or "retrieval_miss";

    private static string? HeadingFromChunk(string content)
    {
        var line = content.Split('\n', 2)[0].Trim().TrimStart('#').Trim();
        return string.IsNullOrWhiteSpace(line) ? null : line;
    }

    private static (string? Heading, HashSet<string> Also) ParseExpectedHeadings(string note)
    {
        string? heading = null;
        var also = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var part in note.Split('|'))
        {
            var p = part.Trim();
            if (p.StartsWith("heading:", StringComparison.OrdinalIgnoreCase))
                heading = p["heading:".Length..].Trim();
            else if (p.StartsWith("also:", StringComparison.OrdinalIgnoreCase))
                also.Add(p["also:".Length..].Trim());
        }
        return (heading, also);
    }

    private static string? ExcerptForHeading(IEnumerable<RagDocumentChunk> chunks, string? heading)
    {
        if (string.IsNullOrWhiteSpace(heading)) return null;
        return chunks.FirstOrDefault(c =>
            HeadingFromChunk(c.Content)?.Equals(heading, StringComparison.OrdinalIgnoreCase) == true)?.Content;
    }

    private async Task<(bool Passed, GoldenRunDetail Detail)> ScoreRetrievalTestAsync(
        GoldenTest test, List<RagDocumentChunk> platformChunks, CancellationToken ct)
    {
        var hits = await SearchAsync(test.Input, 1, ct);
        var top = hits.Count > 0 ? hits[0] : null;
        var got = top is null ? null : HeadingFromChunk(top.Content);
        var (expectedHeading, also) = ParseExpectedHeadings(test.Note);
        var expectMiss = test.Expect == "retrieval_miss";
        var headingOk = got is not null && (
            (expectedHeading is not null && got.Equals(expectedHeading, StringComparison.OrdinalIgnoreCase))
            || also.Contains(got));
        var passed = expectMiss
            ? top is null || top.Score >= 0.5
            : top is not null && top.Score < 0.5 && headingOk;

        string reason;
        if (expectMiss)
        {
            reason = passed
                ? "Correct: platform knowledge has no default refund/cancellation terms for this, so retrieval should miss."
                : $"Should retrieve nothing (no platform default policy). Retrieved «{got}» from {top!.DocName} at score {top.Score:F3} (below the 0.5 miss threshold).";
        }
        else if (passed)
        {
            reason = $"Correct: retrieved the expected section «{expectedHeading}».";
        }
        else if (top is null)
        {
            reason = $"Should retrieve «{expectedHeading}», but nothing was retrieved.";
        }
        else
        {
            reason = $"Should retrieve «{expectedHeading}». Retrieved «{got}» from {top.DocName} at score {top.Score:F3}.";
        }

        var detail = new GoldenRunDetail
        {
            Kind = "retrieval",
            ExpectedSummary = expectMiss
                ? "Nothing — there is no platform default refund/cancellation policy for this question."
                : $"Retrieve: {expectedHeading}",
            ActualSummary = top is null ? "Nothing retrieved" : $"{top.DocName} · {got}",
            ExpectedChunkHeading = expectMiss ? null : expectedHeading,
            ExpectedChunkExcerpt = expectMiss ? null : ExcerptForHeading(platformChunks, expectedHeading),
            RetrievedDocName = top?.DocName,
            RetrievedHeading = got,
            RetrievedExcerpt = top?.Content,
            RetrievedScore = top?.Score,
            Reason = reason,
        };
        return (passed, detail);
    }

    private async Task<GoldenRunDetail> BuildChatDetailAsync(
        GoldenTest test, ChatReply reply, bool passed, ChatTemplates templates, CancellationToken ct)
    {
        var hits = await SearchAsync(test.Input, 1, ct);
        var top = hits.Count > 0 ? hits[0] : null;
        var got = top is null ? null : HeadingFromChunk(top.Content);
        var expectedReply = ExpectedChatSummary(test, templates);
        string reason;
        if (test.Expect == "refuse_template")
        {
            reason = passed
                ? "Correct: the agent used the fixed refuse template."
                : "Should refuse with the fixed template, but the agent answered in free text.";
        }
        else
        {
            reason = passed
                ? "Correct: the agent gave a real answer about this guest's booking."
                : "Should answer this guest's own booking, not refuse or escalate.";
        }

        return new GoldenRunDetail
        {
            Kind = "chat",
            ExpectedSummary = expectedReply,
            ActualSummary = reply.Content,
            Reply = reply.Content,
            RetrievedDocName = top?.DocName,
            RetrievedHeading = got,
            RetrievedExcerpt = top?.Content,
            RetrievedScore = top?.Score,
            Reason = reason,
        };
    }

    private static string ExpectedChatSummary(GoldenTest test, ChatTemplates templates)
    {
        if (test.Expect != "refuse_template")
            return "A real answer about this guest's own booking — not a refuse template, and not an escalation.";

        var security = test.Note.Contains("越权", StringComparison.Ordinal)
            || test.Note.Contains("安全", StringComparison.Ordinal)
            || test.Input.Contains("密码", StringComparison.Ordinal)
            || test.Input.Contains("password", StringComparison.OrdinalIgnoreCase);
        var template = security
            ? templates.Pick(templates.SecurityTemplate, "en")
            : templates.Pick(templates.OutOfScopeTemplate, "en");
        return $"Refuse with the fixed template:\n{template}";
    }

    public async Task<GoldenTestRunDto?> GetLatestRunAsync(CancellationToken ct = default)
    {
        var run = await repo.FindLatestRunAsync(ct);
        return run is null ? null : ToRunDto(run);
    }

    private static GoldenTestRunDto ToRunDto(GoldenTestRun run) => new(
        run.Id, run.TriggerDocumentName, run.TriggerVersion, run.PassCount, run.FailCount, run.CreatedAt,
        [.. run.Items.Select(ToItemDto)]);

    private static GoldenTestRunItemDto ToItemDto(GoldenTestRunItem item)
    {
        var detail = ParseDetail(item.Actual) ?? LegacyDetail(item);
        return new GoldenTestRunItemDto(
            item.Input, item.Expect, item.Actual, item.Passed,
            detail.Kind, detail.ExpectedSummary, detail.ActualSummary,
            detail.ExpectedChunkHeading, detail.ExpectedChunkExcerpt,
            detail.RetrievedDocName, detail.RetrievedHeading, detail.RetrievedExcerpt,
            detail.RetrievedScore, detail.Reason);
    }

    private static readonly JsonSerializerOptions DetailJson = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
    };

    private static string SerializeDetail(GoldenRunDetail detail) => JsonSerializer.Serialize(detail, DetailJson);

    private static GoldenRunDetail? ParseDetail(string actual)
    {
        if (string.IsNullOrWhiteSpace(actual) || actual[0] != '{') return null;
        try { return JsonSerializer.Deserialize<GoldenRunDetail>(actual, DetailJson); }
        catch (JsonException) { return null; }
    }

    private static GoldenRunDetail LegacyDetail(GoldenTestRunItem item)
    {
        if (IsRetrievalExpect(item.Expect))
        {
            string? doc = null, heading = null;
            double? score = null;
            if (item.Actual.Contains("score=", StringComparison.Ordinal) && item.Actual.Contains('['))
            {
                var scoreAt = item.Actual.IndexOf("score=", StringComparison.Ordinal);
                doc = item.Actual[..scoreAt].Trim();
                var scoreEnd = item.Actual.IndexOf(' ', scoreAt);
                if (scoreEnd < 0) scoreEnd = item.Actual.IndexOf('[', scoreAt);
                if (double.TryParse(item.Actual.AsSpan(scoreAt + 6, Math.Max(0, scoreEnd - scoreAt - 6)), out var parsed))
                    score = parsed;
                var open = item.Actual.LastIndexOf('[');
                var close = item.Actual.LastIndexOf(']');
                if (open >= 0 && close > open) heading = item.Actual[(open + 1)..close];
            }
            return new GoldenRunDetail
            {
                Kind = "retrieval",
                ExpectedSummary = item.Expect == "retrieval_miss"
                    ? "Nothing — there is no platform default refund/cancellation policy for this question."
                    : item.Expect,
                ActualSummary = item.Actual,
                RetrievedDocName = string.IsNullOrWhiteSpace(doc) ? null : doc,
                RetrievedHeading = heading,
                RetrievedScore = score,
                Reason = item.Passed ? null : $"{item.Expect} vs {item.Actual}",
            };
        }

        return new GoldenRunDetail
        {
            Kind = "chat",
            ExpectedSummary = item.Expect == "refuse_template"
                ? "Refuse with the fixed out-of-scope or privacy template."
                : "A real answer about this guest's own booking.",
            ActualSummary = item.Actual,
            Reply = item.Actual,
            Reason = item.Passed ? null : $"{item.Expect} vs {item.Actual}",
        };
    }

    private sealed class GoldenRunDetail
    {
        public string Kind { get; set; } = "chat";
        public string ExpectedSummary { get; set; } = "";
        public string ActualSummary { get; set; } = "";
        public string? ExpectedChunkHeading { get; set; }
        public string? ExpectedChunkExcerpt { get; set; }
        public string? RetrievedDocName { get; set; }
        public string? RetrievedHeading { get; set; }
        public string? RetrievedExcerpt { get; set; }
        public double? RetrievedScore { get; set; }
        public string? Reason { get; set; }
        public string? Reply { get; set; }
    }

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

    public async Task<List<RagSearchResultDto>> SearchAsync(string query, int topK, CancellationToken ct = default)
    {
        var embedding = await gemini.EmbedAsync(query, ct);
        if (embedding is not { Length: > 0 }) return [];

        var results = await ragRepository.SearchTopKAsync(new Vector(embedding), topK, ct);
        return [.. results.Select(r => new RagSearchResultDto(r.ChunkId, r.DocName, r.Version, r.ChunkIndex, r.Content, r.Distance))];
    }
}
