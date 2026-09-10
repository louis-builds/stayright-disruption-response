namespace TravelDisruptionAgent.Api.Features.Disruption;

public record DisruptionListItemDto(
    Guid Id, string Type, string? EventSubtype, string? Severity, string Title, string Region,
    DateTimeOffset StartAt, DateTimeOffset? EndAtOrWindow,
    string Status, int AffectedCount, Guid? AssigneeCoordinatorId, string? AssigneeNickname,
    double? Lat, double? Lng, int AttentionCount);

// 列表携带轻量的坐标字段供前端生成地区摘要；半径与原始信号仍只在详情中返回。
public record DisruptionDetailDto(
    Guid Id, string Type, string? EventSubtype, string? Severity, string Title, string Region,
    double? Lat, double? Lng, double? RadiusKm,
    DateTimeOffset StartAt, DateTimeOffset? EndAtOrWindow,
    string Status, string RawSignalText, string? RawSignalJson, int AffectedCount, Guid? AssigneeCoordinatorId, string? AssigneeNickname);

public record CandidateBookingDto(
    Guid BookingId, string ConfirmationNo, string GuestNickname, string HotelName,
    DateOnly CheckIn, DateOnly CheckOut, bool IsHighValueGuest);

public record AssignDisruptionRequest(Guid ToCoordinatorId);

public record AdjustWindowRequest(DateTimeOffset StartAt, DateTimeOffset? EndAtOrWindow);

public record ExcludeCandidateRequest(Guid BookingId, string Reason);

public record NotifyCandidatesRequest(List<Guid> BookingIds, string Priority);

public record NotifyCandidatesResultDto(int Notified);

// 探测器（Lambda:weather-collector 等）写入新中断事件用的请求形状，
// 字段跟 SeedRunner 里的 DisruptionSeed 保持一致，方便探测端和种子数据互相对照。
public record CreateDisruptionRequest(
    string Type, string Title, string Region, DateTimeOffset StartAt, DateTimeOffset? EndAtOrWindow, string RawSignalText);

public record CreateDisruptionResultDto(Guid Id);
