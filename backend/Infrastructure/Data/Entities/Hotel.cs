namespace TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

/// <summary>status: active|disabled.</summary>
public class Hotel
{
    public Guid Id { get; set; }
    public string Name { get; set; } = "";
    public string Address { get; set; } = "";
    public double Lat { get; set; }
    public double Lng { get; set; }
    public string? GooglePlaceId { get; set; }
    public List<string> ImageUrls { get; set; } = [];
    public int PrimaryImageIndex { get; set; }
    public string Status { get; set; } = "active";
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }

    public List<RoomType> RoomTypes { get; set; } = [];
}
