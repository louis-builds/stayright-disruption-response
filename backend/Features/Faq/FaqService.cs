using TravelDisruptionAgent.Api.Features.Chat;
using TravelDisruptionAgent.Api.Features.Coordinator;
using TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

namespace TravelDisruptionAgent.Api.Features.Faq;

// ponytail: 每个问题簇的代表文案/向量固定用首次出现的那次，不随后续命中做滚动平均——
// 语料量小，这个简化不影响可用性，真要精细化再改成加权平均。
public class FaqService(IFaqRepository repo, ISystemSettingsRepository settingsRepo, GeminiClient gemini, ILogger<FaqService> logger)
    : IFaqService
{
    private const double SimilarityThreshold = 0.90;

    public async Task ProcessNewQuestionsAsync(CancellationToken ct = default)
    {
        var settings = await settingsRepo.GetAsync(ct);
        var questions = await repo.ListUnprocessedGuestQuestionsAsync(settings.FaqProcessedThrough, ct);
        if (questions.Count == 0) return;

        var clusters = await repo.ListClustersAsync(ct);

        foreach (var message in questions)
        {
            var embedding = await gemini.EmbedAsync(message.Content, ct);
            if (embedding is null)
            {
                logger.LogWarning("Skipping FAQ clustering for message {MessageId}: embedding failed", message.Id);
                continue;
            }

            FaqQuestion? best = null;
            var bestScore = 0.0;
            foreach (var cluster in clusters)
            {
                var score = CosineSimilarity(embedding, cluster.Embedding);
                if (score > bestScore)
                {
                    bestScore = score;
                    best = cluster;
                }
            }

            if (best is not null && bestScore >= SimilarityThreshold)
            {
                best.AskCount++;
                best.LastAskedAt = message.CreatedAt;
                best.UpdatedAt = DateTimeOffset.UtcNow;
            }
            else
            {
                var now = DateTimeOffset.UtcNow;
                var newCluster = new FaqQuestion
                {
                    Id = Guid.NewGuid(), QuestionText = message.Content, Embedding = embedding,
                    AskCount = 1, LastAskedAt = message.CreatedAt, CreatedAt = now, UpdatedAt = now,
                };
                await repo.AddClusterAsync(newCluster, ct);
                clusters.Add(newCluster);
            }
        }

        // settingsRepo 和 repo 背后是同一个 DbContext，一次 SaveChangesAsync 就把两边的改动一起落库。
        settings.FaqProcessedThrough = questions[^1].CreatedAt;
        settings.UpdatedAt = DateTimeOffset.UtcNow;
        await repo.SaveChangesAsync(ct);
    }

    public async Task<List<FaqQuestionDto>> GetTopQuestionsAsync(CancellationToken ct = default)
    {
        var top = await repo.ListTopAsync(3, ct);
        return [.. top.Select(f => new FaqQuestionDto(f.QuestionText, f.AskCount))];
    }

    private static double CosineSimilarity(float[] a, float[] b)
    {
        var len = Math.Min(a.Length, b.Length);
        double dot = 0, normA = 0, normB = 0;
        for (var i = 0; i < len; i++)
        {
            dot += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }
        if (normA == 0 || normB == 0) return 0;
        return dot / (Math.Sqrt(normA) * Math.Sqrt(normB));
    }
}
