namespace TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

public class RoomType
{
    public Guid Id { get; set; }
    public Guid HotelId { get; set; }
    public string Name { get; set; } = "";
    public string Description { get; set; } = "";
    public List<string> Amenities { get; set; } = [];
    public int Capacity { get; set; }
    public decimal PriceAmount { get; set; }
    public string Currency { get; set; } = "NZD";
    public List<string> ImageUrls { get; set; } = [];
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }

    public Hotel? Hotel { get; set; }
}
