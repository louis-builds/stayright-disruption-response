namespace TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

/// <summary>
/// type: weather|flight|road; status: active|closed.
/// event_subtype/severity/lat/lng/radius_km/raw_signal_json 对齐 detect/src/identify/handoff.py
/// 的 build_handoff_payloads() 写出的 disruption_event 结构，
/// 目前只有 weather/storm 这条对接链路会填这些列，其它 type 留空。
/// </summary>
public class Disruption
{
    public Guid Id { get; set; }
    public string Type { get; set; } = "weather";
    public string? EventSubtype { get; set; }
    public string Title { get; set; } = "";
    public string Region { get; set; } = "";
    public string? Severity { get; set; }
    public double? Lat { get; set; }
    public double? Lng { get; set; }
    public double? RadiusKm { get; set; }
    public string? RawSignalJson { get; set; }
    public DateTimeOffset StartAt { get; set; }
    public DateTimeOffset? EndAtOrWindow { get; set; }
    public string Status { get; set; } = "active";
    public string RawSignalText { get; set; } = "";
    public Guid? AssigneeCoordinatorId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}
