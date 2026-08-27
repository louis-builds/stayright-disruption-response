using System.Net;

namespace TravelDisruptionAgent.Api.Infrastructure.Email;

public static class EmailTemplate
{
    public const string ButtonStyle = "display:inline-block;padding:10px 18px;background:#2e6f96;color:#ffffff;border-radius:6px;text-decoration:none;font-weight:600;";

    public static string Button(string href, string text) =>
        $"<p><a href=\"{href}\" style=\"{ButtonStyle}\">{WebUtility.HtmlEncode(text)}</a></p>";

    public static string Build(string title, string bodyHtml) => $"""
        <div style="max-width:560px;margin:0 auto;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;">
          <div style="background:#2e6f96;padding:24px 32px;border-radius:8px 8px 0 0;">
            <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:700;">{WebUtility.HtmlEncode(title)}</h1>
          </div>
          <div style="background:#ffffff;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;padding:24px 32px;line-height:1.5;">
            {bodyHtml}
            <p style="margin-top:32px;padding-top:16px;border-top:1px solid #e2e8f0;color:#64748b;font-size:13px;">
              This is an automated message from Travel Disruption Agent — please don't reply directly to this email.
            </p>
          </div>
        </div>
        """;
}
