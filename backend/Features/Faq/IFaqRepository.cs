using TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

namespace TravelDisruptionAgent.Api.Features.Faq;

public interface IFaqRepository
{
    /// <summary>since 之后(不含)客人在 AI 线程里发的提问，按时间升序——游标为 null 时取全部历史。</summary>
    Task<List<Message>> ListUnprocessedGuestQuestionsAsync(DateTimeOffset? since, CancellationToken ct = default);
    Task<List<FaqQuestion>> ListClustersAsync(CancellationToken ct = default);
    Task AddClusterAsync(FaqQuestion cluster, CancellationToken ct = default);
    Task<List<FaqQuestion>> ListTopAsync(int count, CancellationToken ct = default);
    Task SaveChangesAsync(CancellationToken ct = default);
}
