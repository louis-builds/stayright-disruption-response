namespace TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

/// <summary>酒店预先配置好的可选权益目录(免费早餐/免费饮品等)，挂到某个 Option 上时是拷贝名字快照
/// (Option.PerkNames)，不是外键关联——目录改名不会倒着改已经发给客人的历史方案，这是有意的。</summary>
public class HotelPerk
{
    public Guid Id { get; set; }
    public Guid HotelId { get; set; }
    public string Name { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; }

    public Hotel? Hotel { get; set; }
}
