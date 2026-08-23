namespace TravelDisruptionAgent.Api.Features.Coordinator;

public record AdminUserDto(
    Guid Id, string Nickname, string Email, string Role, string Status, bool MustChangePassword,
    string Phone, string Gender, string Language, DateTimeOffset CreatedAt, string? HotelName);

public record DisableUserRequest(string Reason);

public record ResetPasswordResultDto(string TemporaryPassword);

public record SystemSettingsDto(int UnresolvedTurnThreshold, bool LowConfidenceEscalationEnabled);
