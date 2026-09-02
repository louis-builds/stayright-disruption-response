namespace TravelDisruptionAgent.Api.Features.Coordinator;

public interface IOpsService
{
    Task<OpsOverviewDto> GetOverviewAsync(CancellationToken ct = default);
    Task<KpiMetricsDto> GetKpiAsync(DateOnly? day, Guid? disruptionId, CancellationToken ct = default);
    Task<List<SevenDayTrendPointDto>> GetSevenDayTrendAsync(CancellationToken ct = default);
    Task AcknowledgeAlertAsync(string alertKey, Guid actorUserId, CancellationToken ct = default);
}
