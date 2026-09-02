namespace TravelDisruptionAgent.Api.Features.Coordinator;

public record SignalSourceStatusDto(string Type, bool Configured, DateTimeOffset? LastIngestedAt);

public record AlertDto(string Key, string Level, string Message, bool Acknowledged);

public record KpiMetricsDto(
    double FirstNotifyRatePercent, int FirstNotifyNumerator, int FirstNotifyDenominator,
    double RebookingRetentionPercent, int RebookingNumerator, int RebookingDenominator,
    double? AvgResolutionHours, double? MedianResolutionHours,
    int ConcurrentInProgressCount, int NotifiedCount, int ResolvedCount,
    int EscalationDepth, int EscalationOverdueCount);

public record OpsOverviewDto(
    List<SignalSourceStatusDto> SignalSources,
    int FailedNotificationCount, int HotelOverdueInquiryCount, int EscalationBacklogDepth,
    double EmailSuccessRatePercent, double InAppSuccessRatePercent, bool DatabaseHealthy,
    List<AlertDto> Alerts, KpiMetricsDto TodayKpi);

public record AcknowledgeAlertRequest(string AlertKey);

public record SevenDayTrendPointDto(
    DateOnly Date, int NewCases, int InProgress, int AwaitingGuest, int AwaitingHotel, int Closed);
