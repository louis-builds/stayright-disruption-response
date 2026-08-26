namespace TravelDisruptionAgent.Api.Infrastructure.Email;

public static class CaseEmailLinks
{
    private static string FrontendBaseUrl =>
        Environment.GetEnvironmentVariable("FRONTEND_BASE_URL") ?? "http://localhost:5173";

    public static string BuildCaseLink(Guid caseId) => $"{FrontendBaseUrl}/cases/{caseId}";

    public static string BuildCaseActionLink(string token) => $"{FrontendBaseUrl}/case-actions/confirm?token={Uri.EscapeDataString(token)}";

    /// <summary>/cases/:id 是客人视角的对话页，酒店账号不是这个线程的参与者——点进去只会看到空对话框。
    /// 酒店邮件一律指回自己的待办首页，具体信息在邮件正文里写清楚，不指望点进去才看到。</summary>
    public static string BuildHotelHomeLink() => $"{FrontendBaseUrl}/hotel/home";
}
