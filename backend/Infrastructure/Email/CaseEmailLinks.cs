namespace TravelDisruptionAgent.Api.Infrastructure.Email;

public static class CaseEmailLinks
{
    private static string FrontendBaseUrl =>
        Environment.GetEnvironmentVariable("FRONTEND_BASE_URL") ?? "http://localhost:5173";

    public static string BuildCaseLink(Guid caseId) => $"{FrontendBaseUrl}/cases/{caseId}";

    public static string BuildCaseActionLink(string token) => $"{FrontendBaseUrl}/case-actions/confirm?token={Uri.EscapeDataString(token)}";
}
