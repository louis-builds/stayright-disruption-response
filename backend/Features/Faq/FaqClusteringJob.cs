namespace TravelDisruptionAgent.Api.Features.Faq;

/// <summary>每天0点把新增的客人提问聚类一次；启动时先跑一轮，不用干等到第一个0点才有数据。</summary>
public class FaqClusteringJob(IServiceScopeFactory scopeFactory, ILogger<FaqClusteringJob> logger) : BackgroundService
{
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

            var now = DateTimeOffset.Now;
            var nextMidnight = now.Date.AddDays(1);
            try
            {
                await Task.Delay(nextMidnight - now, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }
}
