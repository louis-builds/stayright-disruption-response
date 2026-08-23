namespace TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

/// <summary>status: confirmed|cancelled|rebooked.</summary>
public class Booking
{
    public Guid Id { get; set; }
    public string ConfirmationNo { get; set; } = "";
    public Guid GuestUserId { get; set; }
    public Guid HotelId { get; set; }
    public Guid RoomTypeId { get; set; }
    public DateOnly CheckIn { get; set; }
    public DateOnly CheckOut { get; set; }
    public int GuestsCount { get; set; }
    public decimal TotalAmount { get; set; }
    public string Currency { get; set; } = "NZD";
    public string Status { get; set; } = "confirmed";
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }

    public User? GuestUser { get; set; }
    public Hotel? Hotel { get; set; }
    public RoomType? RoomType { get; set; }
}
