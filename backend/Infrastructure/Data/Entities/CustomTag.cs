namespace TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

/// <summary>owner_role: hotel|coordinator。hotel 的标签归属到 HotelId(只有那家酒店能看到/用)；
/// coordinator 的标签是协调员团队共用的一份，不分个人(HotelId 为 null)——这个 app 里协调员本来就不
/// 分组，没必要再拆"我的标签"。</summary>
public class CustomTag
{
    public Guid Id { get; set; }
    public string Label { get; set; } = "";
    public string OwnerRole { get; set; } = "coordinator";
    public Guid? HotelId { get; set; }
    public Guid CreatedByUserId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }

    public Hotel? Hotel { get; set; }
}
