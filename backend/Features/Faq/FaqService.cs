using Pgvector;
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

        foreach (var message in questions)
        {
            var embedding = await gemini.EmbedAsync(message.Content, ct);
            if (embedding is null)
            {
                logger.LogWarning("Skipping FAQ clustering for message {MessageId}: embedding failed", message.Id);
                continue;
            }

            var query = new Vector(embedding);
            var nearest = await repo.FindNearestClusterAsync(query, ct);
            var similarity = nearest is null ? 0 : 1 - nearest.Value.Distance;

            if (nearest is not null && similarity >= SimilarityThreshold)
            {
                nearest.Value.Cluster.AskCount++;
                nearest.Value.Cluster.LastAskedAt = message.CreatedAt;
                nearest.Value.Cluster.UpdatedAt = DateTimeOffset.UtcNow;
            }
            else
            {
                var now = DateTimeOffset.UtcNow;
                var newCluster = new FaqQuestion
                {
                    Id = Guid.NewGuid(), QuestionText = message.Content, Embedding = query,
                    AskCount = 1, LastAskedAt = message.CreatedAt, CreatedAt = now, UpdatedAt = now,
                };
                await repo.AddClusterAsync(newCluster, ct);
                // 同一批后续问题要能命中刚建的簇，必须先落库，pgvector 才能用 <=> 搜到。
                await repo.SaveChangesAsync(ct);
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
}
