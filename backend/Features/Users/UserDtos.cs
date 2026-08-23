using System.ComponentModel.DataAnnotations;

namespace TravelDisruptionAgent.Api.Features.Users;

public class UpdateProfileRequest
{
    [Required] public string Nickname { get; set; } = "";
    public string Gender { get; set; } = "unspecified";
    [RegularExpression("^(en|zh|mi)$")] public string Language { get; set; } = "en";
    [Required, RegularExpression(@"^\+?[0-9]{7,15}$", ErrorMessage = "Invalid phone format")]
    public string Phone { get; set; } = "";
    public string? AvatarUrl { get; set; }
}

public class ChangePasswordRequest
{
    [Required] public string CurrentPassword { get; set; } = "";
    [Required, MinLength(8)] public string NewPassword { get; set; } = "";
}

public class RequestEmailChangeRequest
{
    [Required, EmailAddress] public string NewEmail { get; set; } = "";
}

public class ConfirmEmailChangeRequest
{
    [Required, EmailAddress] public string NewEmail { get; set; } = "";
    [Required] public string Code { get; set; } = "";
}

public record EmailChangeRequestedDto(string DevCode, DateTimeOffset ExpiresAt);
