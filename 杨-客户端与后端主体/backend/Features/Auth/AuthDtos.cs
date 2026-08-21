using System.ComponentModel.DataAnnotations;

namespace TravelDisruptionAgent.Api.Features.Auth;

public class RoomTypeInput
{
    [Required] public string Name { get; set; } = "";
    public string Description { get; set; } = "";
    public List<string> Amenities { get; set; } = [];
    public int Capacity { get; set; } = 2;
    [Range(0, double.MaxValue)] public decimal PriceAmount { get; set; }
    public string Currency { get; set; } = "NZD";
    public List<string> ImageUrls { get; set; } = [];
}

public class HotelProfileInput
{
    [Required] public string Name { get; set; } = "";
    [Required] public string Address { get; set; } = "";
    public double Lat { get; set; }
    public double Lng { get; set; }
    public List<RoomTypeInput> RoomTypes { get; set; } = [];
}

/// <summary>role: guest|coordinator|hotel。选 hotel 时 Hotel 字段必填且至少 1 个房型（在 AuthService 里做条件校验，Data Annotations 表达不了跨字段条件必填）。</summary>
public class RegisterRequest
{
    [Required, EmailAddress] public string Email { get; set; } = "";
    [Required, RegularExpression(@"^\+?[0-9]{7,15}$", ErrorMessage = "Invalid phone format")]
    public string Phone { get; set; } = "";
    [Required] public string Nickname { get; set; } = "";
    public string Gender { get; set; } = "unspecified";
    [RegularExpression("^(en|zh|mi)$")] public string Language { get; set; } = "en";
    [Required, MinLength(8)] public string Password { get; set; } = "";
    [Required] public string ConfirmPassword { get; set; } = "";
    [RegularExpression("^(guest|coordinator|hotel)$")] public string Role { get; set; } = "guest";
    public string? AvatarUrl { get; set; }
    public HotelProfileInput? Hotel { get; set; }
}

public class LoginRequest
{
    /// <summary>用户名(nickname)或邮箱二选一，同一个输入框自动识别。</summary>
    [Required] public string Identifier { get; set; } = "";
    [Required] public string Password { get; set; } = "";
    public bool RememberMe { get; set; }
}

public class ForgotPasswordRequest
{
    [Required, EmailAddress] public string Email { get; set; } = "";
}

public record AuthUserDto(
    Guid Id, string Nickname, string Email, string Role, string? AvatarUrl, string HomeRoute,
    string Gender, string Language, string Phone, bool MustChangePassword, DateTimeOffset CreatedAt);

public record ForgotPasswordResultDto(string ResetLink, DateTimeOffset ExpiresAt);
