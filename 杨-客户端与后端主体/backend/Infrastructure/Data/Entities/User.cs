namespace TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

/// <summary>role: guest|coordinator|hotel; language: en|zh|mi; status: active|disabled.</summary>
public class User
{
    public Guid Id { get; set; }
    public string Role { get; set; } = "guest";
    public string Email { get; set; } = "";
    public string Phone { get; set; } = "";
    public string Nickname { get; set; } = "";
    public string? AvatarUrl { get; set; }
    public string Gender { get; set; } = "unspecified";
    public string Language { get; set; } = "en";
    public string PasswordHash { get; set; } = "";
    public Guid? HotelId { get; set; }
    public string Status { get; set; } = "active";
    public bool MustChangePassword { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }

    public Hotel? Hotel { get; set; }
}
