using MailKit.Net.Smtp;
using MailKit.Security;
using MimeKit;

namespace TravelDisruptionAgent.Api.Infrastructure.Email;

/// <summary>
/// SMTP_PORT=465 (QQ 邮箱等) 用的是隐式 TLS，.NET 自带 System.Net.Mail.SmtpClient 对这种连接方式支持不可靠，
/// 所以用 MailKit（成熟标准库，正确处理隐式 TLS）而不是自己撸 SmtpClient。
/// </summary>
public class SmtpEmailService(ILogger<SmtpEmailService> logger) : IEmailService
{
    public async Task SendEmailAsync(string to, string subject, string body, CancellationToken ct = default, string? htmlBody = null)
    {
        var host = Environment.GetEnvironmentVariable("SMTP_HOST");
        var port = int.TryParse(Environment.GetEnvironmentVariable("SMTP_PORT"), out var p) ? p : 465;
        var secure = Environment.GetEnvironmentVariable("SMTP_SECURE") != "false";
        var user = Environment.GetEnvironmentVariable("SMTP_USER");
        var pass = Environment.GetEnvironmentVariable("SMTP_PASS");
        var from = Environment.GetEnvironmentVariable("SMTP_FROM") ?? user;

        if (string.IsNullOrEmpty(host) || string.IsNullOrEmpty(user) || string.IsNullOrEmpty(pass))
        {
            logger.LogWarning("SMTP not configured; skipping email to {To} (subject: {Subject})", to, subject);
            return;
        }

        var message = new MimeMessage();
        message.From.Add(MailboxAddress.Parse(from!));
        message.To.Add(MailboxAddress.Parse(to));
        message.Subject = subject;
        message.Body = htmlBody is null
            ? new TextPart("plain") { Text = body }
            : new BodyBuilder { TextBody = body, HtmlBody = htmlBody }.ToMessageBody();

        using var client = new SmtpClient();
        var socketOptions = secure ? SecureSocketOptions.SslOnConnect : SecureSocketOptions.StartTlsWhenAvailable;
        await client.ConnectAsync(host, port, socketOptions, ct);
        await client.AuthenticateAsync(user, pass, ct);
        await client.SendAsync(message, ct);
        await client.DisconnectAsync(true, ct);

        logger.LogInformation("Email sent to {To} (subject: {Subject})", to, subject);
    }
}
