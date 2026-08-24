namespace TravelDisruptionAgent.Api.Features.Faq;

/// <summary>每小时把新增的客人提问聚类一次；启动时先跑一轮，不用干等一小时才有第一批数据。</summary>
public class FaqClusteringJob(IServiceScopeFactory scopeFactory, ILogger<FaqClusteringJob> logger) : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromHours(1);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var scope = scopeFactory.CreateScope();
                var faqService = scope.ServiceProvider.GetRequiredService<IFaqService>();
                await faqService.ProcessNewQuestionsAsync(stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogError(ex, "FAQ clustering run failed");
            }

            try
            {
                await Task.Delay(Interval, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }
}
