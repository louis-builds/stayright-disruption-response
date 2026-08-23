using System.Security.Claims;
using TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

namespace TravelDisruptionAgent.Api.Features.Auth;

public class AuthService(IUserRepository users, ILogger<AuthService> logger) : IAuthService
{
    private static AuthUserDto ToDto(User u) => AuthUserMapper.ToDto(u);

    public async Task<AuthUserDto> RegisterAsync(RegisterRequest request, CancellationToken ct = default)
    {
        if (request.Password != request.ConfirmPassword)
            throw new AuthValidationException("Passwords do not match");

        if (await users.FindByEmailAsync(request.Email, ct) is not null)
            throw new AuthValidationException("Email is already registered");

        if (await users.FindByNicknameAsync(request.Nickname, ct) is not null)
            throw new AuthValidationException("Nickname is already taken");

        Hotel? hotel = null;
        if (request.Role == "hotel")
        {
            if (request.Hotel is null || string.IsNullOrWhiteSpace(request.Hotel.Name))
                throw new AuthValidationException("Hotel name is required for hotel registration");
            if (request.Hotel.Lat == 0 && request.Hotel.Lng == 0)
                throw new AuthValidationException("Please pick a location on the map for hotel registration");
            if (request.Hotel.RoomTypes.Count == 0)
                throw new AuthValidationException("At least 1 room type is required for hotel registration");

            var now = DateTimeOffset.UtcNow;
            hotel = new Hotel
            {
                Id = Guid.NewGuid(),
                Name = request.Hotel.Name,
                Address = request.Hotel.Address,
                Lat = request.Hotel.Lat,
                Lng = request.Hotel.Lng,
                Status = "active",
                CreatedAt = now,
                UpdatedAt = now,
                RoomTypes = [.. request.Hotel.RoomTypes.Select(r => new RoomType
                {
                    Id = Guid.NewGuid(),
                    Name = r.Name,
                    Description = r.Description,
                    Amenities = r.Amenities,
                    Capacity = r.Capacity,
                    PriceAmount = r.PriceAmount,
                    Currency = r.Currency,
                    ImageUrls = r.ImageUrls,
                    CreatedAt = now,
                    UpdatedAt = now,
                })],
            };
        }

        var user = new User
        {
            Id = Guid.NewGuid(),
            Role = request.Role,
            Email = request.Email,
            Phone = request.Phone,
            Nickname = request.Nickname,
            AvatarUrl = request.AvatarUrl,
            Gender = request.Gender,
            Language = request.Language,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(request.Password),
            Hotel = hotel,
            HotelId = hotel?.Id,
            Status = "active",
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };

        await users.AddAsync(user, ct);
        await users.SaveChangesAsync(ct);

        logger.LogInformation("User registered: {Email} role={Role}", user.Email, user.Role);
        return ToDto(user);
    }

    public async Task<(AuthUserDto User, ClaimsPrincipal Principal)> LoginAsync(LoginRequest request, CancellationToken ct = default)
    {
        var user = request.Identifier.Contains('@')
            ? await users.FindByEmailAsync(request.Identifier, ct)
            : await users.FindByNicknameAsync(request.Identifier, ct);

        // Unified message, doesn't distinguish "account not found" from "wrong password"
        if (user is null || !BCrypt.Net.BCrypt.Verify(request.Password, user.PasswordHash))
            throw new AuthValidationException("Incorrect username/email or password");

        if (user.Status != "active")
            throw new AuthValidationException("This account has been disabled");

        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, user.Id.ToString()),
            new(ClaimTypes.Name, user.Nickname),
            new(ClaimTypes.Email, user.Email),
            new(ClaimTypes.Role, user.Role),
        };
        var identity = new ClaimsIdentity(claims, "cookie");
        var principal = new ClaimsPrincipal(identity);

        logger.LogInformation("User logged in: {Email}", user.Email);
        return (ToDto(user), principal);
    }

    public Task<ForgotPasswordResultDto> ForgotPasswordAsync(ForgotPasswordRequest request, CancellationToken ct = default)
    {
        // 最小实现：只生成一次性重置链接并记录日志，不落库、不真正发送邮件（邮件通道在 Task 6 接入）。
        var token = Guid.NewGuid().ToString("N");
        var expiresAt = DateTimeOffset.UtcNow.AddHours(1);
        var link = $"/reset-password?email={Uri.EscapeDataString(request.Email)}&token={token}";
        logger.LogInformation("Password reset link generated for {Email}: {Link} (expires {ExpiresAt})",
            request.Email, link, expiresAt);
        return Task.FromResult(new ForgotPasswordResultDto(link, expiresAt));
    }

    public async Task<AuthUserDto?> GetByIdAsync(Guid id, CancellationToken ct = default)
    {
        var user = await users.FindByIdAsync(id, ct);
        return user is null ? null : ToDto(user);
    }
}
