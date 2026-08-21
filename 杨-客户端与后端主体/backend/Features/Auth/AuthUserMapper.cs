using TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

namespace TravelDisruptionAgent.Api.Features.Auth;

public static class AuthUserMapper
{
    public static string HomeRoute(string role) => role switch
    {
        "coordinator" => "/coordinator/home",
        "hotel" => "/hotel/home",
        _ => "/guest/home",
    };

    public static AuthUserDto ToDto(User u) =>
        new(u.Id, u.Nickname, u.Email, u.Role, u.AvatarUrl, HomeRoute(u.Role), u.Gender, u.Language, u.Phone, u.MustChangePassword, u.CreatedAt);
}
