namespace TravelDisruptionAgent.Api.Infrastructure.Email;

public interface IEmailService
{
    Task SendEmailAsync(string to, string subject, string body, CancellationToken ct = default, string? htmlBody = null);
}
