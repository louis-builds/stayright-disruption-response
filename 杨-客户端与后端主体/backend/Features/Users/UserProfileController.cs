using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TravelDisruptionAgent.Api.Features.Auth;
using TravelDisruptionAgent.Api.Infrastructure;

namespace TravelDisruptionAgent.Api.Features.Users;

[ApiController]
[Route("api/users/me")]
[Authorize]
public class UserProfileController(IUserRepository users, PendingEmailChangeStore emailChanges, ILogger<UserProfileController> logger) : ControllerBase
{
    private Guid CurrentUserId => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    [HttpPut("profile")]
    public async Task<ActionResult<ApiResponse<AuthUserDto>>> UpdateProfile(UpdateProfileRequest request, CancellationToken ct)
    {
        var user = await users.FindByIdAsync(CurrentUserId, ct);
        if (user is null) return NotFound(ApiResponse<object?>.Fail(404, "User not found"));

        // Register()'s AuthService rejects a duplicate nickname at signup, but this endpoint had no
        // equivalent check — a profile edit could silently collide with an existing user's nickname
        // (no unique DB constraint on it either), leaving one of the two accounts unable to log in
        // by nickname (FindByNicknameAsync's FirstOrDefault becomes non-deterministic between them).
        if (request.Nickname != user.Nickname && await users.FindByNicknameAsync(request.Nickname, ct) is not null)
            return BadRequest(ApiResponse<object?>.Fail(400, "Nickname is already taken"));

        user.Nickname = request.Nickname;
        user.Gender = request.Gender;
        user.Language = request.Language;
        user.Phone = request.Phone;
        if (request.AvatarUrl is not null) user.AvatarUrl = request.AvatarUrl;
        user.UpdatedAt = DateTimeOffset.UtcNow;
        await users.SaveChangesAsync(ct);

        return Ok(ApiResponse<AuthUserDto>.Ok(AuthUserMapper.ToDto(user), "Profile updated"));
    }

    [HttpPost("password")]
    public async Task<ActionResult<ApiResponse<object?>>> ChangePassword(ChangePasswordRequest request, CancellationToken ct)
    {
        var user = await users.FindByIdAsync(CurrentUserId, ct);
        if (user is null) return NotFound(ApiResponse<object?>.Fail(404, "User not found"));

        if (!BCrypt.Net.BCrypt.Verify(request.CurrentPassword, user.PasswordHash))
            return BadRequest(ApiResponse<object?>.Fail(400, "Current password is incorrect"));

        user.PasswordHash = BCrypt.Net.BCrypt.HashPassword(request.NewPassword);
        user.MustChangePassword = false;
        user.UpdatedAt = DateTimeOffset.UtcNow;
        await users.SaveChangesAsync(ct);
        return Ok(ApiResponse<object?>.Ok(null, "Password changed"));
    }

    [HttpPost("email/request-change")]
    public async Task<ActionResult<ApiResponse<EmailChangeRequestedDto>>> RequestEmailChange(RequestEmailChangeRequest request, CancellationToken ct)
    {
        if (await users.FindByEmailAsync(request.NewEmail, ct) is not null)
            return BadRequest(ApiResponse<object?>.Fail(400, "This email is already in use"));

        var code = emailChanges.IssueCode(CurrentUserId, request.NewEmail);
        var expiresAt = DateTimeOffset.UtcNow.AddMinutes(10);
        logger.LogInformation("Email change verification code for {NewEmail}: {Code} (expires {ExpiresAt})", request.NewEmail, code, expiresAt);

        // Dev/demo only: the code is returned directly since there's no real email channel yet.
        // A production build must only email it, never echo it back in the response.
        return Ok(ApiResponse<EmailChangeRequestedDto>.Ok(new EmailChangeRequestedDto(code, expiresAt), "Verification code generated"));
    }

    [HttpPost("email/confirm-change")]
    public async Task<ActionResult<ApiResponse<AuthUserDto>>> ConfirmEmailChange(ConfirmEmailChangeRequest request, CancellationToken ct)
    {
        if (!emailChanges.TryConfirm(CurrentUserId, request.NewEmail, request.Code))
            return BadRequest(ApiResponse<object?>.Fail(400, "Verification code is incorrect or has expired"));

        var user = await users.FindByIdAsync(CurrentUserId, ct);
        if (user is null) return NotFound(ApiResponse<object?>.Fail(404, "User not found"));

        user.Email = request.NewEmail;
        user.UpdatedAt = DateTimeOffset.UtcNow;
        await users.SaveChangesAsync(ct);

        return Ok(ApiResponse<AuthUserDto>.Ok(AuthUserMapper.ToDto(user), "Email updated"));
    }
}
